import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { RateLimiterPort } from '@modules/authentication/domain/services/rate-limiter.port';
import { RATE_LIMITER } from '@modules/authentication/domain/tokens/authentication.tokens';
import type { RealtimeConfig } from '@config/realtime.config';
import { WsAuthenticationService } from '../../application/ws-authentication.service';
import { RoomAuthorizationService } from '../../application/room-authorization.service';
import {
  RoomType,
  buildCanonicalRoom,
  isRoomType,
  isWellFormedResourceId,
} from '../../application/room';
import { SocketIoRealtimeBroadcaster } from '../../infrastructure/socket-io-realtime-broadcaster';
import { RoomSubscriptionAck, RoomSubscriptionRequest } from '../dto/room-subscription.dto';

interface RealtimeSocketData {
  actor: AuthenticatedActor;
  rooms: Set<string>;
}

/**
 * Phase 8 §3/§10/§11/§12/§17/§21 — the one Socket.IO gateway RealtimeModule
 * owns. Never mutates domain state (§26 - "Gateway must not mutate domain
 * state") - every handler here either authenticates, authorizes a room join,
 * or rejects; REST remains the only command surface.
 */
@WebSocketGateway({ transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly config: RealtimeConfig;

  constructor(
    private readonly wsAuthentication: WsAuthenticationService,
    private readonly roomAuthorization: RoomAuthorizationService,
    private readonly broadcaster: SocketIoRealtimeBroadcaster,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiterPort,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<RealtimeConfig>('realtime', { infer: true });
    if (!config) {
      throw new Error('Realtime configuration is not loaded.');
    }
    this.config = config;
  }

  afterInit(server: Server): void {
    this.broadcaster.setServer(server);
    server.use((socket, next) => {
      void this.authenticateSocket(socket as Socket, next);
    });
  }

  /**
   * Registered as Socket.IO connection middleware (`server.use`), not the
   * `OnGatewayConnection` lifecycle hook, so authentication runs to
   * completion BEFORE the `connection` event fires and before the client can
   * emit anything else. Discovered as a genuine race during Phase 8 e2e
   * testing against a real socket.io-client: `OnGatewayConnection` is async
   * (its `await this.wsAuthentication.authenticate(token)` includes a real
   * DB round-trip) but Socket.IO does not wait for it before delivering
   * subsequent client events - a real client that emits `room.subscribe`
   * immediately after `connect` could reach `handleSubscribe` before
   * `client.data.actor` was ever attached. Middleware closes that race
   * entirely and also gives a rejected handshake a proper client-side
   * `connect_error` (§10 - "authentication failure must reject the
   * connection") instead of a connect-then-immediately-disconnect flicker.
   */
  async authenticateSocket(client: Socket, next: (err?: Error) => void): Promise<void> {
    try {
      const ip = resolveSocketIp(client);
      const handshakeDecision = await this.rateLimiter.consume(
        `ws:handshake:${ip}`,
        this.config.rateLimits.handshake.max,
        this.config.rateLimits.handshake.windowSeconds,
        new Date(),
      );
      if (!handshakeDecision.allowed) {
        next(new Error('Too many connection attempts.'));
        return;
      }

      const token = extractHandshakeToken(client);
      const { actor, expiresAt } = await this.wsAuthentication.authenticate(token);

      const data: RealtimeSocketData = { actor, rooms: new Set<string>() };
      client.data = data;

      if (expiresAt) {
        this.scheduleExpiryDisconnect(client, expiresAt);
      }

      client.onAny((eventName: string) => {
        if (eventName !== 'room.subscribe' && eventName !== 'room.unsubscribe') {
          void this.handleUnknownEvent(client);
        }
      });

      next();
    } catch (error) {
      this.logger.debug(
        `WS handshake rejected for socket ${client.id}: ${(error as Error).message}`,
      );
      next(error instanceof Error ? error : new Error('Unauthorized'));
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiryTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client.id);
    }
  }

  @SubscribeMessage('room.subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomSubscriptionRequest,
  ): Promise<RoomSubscriptionAck> {
    const data = client.data as RealtimeSocketData;

    const rateDecision = await this.rateLimiter.consume(
      `ws:subscribe:${client.id}`,
      this.config.rateLimits.subscribe.max,
      this.config.rateLimits.subscribe.windowSeconds,
      new Date(),
    );
    if (!rateDecision.allowed) {
      return { ok: false, code: 'RATE_LIMITED', message: 'Too many subscribe requests.' };
    }

    const roomType = extractRoomType(body);
    if (roomType === null) {
      return { ok: false, code: 'UNKNOWN_ROOM_TYPE', message: 'Unknown or malformed room type.' };
    }
    const resourceId = extractResourceId(body);
    if (resourceId === null || !isWellFormedResourceId(resourceId)) {
      return { ok: false, code: 'INVALID_RESOURCE_ID', message: 'Malformed resource id.' };
    }

    const room = await this.roomAuthorization.authorize(data.actor, roomType, resourceId);
    if (room === null) {
      return { ok: false, code: 'FORBIDDEN', message: 'Not authorized for this room.' };
    }

    // Idempotent: joining an already-joined room is a no-op success, and
    // does not re-count against the per-socket room cap.
    if (!data.rooms.has(room)) {
      if (data.rooms.size >= this.config.maxRoomsPerSocket) {
        return {
          ok: false,
          code: 'MAX_ROOMS_EXCEEDED',
          message: `Maximum of ${this.config.maxRoomsPerSocket} rooms per socket exceeded.`,
        };
      }
      await client.join(room);
      data.rooms.add(room);
    }

    return { ok: true, room };
  }

  @SubscribeMessage('room.unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomSubscriptionRequest,
  ): Promise<RoomSubscriptionAck> {
    const data = client.data as RealtimeSocketData;

    const rateDecision = await this.rateLimiter.consume(
      `ws:unsubscribe:${client.id}`,
      this.config.rateLimits.unsubscribe.max,
      this.config.rateLimits.unsubscribe.windowSeconds,
      new Date(),
    );
    if (!rateDecision.allowed) {
      return { ok: false, code: 'RATE_LIMITED', message: 'Too many unsubscribe requests.' };
    }

    const roomType = extractRoomType(body);
    if (roomType === null) {
      return { ok: false, code: 'UNKNOWN_ROOM_TYPE', message: 'Unknown or malformed room type.' };
    }
    const resourceId = extractResourceId(body);
    if (resourceId === null || !isWellFormedResourceId(resourceId)) {
      return { ok: false, code: 'INVALID_RESOURCE_ID', message: 'Malformed resource id.' };
    }

    // Idempotent by construction: leaving a room the socket never joined
    // (or has already left) is always a harmless success.
    const room = buildCanonicalRoom(roomType, resourceId);
    if (data.rooms.has(room)) {
      await client.leave(room);
      data.rooms.delete(room);
    }

    return { ok: true, room };
  }

  private async handleUnknownEvent(client: Socket): Promise<void> {
    const decision = await this.rateLimiter.consume(
      `ws:unknown-event:${client.id}`,
      this.config.rateLimits.unknownEvent.max,
      this.config.rateLimits.unknownEvent.windowSeconds,
      new Date(),
    );
    if (!decision.allowed) {
      client.disconnect(true);
    }
    // Otherwise: default-deny by simply never acting on it (§21 - "Unknown
    // client events must be default-denied").
  }

  private scheduleExpiryDisconnect(client: Socket, expiresAt: Date): void {
    const delayMs = Math.max(0, expiresAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      client.disconnect(true);
      this.expiryTimers.delete(client.id);
    }, delayMs);
    this.expiryTimers.set(client.id, timer);
  }
}

function extractHandshakeToken(client: Socket): string | undefined {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  const authToken = auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const headerValue = client.handshake.headers?.authorization;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 ? token : undefined;
  }

  return undefined;
}

function resolveSocketIp(client: Socket): string {
  const forwarded = client.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return client.handshake.address || 'unknown';
}

function extractRoomType(body: RoomSubscriptionRequest | null | undefined): RoomType | null {
  const roomType = body && typeof body === 'object' ? body.roomType : undefined;
  return isRoomType(roomType) ? roomType : null;
}

function extractResourceId(body: RoomSubscriptionRequest | null | undefined): string | null {
  const resourceId = body && typeof body === 'object' ? body.resourceId : undefined;
  return typeof resourceId === 'string' && resourceId.trim().length > 0 ? resourceId : null;
}
