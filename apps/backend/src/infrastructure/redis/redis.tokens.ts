/**
 * DI tokens for the three logically-separated Redis connections (ADR-004,
 * ADR-015). Only the cache client is provided by RedisModule itself - the
 * queue connection is configured by BullMQModule and the Socket.IO adapter
 * connection by WebSocketModule, each against its own db index, so that a
 * module only depends on the connection it actually uses.
 */
export const REDIS_CACHE_CLIENT = Symbol('REDIS_CACHE_CLIENT');
