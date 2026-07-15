import { registerAs } from '@nestjs/config';

/**
 * Three logically-separated database indexes on the same Redis deployment -
 * cache, BullMQ queues, and the Socket.IO Redis Adapter - kept isolated from
 * one another for observability, per ADR-004 and ADR-015.
 */
export default registerAs('redis', () => ({
  url: process.env.REDIS_URL,
  cacheDbIndex: parseInt(process.env.REDIS_CACHE_DB_INDEX ?? '0', 10),
  queueDbIndex: parseInt(process.env.REDIS_QUEUE_DB_INDEX ?? '1', 10),
  socketAdapterDbIndex: parseInt(process.env.REDIS_SOCKET_ADAPTER_DB_INDEX ?? '2', 10),
}));

export interface RedisConfig {
  url: string;
  cacheDbIndex: number;
  queueDbIndex: number;
  socketAdapterDbIndex: number;
}
