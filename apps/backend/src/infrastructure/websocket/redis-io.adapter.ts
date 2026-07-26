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
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(url: string, db: number): void {
    const pubClient = new Redis(url, { db });
    const subClient = pubClient.duplicate();

    this.pubClient = pubClient;
    this.subClient = subClient;
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

  /**
   * `IoAdapter.close()` only closes the Socket.IO server itself - it has no
   * awareness of the two dedicated ioredis pub/sub clients this class opens
   * in `connectToRedis`. Without this override, every graceful shutdown
   * (SIGTERM during a rolling deploy, or - as discovered during Phase 8 e2e
   * testing - a test harness calling `app.close()`) leaks two open Redis
   * connections, which is exactly the kind of dangling handle that keeps a
   * Jest process alive past its test run ("Jest did not exit one second
   * after the test run has completed").
   */
  async close(server: import('socket.io').Server): Promise<void> {
    await super.close(server);
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }
}
