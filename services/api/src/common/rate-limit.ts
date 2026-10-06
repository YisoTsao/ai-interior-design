import type { Redis } from 'ioredis';

/**
 * Redis token bucket（04 §3）。原子 Lua：依經過時間補充 token，足夠則扣 1。
 * 回傳 [allowed(0/1), 剩餘 token, 需等待秒數]。
 */
const LUA = `
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local s = redis.call('HMGET', key, 't', 'ts')
local tokens = tonumber(s[1]) or cap
local ts = tonumber(s[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - ts) * rate)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = (1 - tokens) / rate
end
redis.call('HSET', key, 't', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(cap / rate) + 1)
return {allowed, tostring(tokens), tostring(wait)}
`;

export class TokenBucket {
  constructor(private readonly redis: Redis) {}
  async take(key: string, capacity: number, refillPerSec: number) {
    const [allowed, left, wait] = (await this.redis.eval(
      LUA,
      1,
      `rl:${key}`,
      capacity,
      refillPerSec,
      Date.now() / 1000,
    )) as [number, string, string];
    return {
      allowed: allowed === 1,
      remaining: Math.floor(Number(left)),
      retryAfterSec: Math.ceil(Number(wait)),
    };
  }
}
