import { Redis } from 'ioredis';

/** BullMQ 需要 maxRetriesPerRequest: null */
export const createRedis = (url: string) =>
  new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
