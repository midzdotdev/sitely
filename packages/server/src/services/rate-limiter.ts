import type { Redis } from "ioredis";

const RATE_LIMIT_PREFIX = "sitely:ratelimit:";
const SEMAPHORE_PREFIX = "sitely:sem:";

/**
 * Per-site rate limiter backed by Redis.
 * Uses a sliding window for request rate and a semaphore for concurrency.
 */
export class SiteRateLimiter {
	constructor(private readonly redis: Redis) {}

	/**
	 * Attempt to acquire a rate limit slot for a site.
	 * Returns true if the request can proceed, false if rate limited.
	 */
	async acquire(
		domain: string,
		maxConcurrent: number,
		requestsPerSecond: number,
	): Promise<boolean> {
		// Check sliding window rate
		const windowKey = `${RATE_LIMIT_PREFIX}${domain}`;
		const now = Date.now();
		const windowMs = 1000; // 1 second window

		const pipe = this.redis.pipeline();
		// Remove entries outside the window
		pipe.zremrangebyscore(windowKey, 0, now - windowMs);
		// Count entries in the window
		pipe.zcard(windowKey);
		// Add the new entry
		pipe.zadd(windowKey, now.toString(), `${now}:${Math.random()}`);
		pipe.pexpire(windowKey, windowMs * 2);

		const results = await pipe.exec();
		const currentCount = (results?.[1]?.[1] as number) ?? 0;

		if (currentCount >= requestsPerSecond) {
			// Remove the entry we just added
			await this.redis.zremrangebyscore(windowKey, now.toString(), now.toString());
			return false;
		}

		// Check concurrency semaphore
		const semKey = `${SEMAPHORE_PREFIX}${domain}`;
		const concurrent = await this.redis.incr(semKey);

		if (concurrent === 1) {
			// First acquisition, set expiry as safety net
			await this.redis.pexpire(semKey, 60_000);
		}

		if (concurrent > maxConcurrent) {
			await this.redis.decr(semKey);
			return false;
		}

		return true;
	}

	/**
	 * Release a concurrency slot after a request completes.
	 */
	async release(domain: string): Promise<void> {
		const semKey = `${SEMAPHORE_PREFIX}${domain}`;
		await this.redis.decr(semKey).catch(() => {});
	}
}

/**
 * Per-API-key rate limiter for consumer request limits.
 * Uses a Redis sliding window.
 */
export async function checkApiKeyRateLimit(
	redis: Redis,
	apiKeyId: string,
	maxPerMinute = 100,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
	const key = `sitely:apilimit:${apiKeyId}`;
	const now = Date.now();
	const windowMs = 60_000;

	const pipe = redis.pipeline();
	pipe.zremrangebyscore(key, 0, now - windowMs);
	pipe.zcard(key);
	pipe.zadd(key, now.toString(), `${now}:${Math.random()}`);
	pipe.pexpire(key, windowMs * 2);

	const results = await pipe.exec();
	const currentCount = (results?.[1]?.[1] as number) ?? 0;

	if (currentCount >= maxPerMinute) {
		return { allowed: false, remaining: 0, resetMs: windowMs };
	}

	return {
		allowed: true,
		remaining: maxPerMinute - currentCount - 1,
		resetMs: windowMs,
	};
}
