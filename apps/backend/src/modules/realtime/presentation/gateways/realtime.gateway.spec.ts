import { ConfigService } from '@nestjs/config';
import {
  RateLimitDecision,
  RateLimiterPort,
} from '@modules/authentication/domain/services/rate-limiter.port';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InvalidAccessTokenException } from '@modules/authentication/application/exceptions/access-token.exceptions';
import { WsAuthenticationService } from '../../application/ws-authentication.service';
import { RoomAuthorizationService } from '../../application/room-authorization.service';
import { SocketIoRealtimeBroadcaster } from '../../infrastructure/socket-io-realtime-broadcaster';
import { RoomType } from '../../application/room';
import { RealtimeGateway } from './realtime.gateway';

const userId = '11111111-1111-4111-8111-111111111111';
const reservationId = '22222222-2222-4222-8222-222222222222';

class FakeSocket {
  id = 'socket-1';
  data: Record<string, unknown> = {};
  disconnected = false;
  joinedRooms = new Set<string>();
  private anyHandler: ((event: string) => void) | null = null;
  handshake: {
    auth: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    address: string;
  };

  constructor(
    overrides: Partial<{
      auth: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
      address: string;
    }> = {},
  ) {
    this.handshake = {
      auth: overrides.auth ?? {},
      headers: overrides.headers ?? {},
      address: overrides.address ?? '203.0.113.5',
    };
  }

  async join(room: string): Promise<void> {
    this.joinedRooms.add(room);
  }

  async leave(room: string): Promise<void> {
    this.joinedRooms.delete(room);
  }

  disconnect(_close?: boolean): void {
    this.disconnected = true;
  }

  onAny(handler: (event: string) => void): void {
    this.anyHandler = handler;
  }

  emitUnregisteredEvent(eventName: string): void {
    this.anyHandler?.(eventName);
  }
}

class AllowAllRateLimiter implements RateLimiterPort {
  readonly calls: Array<{ key: string; limit: number; windowSeconds: number }> = [];
  private readonly deniedKeyPrefixes = new Set<string>();

  denyKeyPrefix(prefix: string): void {
    this.deniedKeyPrefixes.add(prefix);
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    this.calls.push({ key, limit, windowSeconds });
    const denied = [...this.deniedKeyPrefixes].some((prefix) => key.startsWith(prefix));
    return {
      allowed: !denied,
      remaining: denied ? 0 : limit - 1,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
    };
  }
}

function buildConfigService() {
  return {
    get: () => ({
      maxRoomsPerSocket: 2,
      rateLimits: {
        handshake: { max: 20, windowSeconds: 60 },
        subscribe: { max: 60, windowSeconds: 60 },
        unsubscribe: { max: 60, windowSeconds: 60 },
        unknownEvent: { max: 3, windowSeconds: 60 },
      },
    }),
  } as unknown as ConfigService;
}

function buildGateway(options: {
  wsAuthentication?: Partial<WsAuthenticationService>;
  roomAuthorization?: Partial<RoomAuthorizationService>;
  rateLimiter?: RateLimiterPort;
  configService?: ConfigService;
}) {
  const rateLimiter = options.rateLimiter ?? new AllowAllRateLimiter();
  const wsAuthentication = (options.wsAuthentication ?? {
    authenticate: async () => ({
      actor: {
        actorType: AccessTokenActorType.User,
        userId,
        sessionId: 'session-1',
        sessionVersion: 1,
        tokenFamilyId: 'family-1',
      },
      expiresAt: null,
    }),
  }) as unknown as WsAuthenticationService;
  const roomAuthorization = (options.roomAuthorization ?? {
    authorize: async () => `reservation:${reservationId}`,
  }) as unknown as RoomAuthorizationService;
  const broadcaster = new SocketIoRealtimeBroadcaster();

  const gateway = new RealtimeGateway(
    wsAuthentication,
    roomAuthorization,
    broadcaster,
    rateLimiter,
    options.configService ?? buildConfigService(),
  );
  return { gateway, rateLimiter };
}

/**
 * Mirrors what `afterInit`'s `server.use((socket, next) => ...)` middleware
 * registration does, without a real Socket.IO `Server` - drives
 * `authenticateSocket` directly with a Promise-wrapping `next`, exactly the
 * shape Socket.IO itself calls middleware with.
 */
function connect(gateway: RealtimeGateway, socket: FakeSocket): Promise<Error | undefined> {
  return new Promise((resolve) => {
    void gateway.authenticateSocket(socket as never, (err?: Error) => resolve(err));
  });
}

describe('RealtimeGateway', () => {
  describe('authenticateSocket (handshake middleware)', () => {
    it('authenticates via handshake.auth.token and stores the actor on the socket', async () => {
      const { gateway } = buildGateway({});
      const socket = new FakeSocket({ auth: { token: 'valid-token' } });

      const error = await connect(gateway, socket);

      expect(error).toBeUndefined();
      expect(socket.disconnected).toBe(false);
      expect((socket.data as { actor?: unknown }).actor).toMatchObject({ userId });
    });

    it('auto-joins a User actor to its own user:{userId} room at handshake time (Phase 19.9, ADR-037)', async () => {
      const { gateway } = buildGateway({});
      const socket = new FakeSocket({ auth: { token: 'valid-token' } });

      await connect(gateway, socket);

      expect(socket.joinedRooms.has(`user:${userId}`)).toBe(true);
      expect((socket.data as { rooms: Set<string> }).rooms.has(`user:${userId}`)).toBe(true);
    });

    it('does not auto-join an Employee/OrganizationMember actor to any user room (no Notification recipient of that actor type exists)', async () => {
      const { gateway } = buildGateway({
        wsAuthentication: {
          authenticate: async () => ({
            actor: {
              actorType: AccessTokenActorType.Employee,
              userId,
              sessionId: 's',
              sessionVersion: 1,
              tokenFamilyId: 'f',
              employeeId: 'employee-1',
              organizationId: 'org-1',
              restaurantId: 'restaurant-1',
              branchIds: [],
              permissions: [],
              permissionsVersion: 1,
            },
            expiresAt: null,
          }),
        },
      });
      const socket = new FakeSocket({ auth: { token: 'valid-token' } });

      await connect(gateway, socket);

      expect(socket.joinedRooms.size).toBe(0);
    });

    it('authenticates via an Authorization: Bearer header when present', async () => {
      let receivedToken: string | undefined;
      const { gateway } = buildGateway({
        wsAuthentication: {
          authenticate: async (token) => {
            receivedToken = token ?? undefined;
            return {
              actor: {
                actorType: AccessTokenActorType.User,
                userId,
                sessionId: 's',
                sessionVersion: 1,
                tokenFamilyId: 'f',
              },
              expiresAt: null,
            };
          },
        },
      });
      const socket = new FakeSocket({ headers: { authorization: 'Bearer header-token' } });

      const error = await connect(gateway, socket);

      expect(receivedToken).toBe('header-token');
      expect(error).toBeUndefined();
    });

    it('never accepts a token from the query string - only handshake.auth.token or the Authorization header', async () => {
      let receivedToken: string | undefined | null = 'sentinel';
      const { gateway } = buildGateway({
        wsAuthentication: {
          authenticate: async (token) => {
            receivedToken = token;
            throw new InvalidAccessTokenException();
          },
        },
      });
      // Simulates a client that only put the token in `?token=...` (never read by extractHandshakeToken).
      const socket = new FakeSocket({ auth: {}, headers: {} });

      const error = await connect(gateway, socket);

      expect(receivedToken).toBeUndefined();
      expect(error).toBeInstanceOf(Error);
    });

    it('rejects (next(error)) on an invalid token, never attaching actor data', async () => {
      const { gateway } = buildGateway({
        wsAuthentication: {
          authenticate: async () => {
            throw new InvalidAccessTokenException();
          },
        },
      });
      const socket = new FakeSocket({ auth: { token: 'bad' } });

      const error = await connect(gateway, socket);

      expect(error).toBeInstanceOf(Error);
      expect(socket.data.actor).toBeUndefined();
    });

    it('rejects (next(error)) on an expired token', async () => {
      const { gateway } = buildGateway({
        wsAuthentication: {
          authenticate: async () => {
            throw new (class ExpiredForTest extends Error {})();
          },
        },
      });
      const socket = new FakeSocket({ auth: { token: 'expired' } });

      const error = await connect(gateway, socket);

      expect(error).toBeInstanceOf(Error);
    });

    it('rejects immediately when the handshake rate limit is exceeded, without attempting authentication', async () => {
      let authenticateCalled = false;
      const rateLimiter = new AllowAllRateLimiter();
      rateLimiter.denyKeyPrefix('ws:handshake:');
      const { gateway } = buildGateway({
        rateLimiter,
        wsAuthentication: {
          authenticate: async () => {
            authenticateCalled = true;
            return {
              actor: {
                actorType: AccessTokenActorType.User,
                userId,
                sessionId: 's',
                sessionVersion: 1,
                tokenFamilyId: 'f',
              },
              expiresAt: null,
            };
          },
        },
      });
      const socket = new FakeSocket({ auth: { token: 'valid' } });

      const error = await connect(gateway, socket);

      expect(authenticateCalled).toBe(false);
      expect(error).toBeInstanceOf(Error);
    });

    it('schedules a disconnect at the JWT exp and clears the timer on handleDisconnect', async () => {
      jest.useFakeTimers();
      try {
        const expiresAt = new Date(Date.now() + 5000);
        const { gateway } = buildGateway({
          wsAuthentication: {
            authenticate: async () => ({
              actor: {
                actorType: AccessTokenActorType.User,
                userId,
                sessionId: 's',
                sessionVersion: 1,
                tokenFamilyId: 'f',
              },
              expiresAt,
            }),
          },
        });
        const socket = new FakeSocket({ auth: { token: 'valid' } });

        await connect(gateway, socket);
        expect(socket.disconnected).toBe(false);

        jest.advanceTimersByTime(5001);
        expect(socket.disconnected).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not fire the exp-disconnect timer after handleDisconnect already cleaned it up', async () => {
      jest.useFakeTimers();
      try {
        const expiresAt = new Date(Date.now() + 5000);
        const { gateway } = buildGateway({
          wsAuthentication: {
            authenticate: async () => ({
              actor: {
                actorType: AccessTokenActorType.User,
                userId,
                sessionId: 's',
                sessionVersion: 1,
                tokenFamilyId: 'f',
              },
              expiresAt,
            }),
          },
        });
        const socket = new FakeSocket({ auth: { token: 'valid' } });
        await connect(gateway, socket);

        socket.disconnected = false; // simulate a normal disconnect having already happened
        gateway.handleDisconnect(socket as never);
        jest.advanceTimersByTime(10000);

        expect(socket.disconnected).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('room.subscribe', () => {
    async function connectedSocket(gateway: RealtimeGateway) {
      const socket = new FakeSocket({ auth: { token: 'valid' } });
      await connect(gateway, socket);
      return socket;
    }

    it('rejects an unknown room type', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleSubscribe(socket as never, {
        roomType: 'waitlist',
        resourceId: reservationId,
      });

      expect(ack).toMatchObject({ ok: false, code: 'UNKNOWN_ROOM_TYPE' });
    });

    it('rejects a malformed resource id', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: 'not-a-uuid',
      });

      expect(ack).toMatchObject({ ok: false, code: 'INVALID_RESOURCE_ID' });
    });

    it('rejects when RoomAuthorizationService denies (FORBIDDEN, IDOR-safe generic code)', async () => {
      const { gateway } = buildGateway({ roomAuthorization: { authorize: async () => null } });
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    });

    it('joins the canonical room and acknowledges success when authorized', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(ack).toEqual({ ok: true, room: `reservation:${reservationId}` });
      expect(socket.joinedRooms.has(`reservation:${reservationId}`)).toBe(true);
    });

    it('is idempotent - subscribing to an already-joined room succeeds without re-counting toward the cap', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });
      const secondAck = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(secondAck).toEqual({ ok: true, room: `reservation:${reservationId}` });
      // 2, not 1: the connecting `User` actor auto-joins its own `user:{userId}`
      // room at handshake time (Phase 19.9, ADR-037) before this test's single
      // explicit `room.subscribe` call adds the reservation room.
      expect(socket.joinedRooms.size).toBe(2);
    });

    it('enforces the configured max-rooms-per-socket cap', async () => {
      let counter = 0;
      // maxRoomsPerSocket raised to 3 here (default test config is 2) so this
      // test's original "two explicit subscribes succeed, the third doesn't"
      // intent still holds now that the connecting `User` actor's auto-joined
      // `user:{userId}` room (Phase 19.9, ADR-037) already occupies one slot.
      const configService = {
        get: () => ({
          maxRoomsPerSocket: 3,
          rateLimits: {
            handshake: { max: 20, windowSeconds: 60 },
            subscribe: { max: 60, windowSeconds: 60 },
            unsubscribe: { max: 60, windowSeconds: 60 },
            unknownEvent: { max: 3, windowSeconds: 60 },
          },
        }),
      } as unknown as ConfigService;
      const { gateway } = buildGateway({
        configService,
        roomAuthorization: {
          authorize: async () => `reservation:room-${(counter += 1)}`,
        },
      });
      const socket = await connectedSocket(gateway);

      const first = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: '11111111-1111-4111-8111-111111111111',
      });
      const second = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: '22222222-2222-4222-8222-222222222222',
      });
      const third = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: '33333333-3333-4333-8333-333333333333',
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(third).toMatchObject({ ok: false, code: 'MAX_ROOMS_EXCEEDED' });
      expect(socket.joinedRooms.size).toBe(3);
    });

    it('rate-limits room.subscribe requests', async () => {
      const rateLimiter = new AllowAllRateLimiter();
      rateLimiter.denyKeyPrefix('ws:subscribe:');
      const { gateway } = buildGateway({ rateLimiter });
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(ack).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    });
  });

  describe('room.unsubscribe', () => {
    async function connectedSocket(gateway: RealtimeGateway) {
      const socket = new FakeSocket({ auth: { token: 'valid' } });
      await connect(gateway, socket);
      return socket;
    }

    it('is idempotent - unsubscribing from a room never joined still returns ok:true', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleUnsubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(ack).toEqual({ ok: true, room: `reservation:${reservationId}` });
    });

    it('leaves a joined room', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);
      await gateway.handleSubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      await gateway.handleUnsubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(socket.joinedRooms.has(`reservation:${reservationId}`)).toBe(false);
    });

    it('rejects an unknown room type', async () => {
      const { gateway } = buildGateway({});
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleUnsubscribe(socket as never, {
        roomType: 'notification',
        resourceId: reservationId,
      });

      expect(ack).toMatchObject({ ok: false, code: 'UNKNOWN_ROOM_TYPE' });
    });

    it('rate-limits room.unsubscribe requests', async () => {
      const rateLimiter = new AllowAllRateLimiter();
      rateLimiter.denyKeyPrefix('ws:unsubscribe:');
      const { gateway } = buildGateway({ rateLimiter });
      const socket = await connectedSocket(gateway);

      const ack = await gateway.handleUnsubscribe(socket as never, {
        roomType: RoomType.Reservation,
        resourceId: reservationId,
      });

      expect(ack).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    });
  });

  describe('unknown client events', () => {
    it('disconnects a socket that exceeds the unknown-event rate limit (default-deny)', async () => {
      const rateLimiter = new AllowAllRateLimiter();
      rateLimiter.denyKeyPrefix('ws:unknown-event:');
      const { gateway } = buildGateway({ rateLimiter });
      const socket = new FakeSocket({ auth: { token: 'valid' } });
      await connect(gateway, socket);

      socket.emitUnregisteredEvent('some.unregistered.event');
      await flushMicrotasks();

      expect(socket.disconnected).toBe(true);
    });

    it('does not disconnect for a single unknown event within the rate limit', async () => {
      const { gateway } = buildGateway({});
      const socket = new FakeSocket({ auth: { token: 'valid' } });
      await connect(gateway, socket);

      socket.emitUnregisteredEvent('some.unregistered.event');
      await flushMicrotasks();

      expect(socket.disconnected).toBe(false);
    });

    it('ignores room.subscribe/room.unsubscribe in the onAny unknown-event counter', async () => {
      const rateLimiter = new AllowAllRateLimiter();
      const { gateway } = buildGateway({ rateLimiter });
      const socket = new FakeSocket({ auth: { token: 'valid' } });
      await connect(gateway, socket);

      socket.emitUnregisteredEvent('room.subscribe');
      socket.emitUnregisteredEvent('room.unsubscribe');
      await flushMicrotasks();

      expect(rateLimiter.calls.some((call) => call.key.startsWith('ws:unknown-event:'))).toBe(
        false,
      );
    });
  });
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
