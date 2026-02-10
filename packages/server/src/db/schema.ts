/**
 * Drizzle ORM schema for WAPI database.
 * Matches the ERD from the architecture plan.
 */
import {
	pgTable,
	uuid,
	text,
	timestamp,
	bigint,
	integer,
	jsonb,
	primaryKey,
} from "drizzle-orm/pg-core";

// ── Consumers ──────────────────────────────────────────────────────

export const consumers = pgTable("consumers", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").unique().notNull(),
	name: text("name"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── API Keys ───────────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
	id: uuid("id").primaryKey().defaultRandom(),
	consumerId: uuid("consumer_id")
		.references(() => consumers.id)
		.notNull(),
	keyHash: text("key_hash").unique().notNull(),
	label: text("label"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	revokedAt: timestamp("revoked_at"),
	lastUsedAt: timestamp("last_used_at"),
});

// ── Consumer Balances ──────────────────────────────────────────────

export const consumerBalances = pgTable("consumer_balances", {
	consumerId: uuid("consumer_id")
		.primaryKey()
		.references(() => consumers.id),
	tokenBalance: bigint("token_balance", { mode: "number" }).notNull().default(10000),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Cached Resources ───────────────────────────────────────────────

export const cachedResources = pgTable("cached_resources", {
	id: uuid("id").primaryKey().defaultRandom(),
	siteDomain: text("site_domain").notNull(),
	resourceType: text("resource_type").notNull(),
	paramsHash: text("params_hash").notNull(),
	params: jsonb("params"),
	data: jsonb("data"),
	normalizedUrl: text("normalized_url").unique().notNull(),
	dataSizeBytes: integer("data_size_bytes"),
	extractionStatus: text("extraction_status").notNull(), // success | blocked | stale | error
	fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
	expiresAt: timestamp("expires_at").notNull(),
});

// ── Usage Logs ─────────────────────────────────────────────────────

export const usageLogs = pgTable("usage_logs", {
	id: uuid("id").primaryKey().defaultRandom(),
	consumerId: uuid("consumer_id")
		.references(() => consumers.id)
		.notNull(),
	apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
	operation: text("operation").notNull(),
	siteDomain: text("site_domain"),
	resourceType: text("resource_type"),
	tokensEstimated: integer("tokens_estimated").notNull(),
	tokensActual: integer("tokens_actual"),
	dataBytes: integer("data_bytes"),
	status: text("status").notNull(),
	idempotencyKey: text("idempotency_key"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── robots.txt Cache ───────────────────────────────────────────────

export const robotsTxtCache = pgTable("robots_txt_cache", {
	domain: text("domain").primaryKey(),
	content: text("content").notNull(),
	fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
	expiresAt: timestamp("expires_at").notNull(),
});

// ── Resource Popularity ────────────────────────────────────────────

export const resourcePopularity = pgTable(
	"resource_popularity",
	{
		siteDomain: text("site_domain").notNull(),
		resourceType: text("resource_type").notNull(),
		paramsHash: text("params_hash").notNull(),
		requestCount24h: integer("request_count_24h").default(0).notNull(),
		requestCount7d: integer("request_count_7d").default(0).notNull(),
		tier: text("tier").default("on-demand").notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [primaryKey({ columns: [table.siteDomain, table.resourceType, table.paramsHash] })],
);
