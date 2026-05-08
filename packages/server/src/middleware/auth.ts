import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { apiKeys } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const API_KEY_PREFIX = "sitely_sk_";

/** Synthetic IDs used when the dev API key bypasses normal auth. */
const DEV_CONSUMER_ID = "00000000-0000-0000-0000-000000000000";
const DEV_API_KEY_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Hash an API key using SHA-256 for storage/lookup.
 */
export function hashApiKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/**
 * Auth middleware that validates Bearer token API keys.
 * Sets c.set("consumerId", ...) and c.set("apiKeyId", ...) on success.
 *
 * If `SITELY_DEV_API_KEY` is set, any request bearing that exact key
 * skips the database entirely and authenticates as a synthetic dev consumer.
 */
export function authMiddleware() {
	const devKey = process.env.SITELY_DEV_API_KEY?.trim() || null;

	return async (c: Context<AppEnv>, next: Next) => {
		const authHeader = c.req.header("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Missing or invalid Authorization header. Expected: Bearer sitely_sk_...",
						status: 401,
					},
				},
				401,
			);
		}

		const key = authHeader.slice(7).trim();

		// --- Dev key fast-path: bypass DB lookup entirely ---
		if (devKey && key === devKey) {
			c.set("consumerId", DEV_CONSUMER_ID);
			c.set("apiKeyId", DEV_API_KEY_ID);
			return next();
		}

		if (!key.startsWith(API_KEY_PREFIX)) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Invalid API key format. Expected prefix: sitely_sk_",
						status: 401,
					},
				},
				401,
			);
		}

		const keyHash = hashApiKey(key);
		const db = c.get("db");

		const [row] = await db
			.select({
				keyId: apiKeys.id,
				consumerId: apiKeys.consumerId,
				revokedAt: apiKeys.revokedAt,
			})
			.from(apiKeys)
			.where(eq(apiKeys.keyHash, keyHash))
			.limit(1);

		if (!row) {
			return c.json(
				{ error: { code: "unauthorized", message: "Invalid API key", status: 401 } },
				401,
			);
		}

		if (row.revokedAt) {
			return c.json(
				{
					error: { code: "unauthorized", message: "API key has been revoked", status: 401 },
				},
				401,
			);
		}

		// Update last_used_at (fire and forget)
		db.update(apiKeys)
			.set({ lastUsedAt: new Date() })
			.where(eq(apiKeys.id, row.keyId))
			.then(() => {})
			.catch(() => {});

		c.set("consumerId", row.consumerId);
		c.set("apiKeyId", row.keyId);

		await next();
	};
}
