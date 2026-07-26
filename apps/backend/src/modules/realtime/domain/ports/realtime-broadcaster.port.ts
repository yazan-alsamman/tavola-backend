import { RealtimeEnvelope } from '../../application/realtime-envelope';

/**
 * Phase 8 §2/§20 — implemented by a Socket.IO adapter living inside
 * `RealtimeModule` (`server.to(room).emit(...)`). Cross-instance fan-out is
 * exclusively the existing Redis Socket.IO adapter (ADR-015, already wired in
 * main.ts) - this port has no Redis awareness of its own and must not gain
 * any; it only ever talks to the local Socket.IO `Server` instance, which the
 * Redis adapter transparently makes cross-instance.
 */
export interface RealtimeBroadcasterPort {
  broadcast(rooms: readonly string[], envelope: RealtimeEnvelope): Promise<void>;
}

export const REALTIME_BROADCASTER = Symbol('REALTIME_BROADCASTER');
