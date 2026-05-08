import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const consumers = pgTable("consumers", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	name: text("name"),
	tokenBalance: bigint("token_balance", { mode: "number" }).notNull().default(0),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		consumerId: uuid("consumer_id")
			.notNull()
			.references(() => consumers.id),
		keyHash: text("key_hash").notNull().unique(),
		label: text("label"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		revokedAt: timestamp("revoked_at"),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => [index("api_keys_consumer_id_idx").on(table.consumerId)],
);

export const cachedResources = pgTable(
	"cached_resources",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		siteDomain: text("site_domain").notNull(),
		resourceType: text("resource_type").notNull(),
		paramsHash: text("params_hash").notNull(),
		params: jsonb("params").$type<Record<string, string>>(),
		data: jsonb("data").$type<Record<string, unknown>>(),
		normalizedUrl: text("normalized_url").notNull().unique(),
		dataSizeBytes: integer("data_size_bytes").notNull().default(0),
		extractionStatus: text("extraction_status").notNull().default("success"),
		fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
		expiresAt: timestamp("expires_at").notNull(),
	},
	(table) => [
		index("cached_resources_lookup_idx").on(table.siteDomain, table.resourceType, table.paramsHash),
	],
);

export const usageLogs = pgTable(
	"usage_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		consumerId: uuid("consumer_id").references(() => consumers.id),
		apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
		operation: text("operation").notNull(),
		siteDomain: text("site_domain"),
		resourceType: text("resource_type"),
		tokensEstimated: integer("tokens_estimated").notNull().default(0),
		tokensActual: integer("tokens_actual").notNull().default(0),
		dataBytes: integer("data_bytes").notNull().default(0),
		status: text("status").notNull(),
		idempotencyKey: text("idempotency_key"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("usage_logs_consumer_id_idx").on(table.consumerId),
		index("usage_logs_idempotency_key_idx").on(table.idempotencyKey),
	],
);

export const robotsTxtCache = pgTable("robots_txt_cache", {
	domain: text("domain").primaryKey(),
	content: text("content").notNull(),
	fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
	expiresAt: timestamp("expires_at").notNull(),
});
