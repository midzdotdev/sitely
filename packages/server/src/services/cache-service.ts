/**
 * In-memory cache for MVP. Replace with Redis + Postgres for production.
 */

interface CacheEntry {
	data: unknown;
	normalizedUrl: string;
	siteDomain: string;
	resourceType: string;
	status: string;
	sizeBytes: number;
	fetchedAt: number;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Parse a TTL string like "5m", "1h", "24h" into milliseconds. */
export function parseTtl(ttl: string): number {
	const match = /^(\d+)\s*(s|m|h|d)$/.exec(ttl);
	if (!match) return 3600_000; // Default 1h
	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2];
	switch (unit) {
		case "s":
			return value * 1000;
		case "m":
			return value * 60_000;
		case "h":
			return value * 3_600_000;
		case "d":
			return value * 86_400_000;
		default:
			return 3_600_000;
	}
}

/**
 * Get a cached resource by normalized URL. Returns null if not found or expired.
 */
export function getCached(normalizedUrl: string): CacheEntry | null {
	const entry = cache.get(normalizedUrl);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		cache.delete(normalizedUrl);
		return null;
	}
	return entry;
}

/**
 * Store a resource in cache.
 */
export function setCached(
	normalizedUrl: string,
	entry: Omit<CacheEntry, "fetchedAt" | "expiresAt"> & { ttlMs: number },
): void {
	const now = Date.now();
	cache.set(normalizedUrl, {
		data: entry.data,
		normalizedUrl: entry.normalizedUrl,
		siteDomain: entry.siteDomain,
		resourceType: entry.resourceType,
		status: entry.status,
		sizeBytes: entry.sizeBytes,
		fetchedAt: now,
		expiresAt: now + entry.ttlMs,
	});
}
