import Redis from 'ioredis';
import { logger } from './logger.js';

let redisClient: Redis | null = null;

export function createRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('error', (error) => {
    logger.error({ err: error }, 'Redis error');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    return createRedisClient();
  }
  return redisClient;
}

// Session management helpers
export class SessionManager {
  private redis: Redis;
  private prefix: string;

  constructor(redis: Redis, prefix = 'session:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async get<T>(sessionId: string): Promise<T | null> {
    const data = await this.redis.get(this.key(sessionId));
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  async set<T>(sessionId: string, data: T, ttlSeconds = 3600): Promise<void> {
    await this.redis.setex(this.key(sessionId), ttlSeconds, JSON.stringify(data));
  }

  async update<T>(sessionId: string, updates: Partial<T>): Promise<T | null> {
    const existing = await this.get<T>(sessionId);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    const ttl = await this.redis.ttl(this.key(sessionId));
    await this.set(sessionId, updated, ttl > 0 ? ttl : 3600);
    return updated;
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  async exists(sessionId: string): Promise<boolean> {
    const result = await this.redis.exists(this.key(sessionId));
    return result === 1;
  }

  async extend(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(this.key(sessionId), ttlSeconds);
  }
}

// Call session cache
export class CallSessionCache {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getCallSession(callSid: string) {
    const data = await this.redis.get(`call:${callSid}`);
    return data ? JSON.parse(data) : null;
  }

  async setCallSession(callSid: string, session: any, ttlSeconds = 7200) {
    await this.redis.setex(`call:${callSid}`, ttlSeconds, JSON.stringify(session));
  }

  async updateTranscript(callSid: string, entry: { role: string; content: string; timestamp: number }) {
    const session = await this.getCallSession(callSid);
    if (!session) return;

    session.context.transcript.push(entry);
    session.lastActivityAt = Date.now();
    await this.setCallSession(callSid, session);
  }

  async deleteCallSession(callSid: string) {
    await this.redis.del(`call:${callSid}`);
  }
}

// Rate limiter helper
export class RateLimiter {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async checkLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const now = Date.now();
    const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

    const count = await this.redis.incr(windowKey);
    if (count === 1) {
      await this.redis.expire(windowKey, windowSeconds);
    }

    const ttl = await this.redis.ttl(windowKey);

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetIn: ttl,
    };
  }
}
