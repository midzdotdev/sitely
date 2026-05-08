import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { authMiddleware } from "./middleware/auth.js";
import * as authService from "./services/auth-service.js";
import * as extractService from "./services/extract-service.js";
import { checkApiKeyRateLimit } from "./services/rate-limiter.js";
import type { AppEnv, Db } from "./types.js";

export function createApp(db: Db, redis: Redis, logger: Logger): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	// Global middleware
	app.use("*", cors());
	app.use("*", async (c, next) => {
		c.set("db", db);
		c.set("redis", redis);
		c.set("logger", logger);
		await next();
	});

	// ─── Health check ────────────────────────────────────────────────────
	app.get("/healthz", async (c) => {
		try {
			await redis.ping();
			// Quick DB check via a simple query
			return c.json({ status: "ok" });
		} catch {
			return c.json({ status: "unhealthy" }, 503);
		}
	});

	// ─── Auth routes (no auth required) ──────────────────────────────────
	app.post("/v1/auth/signup", async (c) => {
		const body = await c.req.json<{ email: string; name?: string }>().catch(() => null);
		if (!body?.email) {
			return c.json(
				{ error: { code: "bad_request", message: "email is required", status: 400 } },
				400,
			);
		}

		try {
			const result = await authService.signup(db, body.email, body.name);
			return c.json(result, 201);
		} catch (err) {
			if (err instanceof Error && err.message.includes("unique")) {
				return c.json(
					{
						error: {
							code: "conflict",
							message: "An account with this email already exists",
							status: 409,
						},
					},
					409,
				);
			}
			throw err;
		}
	});

	// ─── Protected routes ────────────────────────────────────────────────
	const api = new Hono<AppEnv>();

	api.use("*", async (c, next) => {
		c.set("db", db);
		c.set("redis", redis);
		c.set("logger", logger);
		await next();
	});
	api.use("*", authMiddleware());

	// Per-key rate limiting
	api.use("*", async (c, next) => {
		const apiKeyId = c.get("apiKeyId");
		const { allowed, remaining, resetMs } = await checkApiKeyRateLimit(redis, apiKeyId);

		c.header("X-RateLimit-Limit", "100");
		c.header("X-RateLimit-Remaining", String(remaining));
		c.header("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));

		if (!allowed) {
			c.header("Retry-After", String(Math.ceil(resetMs / 1000)));
			return c.json(
				{
					error: {
						code: "rate_limited",
						message: "Too many requests. Please retry after the Retry-After period.",
						status: 429,
					},
				},
				429,
			);
		}

		await next();
	});

	// Auth management
	api.post("/auth/keys", async (c) => {
		const body = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
		const result = await authService.createApiKey(db, c.get("consumerId"), body.label);
		return c.json(result, 201);
	});

	api.delete("/auth/keys/:id", async (c) => {
		const keyId = c.req.param("id");
		const revoked = await authService.revokeApiKey(db, c.get("consumerId"), keyId);
		if (!revoked) {
			return c.json(
				{ error: { code: "not_found", message: "API key not found", status: 404 } },
				404,
			);
		}
		return c.json({ revoked: true });
	});

	api.get("/auth/balance", async (c) => {
		const balance = await authService.getBalance(db, c.get("consumerId"));
		return c.json({ tokenBalance: balance });
	});

	api.get("/auth/usage", async (c) => {
		// TODO: query usage_logs with date filtering
		return c.json({ usage: [] });
	});

	// ─── Extraction routes ───────────────────────────────────────────────
	api.get("/extract", async (c) => {
		const url = c.req.query("url");
		if (!url) {
			return c.json(
				{ error: { code: "bad_request", message: "url query parameter is required", status: 400 } },
				400,
			);
		}

		try {
			new URL(url);
		} catch {
			return c.json({ error: { code: "bad_request", message: "Invalid URL", status: 400 } }, 400);
		}

		const opts: extractService.ExtractOpts = {
			fresh: c.req.query("fresh") === "true",
			maxPages: c.req.query("maxPages") ? Number(c.req.query("maxPages")) : undefined,
			cursor: c.req.query("cursor") ?? undefined,
		};

		const result = await extractService.extractFromUrl(
			db,
			redis,
			url,
			opts,
			{ consumerId: c.get("consumerId"), apiKeyId: c.get("apiKeyId") },
			logger,
		);

		const httpStatus =
			result.status === "forbidden_by_robots"
				? 403
				: result.status === "rate_limited"
					? 429
					: result.status === "error" && !result.data
						? 502
						: 200;

		return c.json(result, httpStatus);
	});

	// ─── Site discovery routes ───────────────────────────────────────────
	api.get("/sites", (c) => {
		return c.json({ sites: extractService.listSites() });
	});

	api.get("/sites/:domain", (c) => {
		const domain = c.req.param("domain");
		const sites = extractService.listSites();
		const site = sites.find((s) => s.domain === domain);
		if (!site) {
			return c.json(
				{ error: { code: "not_found", message: `No site definition for ${domain}`, status: 404 } },
				404,
			);
		}
		return c.json(site);
	});

	api.get("/sites/:domain/:resource", async (c) => {
		const domain = c.req.param("domain");
		const resource = c.req.param("resource");

		// Collect all non-system query params as resource params
		const params: Record<string, string> = {};
		const reservedKeys = new Set(["fresh", "maxPages", "cursor"]);
		for (const [key, value] of Object.entries(c.req.query())) {
			if (!reservedKeys.has(key) && typeof value === "string") {
				params[key] = value;
			}
		}

		const opts: extractService.ExtractOpts = {
			fresh: c.req.query("fresh") === "true",
			maxPages: c.req.query("maxPages") ? Number(c.req.query("maxPages")) : undefined,
			cursor: c.req.query("cursor") ?? undefined,
		};

		const result = await extractService.getResource(
			db,
			redis,
			domain,
			resource,
			params,
			opts,
			{ consumerId: c.get("consumerId"), apiKeyId: c.get("apiKeyId") },
			logger,
		);

		if (result.status === "error" && !result.data) {
			return c.json(
				{
					error: {
						code: "not_found",
						message: `Resource "${resource}" not found on ${domain}`,
						status: 404,
					},
				},
				404,
			);
		}

		return c.json(result);
	});

	// ─── Schema routes ───────────────────────────────────────────────────
	api.get("/schemas", (c) => {
		return c.json({ schemas: extractService.listSchemas() });
	});

	api.get("/schemas/:type/sites", (c) => {
		const schemaType = c.req.param("type");
		const sites = extractService.findSitesForSchema(schemaType);
		return c.json({ schemaType, sites });
	});

	// ─── Admin routes ────────────────────────────────────────────────────
	api.post("/admin/grant-tokens", async (c) => {
		const adminSecret = c.req.header("X-Admin-Secret");
		if (adminSecret !== process.env.ADMIN_SECRET) {
			return c.json(
				{ error: { code: "forbidden", message: "Invalid admin secret", status: 403 } },
				403,
			);
		}

		const body = await c.req.json<{ consumerId: string; amount: number }>().catch(() => null);
		if (!body?.consumerId || !body?.amount) {
			return c.json(
				{
					error: {
						code: "bad_request",
						message: "consumerId and amount are required",
						status: 400,
					},
				},
				400,
			);
		}

		const newBalance = await authService.grantTokens(db, body.consumerId, body.amount);
		return c.json({ consumerId: body.consumerId, newBalance });
	});

	// Mount protected routes under /v1
	app.route("/v1", api);

	// Global error handler
	app.onError((err, c) => {
		logger.error({ err, path: c.req.path }, "Unhandled error");
		return c.json(
			{ error: { code: "internal_error", message: "Internal server error", status: 500 } },
			500,
		);
	});

	return app;
}
