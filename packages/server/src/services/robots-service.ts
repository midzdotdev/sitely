import { type RobotsChecker, parseRobotsTxt } from "@wapi/framework";
import { and, eq, gt } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { robotsTxtCache } from "../db/schema.js";
import type { Db } from "../types.js";

const ROBOTS_TTL_HOURS = 24;
const REDIS_PREFIX = "wapi:robots:";

/** In-memory cache for parsed robots.txt checkers. */
const checkerCache = new Map<string, { checker: RobotsChecker; expiresAt: number }>();

/**
 * Check if a URL is allowed by the site's robots.txt.
 * Fetches and caches robots.txt with a 24h TTL.
 */
export async function isAllowedByRobots(
	db: Db,
	redis: Redis,
	url: string,
	logger?: Logger,
): Promise<boolean> {
	const parsed = new URL(url);
	const domain = parsed.hostname;
	const robotsUrl = `${parsed.protocol}//${domain}/robots.txt`;

	// Check in-memory cache
	const cached = checkerCache.get(domain);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.checker.isAllowed(url);
	}

	// Check Redis cache
	const redisKey = `${REDIS_PREFIX}${domain}`;
	let content = await redis.get(redisKey);

	if (content === null) {
		// Check Postgres
		const now = new Date();
		const [row] = await db
			.select({ content: robotsTxtCache.content })
			.from(robotsTxtCache)
			.where(and(eq(robotsTxtCache.domain, domain), gt(robotsTxtCache.expiresAt, now)))
			.limit(1);

		if (row) {
			content = row.content;
			// Warm Redis
			await redis.set(redisKey, content, "EX", ROBOTS_TTL_HOURS * 3600).catch(() => {});
		} else {
			// Fetch robots.txt from the site
			try {
				const response = await fetch(robotsUrl, {
					signal: AbortSignal.timeout(10_000),
					headers: { "User-Agent": "WapiBot/1.0" },
				});
				content = response.ok ? await response.text() : "";
			} catch (err) {
				logger?.warn({ domain, err }, "Failed to fetch robots.txt, allowing all");
				content = "";
			}

			// Store in Postgres and Redis
			const expiresAt = new Date(Date.now() + ROBOTS_TTL_HOURS * 3600 * 1000);
			await db
				.insert(robotsTxtCache)
				.values({ domain, content, expiresAt })
				.onConflictDoUpdate({
					target: robotsTxtCache.domain,
					set: { content, fetchedAt: new Date(), expiresAt },
				})
				.catch(() => {});
			await redis.set(redisKey, content, "EX", ROBOTS_TTL_HOURS * 3600).catch(() => {});
		}
	}

	const checker = parseRobotsTxt(robotsUrl, content);
	checkerCache.set(domain, {
		checker,
		expiresAt: Date.now() + ROBOTS_TTL_HOURS * 3600 * 1000,
	});

	return checker.isAllowed(url);
}
