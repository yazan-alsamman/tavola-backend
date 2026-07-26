import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { RealtimeBroadcasterPort } from '../domain/ports/realtime-broadcaster.port';
import { RealtimeEnvelope } from '../application/realtime-envelope';
import { REALTIME_CHANNEL } from '../application/realtime-event-mapping';

/**
 * Phase 8 §2 — the sole `RealtimeBroadcasterPort` implementation. Holds no
 * `Server` reference of its own at construction time (the Gateway, not this
 * class, owns `@WebSocketServer()` and is only instantiated once Nest wires
 * the WebSocket adapter); `RealtimeGateway.afterInit` calls `setServer` the
 * moment Nest hands it a live `Server`, before any client can possibly have
 * connected yet. `broadcast` is a deliberate no-op (logged, not thrown) if
 * called before that happens - matches this port's own "best-effort, never
 * break the caller" contract (Phase 8 §3).
 */
@Injectable()
export class SocketIoRealtimeBroadcaster implements RealtimeBroadcasterPort {
  private readonly logger = new Logger(SocketIoRealtimeBroadcaster.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  async broadcast(rooms: readonly string[], envelope: RealtimeEnvelope): Promise<void> {
    if (rooms.length === 0) {
      return;
    }
    if (!this.server) {
      this.logger.warn(
        `Dropped realtime broadcast for ${envelope.eventType} (${envelope.eventId}) - Socket.IO server not yet initialized.`,
      );
      return;
    }
    this.server.to(rooms as string[]).emit(REALTIME_CHANNEL, envelope);
  }
}
