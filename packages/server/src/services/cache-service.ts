import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Redis } from "ioredis";
import { cachedResources } from "../db/schema.js";
import type { Db } from "../types.js";

export interface CachedResource {
	data: Record<string, unknown>;
	extractionStatus: string;
	fetchedAt: Date;
	dataSizeBytes: number;
}

export interface CacheSetOptions {
	siteDomain: string;
	resourceType: string;
	params: Record<string, string>;
	normalizedUrl: string;
	data: Record<string, unknown>;
	extractionStatus: string;
	ttlSeconds: number;
}

const REDIS_CACHE_PREFIX = "sitely:cache:";

/**
 * Create a deterministic hash of sorted params for cache lookup.
 */
export function hashParams(params: Record<string, string>): string {
	const sorted = Object.keys(params)
		.sort()
		.map((k) => `${k}=${params[k]}`)
		.join("&");
	return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

/**
 * Look up a cached resource by normalized URL.
 * Checks Redis hot cache first, then falls back to Postgres.
 */
export async function cacheGet(
	db: Db,
	redis: Redis,
	normalizedUrl: string,
): Promise<CachedResource | null> {
	// Check Redis hot cache first
	const redisKey = `${REDIS_CACHE_PREFIX}${normalizedUrl}`;
	const cached = await redis.get(redisKey);
	if (cached) {
		try {
			return JSON.parse(cached) as CachedResource;
		} catch {
			// Corrupted cache entry, fall through to Postgres
		}
	}

	// Check Postgres
	const now = new Date();
	const [row] = await db
		.select({
			data: cachedResources.data,
			extractionStatus: cachedResources.extractionStatus,
			fetchedAt: cachedResources.fetchedAt,
			dataSizeBytes: cachedResources.dataSizeBytes,
		})
		.from(cachedResources)
		.where(
			and(eq(cachedResources.normalizedUrl, normalizedUrl), gt(cachedResources.expiresAt, now)),
		)
		.limit(1);

	if (!row?.data) return null;

	const result: CachedResource = {
		data: row.data,
		extractionStatus: row.extractionStatus,
		fetchedAt: row.fetchedAt,
		dataSizeBytes: row.dataSizeBytes,
	};

	// Warm the Redis hot cache
	const pgRow = await db
		.select({ expiresAt: cachedResources.expiresAt })
		.from(cachedResources)
		.where(eq(cachedResources.normalizedUrl, normalizedUrl))
		.limit(1);

	if (pgRow[0]) {
		const ttlMs = pgRow[0].expiresAt.getTime() - now.getTime();
		if (ttlMs > 0) {
			await redis.set(redisKey, JSON.stringify(result), "PX", ttlMs).catch(() => {});
		}
	}

	return result;
}

/**
 * Look up a stale cached resource (expired but still in Postgres).
 * Used as fallback when live scrape fails.
 */
export async function cacheGetStale(db: Db, normalizedUrl: string): Promise<CachedResource | null> {
	const [row] = await db
		.select({
			data: cachedResources.data,
			extractionStatus: cachedResources.extractionStatus,
			fetchedAt: cachedResources.fetchedAt,
			dataSizeBytes: cachedResources.dataSizeBytes,
		})
		.from(cachedResources)
		.where(eq(cachedResources.normalizedUrl, normalizedUrl))
		.limit(1);

	if (!row?.data) return null;

	return {
		data: row.data,
		extractionStatus: row.extractionStatus,
		fetchedAt: row.fetchedAt,
		dataSizeBytes: row.dataSizeBytes,
	};
}

/**
 * Store a resource in both Redis and Postgres cache.
 */
export async function cacheSet(db: Db, redis: Redis, opts: CacheSetOptions): Promise<void> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + opts.ttlSeconds * 1000);
	const dataSizeBytes = Buffer.byteLength(JSON.stringify(opts.data));
	const paramsHash = hashParams(opts.params);

	// Upsert into Postgres
	await db
		.insert(cachedResources)
		.values({
			siteDomain: opts.siteDomain,
			resourceType: opts.resourceType,
			paramsHash,
			params: opts.params,
			data: opts.data,
			normalizedUrl: opts.normalizedUrl,
			dataSizeBytes,
			extractionStatus: opts.extractionStatus,
			fetchedAt: now,
			expiresAt,
		})
		.onConflictDoUpdate({
			target: cachedResources.normalizedUrl,
			set: {
				data: opts.data,
				dataSizeBytes,
				extractionStatus: opts.extractionStatus,
				fetchedAt: now,
				expiresAt,
			},
		});

	// Set in Redis hot cache
	const redisKey = `${REDIS_CACHE_PREFIX}${opts.normalizedUrl}`;
	const cacheValue: CachedResource = {
		data: opts.data,
		extractionStatus: opts.extractionStatus,
		fetchedAt: now,
		dataSizeBytes,
	};
	await redis.set(redisKey, JSON.stringify(cacheValue), "EX", opts.ttlSeconds).catch(() => {});
}
