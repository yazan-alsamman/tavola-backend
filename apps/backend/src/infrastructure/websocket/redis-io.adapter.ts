import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';

/**
 * ADR-015: without this, Socket.IO only broadcasts to clients connected to
 * the same process, which silently breaks the moment a second API instance
 * runs. Wired directly in main.ts (`app.useWebSocketAdapter`) rather than as
 * a NestJS module, since there is no @WebSocketGateway yet for a module to
 * register - no business module (Phase 8) exists to emit anything over it.
 * This class is the one piece of that future module that's genuinely
 * useful to have ready now.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(url: string, db: number): void {
    const pubClient = new Redis(url, { db });
    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);

    if (!this.adapterConstructor) {
      throw new Error('RedisIoAdapter.connectToRedis() must be called before createIOServer().');
    }

    server.adapter(this.adapterConstructor);
    return server;
  }
}
