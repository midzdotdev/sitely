import { serve } from "@hono/node-server";
import type { SiteDefinition } from "@wapi/framework";
import { drizzle } from "drizzle-orm/postgres-js";
import { Redis } from "ioredis";
import pino from "pino";
import type { Logger } from "pino";
import postgres from "postgres";
import { createApp } from "./app.js";
import * as schema from "./db/schema.js";
import { registerSite } from "./site-loader.js";

async function main() {
	const logger = pino({
		level: process.env.LOG_LEVEL ?? "info",
	});

	const databaseUrl = process.env.DATABASE_URL ?? "postgres://wapi:wapi@localhost:5432/wapi";
	const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
	const port = Number.parseInt(process.env.PORT ?? "3000", 10);

	// Connect to databases
	const sql = postgres(databaseUrl);
	const db = drizzle(sql, { schema });
	const redis = new Redis(redisUrl);

	redis.on("error", (err: unknown) => logger.error({ err }, "Redis connection error"));

	// Push schema to DB (in production, use migrations)
	logger.info("Pushing database schema...");
	try {
		await sql`
			CREATE TABLE IF NOT EXISTS consumers (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				email TEXT NOT NULL UNIQUE,
				name TEXT,
				token_balance BIGINT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`;
		await sql`
			CREATE TABLE IF NOT EXISTS api_keys (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				consumer_id UUID NOT NULL REFERENCES consumers(id),
				key_hash TEXT NOT NULL UNIQUE,
				label TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				revoked_at TIMESTAMPTZ,
				last_used_at TIMESTAMPTZ
			)
		`;
		await sql`CREATE INDEX IF NOT EXISTS api_keys_consumer_id_idx ON api_keys(consumer_id)`;
		await sql`
			CREATE TABLE IF NOT EXISTS cached_resources (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				site_domain TEXT NOT NULL,
				resource_type TEXT NOT NULL,
				params_hash TEXT NOT NULL,
				params JSONB,
				data JSONB,
				normalized_url TEXT NOT NULL UNIQUE,
				data_size_bytes INTEGER NOT NULL DEFAULT 0,
				extraction_status TEXT NOT NULL DEFAULT 'success',
				fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ NOT NULL
			)
		`;
		await sql`CREATE INDEX IF NOT EXISTS cached_resources_lookup_idx ON cached_resources(site_domain, resource_type, params_hash)`;
		await sql`
			CREATE TABLE IF NOT EXISTS usage_logs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				consumer_id UUID REFERENCES consumers(id),
				api_key_id UUID REFERENCES api_keys(id),
				operation TEXT NOT NULL,
				site_domain TEXT,
				resource_type TEXT,
				tokens_estimated INTEGER NOT NULL DEFAULT 0,
				tokens_actual INTEGER NOT NULL DEFAULT 0,
				data_bytes INTEGER NOT NULL DEFAULT 0,
				status TEXT NOT NULL,
				idempotency_key TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`;
		await sql`CREATE INDEX IF NOT EXISTS usage_logs_consumer_id_idx ON usage_logs(consumer_id)`;
		await sql`CREATE INDEX IF NOT EXISTS usage_logs_idempotency_key_idx ON usage_logs(idempotency_key)`;
		await sql`
			CREATE TABLE IF NOT EXISTS robots_txt_cache (
				domain TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ NOT NULL
			)
		`;
		logger.info("Database schema ready");
	} catch (err) {
		logger.error({ err }, "Failed to push database schema");
		process.exit(1);
	}

	// Load site definitions
	try {
		const siteModules = await loadSiteDefinitions(logger);
		for (const site of siteModules) {
			registerSite(site, logger);
		}
		logger.info({ count: siteModules.length }, "Site definitions loaded");
	} catch (err) {
		logger.warn({ err }, "Failed to load site definitions, starting with fallback-only mode");
	}

	// Create and start the app
	const app = createApp(db, redis, logger);

	const server = serve({ fetch: app.fetch, port }, (info) => {
		logger.info({ port: info.port }, "WAPI server started");
	});

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down gracefully...");
		server.close(() => {
			logger.info("HTTP server closed");
		});

		// Give in-flight requests 10s to complete
		await new Promise((resolve) => setTimeout(resolve, 10_000));

		await redis.quit().catch(() => {});
		await sql.end().catch(() => {});
		logger.info("Connections closed. Exiting.");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}

async function loadSiteDefinitions(logger: Logger): Promise<SiteDefinition[]> {
	const sites: SiteDefinition[] = [];

	// Dynamic imports for site definitions
	const siteImports: Array<() => Promise<{ default: SiteDefinition }>> = [
		// @ts-expect-error - resolved at runtime from built output
		() => import("../../sites/en.wikipedia.org/dist/index.js"),
		// @ts-expect-error - resolved at runtime from built output
		() => import("../../sites/news.ycombinator.com/dist/index.js"),
	];

	for (const importFn of siteImports) {
		try {
			const mod = await importFn();
			const site = mod.default ?? mod;
			sites.push(site);
		} catch (err) {
			logger.warn({ err }, "Failed to load a site definition");
		}
	}

	return sites;
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
