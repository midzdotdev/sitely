import { randomBytes, randomUUID } from "node:crypto";
import type { SiteDefinition } from "@wapi/framework";
import type { Redis } from "ioredis";
import pino from "pino";
import { createApp } from "../app.js";
import { hashApiKey } from "../middleware/auth.js";
import { registerSite } from "../site-loader.js";
import type { Db } from "../types.js";

// ─── In-memory Redis mock ────────────────────────────────────────────────────

interface RedisEntry {
	value: string;
	expiresAt: number | null;
}

/**
 * Create an in-memory Redis mock that supports the subset of commands
 * used by the WAPI server (get, set, del, ping, pipeline, incr, decr,
 * zadd, zcard, zremrangebyscore, pexpire).
 */
export function createMockRedis(): Redis {
	const store = new Map<string, RedisEntry>();
	const sortedSets = new Map<string, Map<string, number>>();

	function isExpired(entry: RedisEntry): boolean {
		return entry.expiresAt !== null && Date.now() > entry.expiresAt;
	}

	function getEntry(key: string): RedisEntry | undefined {
		const entry = store.get(key);
		if (entry && isExpired(entry)) {
			store.delete(key);
			return undefined;
		}
		return entry;
	}

	const redis = {
		get: async (key: string): Promise<string | null> => {
			const entry = getEntry(key);
			return entry?.value ?? null;
		},

		set: async (key: string, value: string, ...args: (string | number)[]): Promise<"OK"> => {
			let expiresAt: number | null = null;
			for (let i = 0; i < args.length; i += 2) {
				const flag = String(args[i]).toUpperCase();
				const val = Number(args[i + 1]);
				if (flag === "EX") {
					expiresAt = Date.now() + val * 1000;
				} else if (flag === "PX") {
					expiresAt = Date.now() + val;
				}
			}
			store.set(key, { value, expiresAt });
			return "OK";
		},

		del: async (...keys: string[]): Promise<number> => {
			let count = 0;
			for (const key of keys) {
				if (store.delete(key)) count++;
				if (sortedSets.delete(key)) count++;
			}
			return count;
		},

		ping: async (): Promise<string> => "PONG",

		incr: async (key: string): Promise<number> => {
			const entry = getEntry(key);
			const current = entry ? Number.parseInt(entry.value, 10) : 0;
			const next = current + 1;
			store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
			return next;
		},

		decr: async (key: string): Promise<number> => {
			const entry = getEntry(key);
			const current = entry ? Number.parseInt(entry.value, 10) : 0;
			const next = current - 1;
			store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
			return next;
		},

		pexpire: async (key: string, ms: number): Promise<number> => {
			const entry = store.get(key);
			if (entry) {
				entry.expiresAt = Date.now() + ms;
				return 1;
			}
			return 0;
		},

		zadd: async (key: string, score: string, member: string): Promise<number> => {
			let set = sortedSets.get(key);
			if (!set) {
				set = new Map();
				sortedSets.set(key, set);
			}
			const isNew = !set.has(member);
			set.set(member, Number(score));
			return isNew ? 1 : 0;
		},

		zcard: async (key: string): Promise<number> => {
			return sortedSets.get(key)?.size ?? 0;
		},

		zremrangebyscore: async (
			key: string,
			min: number | string,
			max: number | string,
		): Promise<number> => {
			const set = sortedSets.get(key);
			if (!set) return 0;
			let count = 0;
			const minN = Number(min);
			const maxN = Number(max);
			for (const [member, score] of set) {
				if (score >= minN && score <= maxN) {
					set.delete(member);
					count++;
				}
			}
			return count;
		},

		pipeline: () => {
			const commands: Array<{
				method: string;
				args: unknown[];
			}> = [];

			const pipe = {
				zremrangebyscore: (key: string, min: number | string, max: number | string) => {
					commands.push({ method: "zremrangebyscore", args: [key, min, max] });
					return pipe;
				},
				zcard: (key: string) => {
					commands.push({ method: "zcard", args: [key] });
					return pipe;
				},
				zadd: (key: string, score: string, member: string) => {
					commands.push({ method: "zadd", args: [key, score, member] });
					return pipe;
				},
				pexpire: (key: string, ms: number) => {
					commands.push({ method: "pexpire", args: [key, ms] });
					return pipe;
				},
				exec: async (): Promise<Array<[Error | null, unknown]>> => {
					const results: Array<[Error | null, unknown]> = [];
					for (const cmd of commands) {
						try {
							const fn = (
								redis as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
							)[cmd.method];
							const result = await fn(...cmd.args);
							results.push([null, result]);
						} catch (err) {
							results.push([err as Error, null]);
						}
					}
					return results;
				},
			};

			return pipe;
		},

		on: () => redis,
		quit: async () => "OK",
	};

	return redis as unknown as Redis;
}

// ─── In-memory drizzle-compatible database ───────────────────────────────────

// Row types (mirrors the DB schema)
interface ConsumerRow {
	id: string;
	email: string;
	name: string | null;
	tokenBalance: number;
	createdAt: Date;
	updatedAt: Date;
}

interface ApiKeyRow {
	id: string;
	consumerId: string;
	keyHash: string;
	label: string | null;
	createdAt: Date;
	revokedAt: Date | null;
	lastUsedAt: Date | null;
}

interface CachedResourceRow {
	id: string;
	siteDomain: string;
	resourceType: string;
	paramsHash: string;
	params: Record<string, string> | null;
	data: Record<string, unknown> | null;
	normalizedUrl: string;
	dataSizeBytes: number;
	extractionStatus: string;
	fetchedAt: Date;
	expiresAt: Date;
}

interface UsageLogRow {
	id: string;
	consumerId: string | null;
	apiKeyId: string | null;
	operation: string;
	siteDomain: string | null;
	resourceType: string | null;
	tokensEstimated: number;
	tokensActual: number;
	dataBytes: number;
	status: string;
	idempotencyKey: string | null;
	createdAt: Date;
}

interface RobotsTxtCacheRow {
	domain: string;
	content: string;
	fetchedAt: Date;
	expiresAt: Date;
}

export interface MockDbData {
	consumers: ConsumerRow[];
	apiKeys: ApiKeyRow[];
	cachedResources: CachedResourceRow[];
	usageLogs: UsageLogRow[];
	robotsTxtCache: RobotsTxtCacheRow[];
}

/**
 * Column reference resolver. Given a drizzle column object, extracts
 * the field name from the column's `.name` property (the DB column name).
 */
function getColumnName(col: unknown): string {
	const c = col as { name?: string };
	return c?.name ?? "";
}

/**
 * Map a DB column name (snake_case) to the MockDbData property name (camelCase).
 */
function snakeToCamel(s: string): string {
	return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Resolve a drizzle column reference against a row object using camelCase keys.
 */
function getFieldValue(row: Record<string, unknown>, col: unknown): unknown {
	const colName = getColumnName(col);
	const camelName = snakeToCamel(colName);
	return row[camelName] ?? row[colName];
}

/**
 * Identify which table a drizzle table reference points to.
 */
function identifyTable(tableRef: unknown): string {
	// Drizzle table objects expose the table name at [Symbol.for('drizzle:Name')]
	// But more reliably via the _ property
	const t = tableRef as { _?: { name?: string }; [key: symbol]: string };
	if (t?._?.name) return t._.name;
	// fallback: try the symbol
	const sym = Object.getOwnPropertySymbols(t).find((s) => s.toString() === "Symbol(drizzle:Name)");
	if (sym) return String(t[sym]);
	return "";
}

/**
 * Evaluate a drizzle `where` condition against a row.
 *
 * Drizzle-orm v0.38 SQL expressions use `queryChunks` arrays:
 * - eq(col, val) -> queryChunks: [StringChunk(''), Column, StringChunk(' = '), Param, StringChunk('')]
 * - gt(col, val) -> queryChunks: [StringChunk(''), Column, StringChunk(' > '), Param, StringChunk('')]
 * - and(a, b)    -> queryChunks: [StringChunk('('), SQL([a, ' and ', b]), StringChunk(')')]
 */
function matchesWhere(row: Record<string, unknown>, condition: unknown): boolean {
	if (!condition) return true;

	const c = condition as { queryChunks?: unknown[] };
	if (!c.queryChunks || !Array.isArray(c.queryChunks)) return true;

	const chunks = c.queryChunks;

	// Detect a binary comparison: 5 chunks where [1] is a Column and [3] is a Param
	if (chunks.length === 5) {
		const maybeColumn = chunks[1] as { name?: string; constructor?: { name: string } };
		const maybeOp = chunks[2] as { value?: string[] };
		const maybeParam = chunks[3] as { value?: unknown; constructor?: { name: string } };

		if (maybeColumn?.name && maybeOp?.value && maybeParam?.constructor?.name === "Param") {
			const colName = maybeColumn.name;
			const camelName = snakeToCamel(colName);
			const operator = maybeOp.value[0]?.trim();
			const compareVal = maybeParam.value;
			const rowVal = row[camelName] ?? row[colName];

			if (operator === "=") return rowVal === compareVal;
			if (operator === ">") {
				if (rowVal instanceof Date && compareVal instanceof Date) {
					return rowVal.getTime() > compareVal.getTime();
				}
				return (rowVal as number) > (compareVal as number);
			}
			return true;
		}
	}

	// For and() or nested SQL expressions, recurse into sub-chunks
	for (const chunk of chunks) {
		if (chunk && typeof chunk === "object") {
			const sub = chunk as { queryChunks?: unknown[]; constructor?: { name: string } };
			if (sub.queryChunks && sub.constructor?.name === "SQL") {
				if (!matchesWhere(row, sub)) return false;
			}
		}
	}

	return true;
}

/**
 * Project selected fields from a row. `fields` is the object passed to
 * drizzle's `.select({...})`. Each value is a drizzle column reference.
 */
function projectRow(
	row: Record<string, unknown>,
	fields: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [alias, col] of Object.entries(fields)) {
		result[alias] = getFieldValue(row, col);
	}
	return result;
}

/**
 * Get the correct in-memory array for a table name.
 */
function getTable(data: MockDbData, tableName: string): Record<string, unknown>[] {
	switch (tableName) {
		case "consumers":
			return data.consumers as unknown as Record<string, unknown>[];
		case "api_keys":
			return data.apiKeys as unknown as Record<string, unknown>[];
		case "cached_resources":
			return data.cachedResources as unknown as Record<string, unknown>[];
		case "usage_logs":
			return data.usageLogs as unknown as Record<string, unknown>[];
		case "robots_txt_cache":
			return data.robotsTxtCache as unknown as Record<string, unknown>[];
		default:
			return [];
	}
}

/**
 * Create a mock drizzle-compatible database backed by in-memory arrays.
 *
 * Implements the exact query builder patterns used in the server codebase:
 * - db.select({...}).from(table).where(condition).limit(n)
 * - db.insert(table).values({...}).returning({...}).onConflictDoUpdate({...})
 * - db.update(table).set({...}).where(condition).returning({...})
 */
export function createMockDb(): { db: Db; data: MockDbData } {
	const data: MockDbData = {
		consumers: [],
		apiKeys: [],
		cachedResources: [],
		usageLogs: [],
		robotsTxtCache: [],
	};

	/**
	 * Make a chain's then() return a real Promise so that
	 * `.then(() => {}).catch(() => {})` works correctly.
	 */
	function promisifyThen<T>(executeFn: () => T) {
		return function then(resolve?: (value: T) => unknown, reject?: (err: unknown) => unknown) {
			return Promise.resolve()
				.then(() => executeFn())
				.then(resolve, reject);
		};
	}

	const db = {
		select(fields: Record<string, unknown>) {
			let tableName = "";
			let whereCondition: unknown = null;
			let limitN: number | null = null;

			const execute = () => {
				let rows = getTable(data, tableName);
				if (whereCondition) {
					rows = rows.filter((r) => matchesWhere(r, whereCondition));
				}
				if (limitN !== null) rows = rows.slice(0, limitN);
				return rows.map((r) => projectRow(r, fields));
			};

			const chain = {
				from(tableRef: unknown) {
					tableName = identifyTable(tableRef);
					return chain;
				},
				where(cond: unknown) {
					whereCondition = cond;
					return chain;
				},
				limit(n: number) {
					limitN = n;
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
				then: promisifyThen(execute),
			};
			return chain;
		},

		insert(tableRef: unknown) {
			const tableName = identifyTable(tableRef);
			let insertValues: Record<string, unknown> = {};
			let returningFields: Record<string, unknown> | null = null;
			let conflictUpdate: Record<string, unknown> | null = null;

			const execute = () => {
				const result = doInsert(data, tableName, insertValues, conflictUpdate);
				if (returningFields) {
					return [projectRow(result as Record<string, unknown>, returningFields)];
				}
				return [];
			};

			const chain = {
				values(vals: Record<string, unknown>) {
					insertValues = vals;
					return chain;
				},
				returning(fields: Record<string, unknown>) {
					returningFields = fields;
					return chain;
				},
				onConflictDoUpdate(opts: { target: unknown; set: Record<string, unknown> }) {
					conflictUpdate = opts.set;
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
				then: promisifyThen(execute),
				catch(_handler: (err: unknown) => void) {
					// Fire-and-forget: execute and swallow errors
					try {
						doInsert(data, tableName, insertValues, conflictUpdate);
					} catch {
						// swallow
					}
					return chain;
				},
			};
			return chain;
		},

		update(tableRef: unknown) {
			const tableName = identifyTable(tableRef);
			let setValues: Record<string, unknown> = {};
			let whereCondition: unknown = null;
			let returningFields: Record<string, unknown> | null = null;

			const execute = () => {
				const table = getTable(data, tableName);
				const matched = table.filter((r) =>
					whereCondition ? matchesWhere(r, whereCondition) : true,
				);
				for (const row of matched) {
					Object.assign(row, setValues);
				}
				if (returningFields) {
					return matched.map((r) => projectRow(r, returningFields!));
				}
				return matched;
			};

			const chain = {
				set(vals: Record<string, unknown>) {
					setValues = vals;
					return chain;
				},
				where(cond: unknown) {
					whereCondition = cond;
					return chain;
				},
				returning(fields: Record<string, unknown>) {
					returningFields = fields;
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
				then: promisifyThen(execute),
				catch(_handler: (err: unknown) => void) {
					// Fire-and-forget
					return chain;
				},
			};
			return chain;
		},
	};

	return { db: db as unknown as Db, data };
}

function doInsert(
	data: MockDbData,
	tableName: string,
	values: Record<string, unknown>,
	conflictUpdate: Record<string, unknown> | null,
): object {
	const id = randomUUID();
	const now = new Date();

	switch (tableName) {
		case "consumers": {
			const existing = data.consumers.find((c) => c.email === values.email);
			if (existing) {
				if (conflictUpdate) {
					Object.assign(existing, conflictUpdate);
					return existing;
				}
				throw new Error("unique constraint violation on consumers.email");
			}
			const row: ConsumerRow = {
				id,
				email: values.email as string,
				name: (values.name as string) ?? null,
				tokenBalance: (values.tokenBalance as number) ?? 0,
				createdAt: now,
				updatedAt: now,
			};
			data.consumers.push(row);
			return row;
		}
		case "api_keys": {
			const existing = data.apiKeys.find((k) => k.keyHash === values.keyHash);
			if (existing && !conflictUpdate) {
				throw new Error("unique constraint violation on api_keys.key_hash");
			}
			const row: ApiKeyRow = {
				id,
				consumerId: values.consumerId as string,
				keyHash: values.keyHash as string,
				label: (values.label as string) ?? null,
				createdAt: now,
				revokedAt: null,
				lastUsedAt: null,
			};
			data.apiKeys.push(row);
			return row;
		}
		case "cached_resources": {
			const existing = data.cachedResources.find((r) => r.normalizedUrl === values.normalizedUrl);
			if (existing) {
				if (conflictUpdate) {
					Object.assign(existing, conflictUpdate);
					return existing;
				}
				throw new Error("unique constraint violation");
			}
			const row: CachedResourceRow = {
				id,
				siteDomain: values.siteDomain as string,
				resourceType: values.resourceType as string,
				paramsHash: values.paramsHash as string,
				params: (values.params as Record<string, string>) ?? null,
				data: (values.data as Record<string, unknown>) ?? null,
				normalizedUrl: values.normalizedUrl as string,
				dataSizeBytes: (values.dataSizeBytes as number) ?? 0,
				extractionStatus: (values.extractionStatus as string) ?? "success",
				fetchedAt: (values.fetchedAt as Date) ?? now,
				expiresAt: values.expiresAt as Date,
			};
			data.cachedResources.push(row);
			return row;
		}
		case "usage_logs": {
			const row: UsageLogRow = {
				id,
				consumerId: (values.consumerId as string) ?? null,
				apiKeyId: (values.apiKeyId as string) ?? null,
				operation: values.operation as string,
				siteDomain: (values.siteDomain as string) ?? null,
				resourceType: (values.resourceType as string) ?? null,
				tokensEstimated: (values.tokensEstimated as number) ?? 0,
				tokensActual: (values.tokensActual as number) ?? 0,
				dataBytes: (values.dataBytes as number) ?? 0,
				status: values.status as string,
				idempotencyKey: (values.idempotencyKey as string) ?? null,
				createdAt: now,
			};
			data.usageLogs.push(row);
			return row;
		}
		case "robots_txt_cache": {
			const existing = data.robotsTxtCache.find((r) => r.domain === values.domain);
			if (existing) {
				if (conflictUpdate) {
					Object.assign(existing, conflictUpdate);
					return existing;
				}
			}
			const row: RobotsTxtCacheRow = {
				domain: values.domain as string,
				content: values.content as string,
				fetchedAt: (values.fetchedAt as Date) ?? now,
				expiresAt: values.expiresAt as Date,
			};
			data.robotsTxtCache.push(row);
			return row;
		}
		default:
			return {};
	}
}

// ─── Test API key helpers ────────────────────────────────────────────────────

export interface TestApiKeyResult {
	consumerId: string;
	apiKeyId: string;
	plainKey: string;
}

/**
 * Create a consumer and API key directly in the mock database.
 * Returns the plaintext API key for use in Authorization headers.
 */
export function createTestApiKey(
	data: MockDbData,
	opts?: { email?: string; revokedAt?: Date; tokenBalance?: number },
): TestApiKeyResult {
	const consumerId = randomUUID();
	const apiKeyId = randomUUID();
	const plainKey = `wapi_sk_${randomBytes(32).toString("hex")}`;
	const keyHash = hashApiKey(plainKey);

	data.consumers.push({
		id: consumerId,
		email: opts?.email ?? `test-${randomUUID().slice(0, 8)}@example.com`,
		name: "Test User",
		tokenBalance: opts?.tokenBalance ?? 10_000,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	data.apiKeys.push({
		id: apiKeyId,
		consumerId,
		keyHash,
		label: "Test Key",
		createdAt: new Date(),
		revokedAt: opts?.revokedAt ?? null,
		lastUsedAt: null,
	});

	return { consumerId, apiKeyId, plainKey };
}

// ─── Test app factory ────────────────────────────────────────────────────────

/**
 * Create a fully configured Hono app for testing with mock dependencies.
 * Optionally registers site definitions for extraction tests.
 */
export function createTestApp(opts?: { sites?: SiteDefinition[] }) {
	const redis = createMockRedis();
	const { db, data } = createMockDb();
	const logger = pino({ level: "silent" });

	if (opts?.sites) {
		for (const site of opts.sites) {
			registerSite(site, logger);
		}
	}

	const app = createApp(db, redis, logger);

	return { app, db, redis, data, logger };
}

// ─── Fixture HTML for Wikipedia ──────────────────────────────────────────────

export const WIKIPEDIA_FIXTURE_HTML = `<html>
<head>
  <title>TypeScript - Wikipedia</title>
  <link rel="canonical" href="https://en.wikipedia.org/wiki/TypeScript" />
  <script type="application/ld+json">
    {"@type": "Article", "name": "TypeScript", "headline": "TypeScript", "dateModified": "2025-01-15"}
  </script>
</head>
<body>
  <div id="content">
    <h1 id="firstHeading">TypeScript</h1>
    <div class="mw-parser-output">
      <p class="mw-empty-elt"></p>
      <p>TypeScript is a free and open-source high-level programming language developed by Microsoft that adds static typing with optional type annotations to JavaScript.</p>
      <p>It is designed for the development of large applications and transpiles to JavaScript.</p>
      <div class="infobox">
        <img src="//upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Typescript_logo_2020.svg/220px-Typescript_logo_2020.svg.png" />
      </div>
    </div>
    <div id="mw-normal-catlinks">
      <ul>
        <li><a href="/wiki/Category:Programming_languages">Programming languages</a></li>
        <li><a href="/wiki/Category:Microsoft_software">Microsoft software</a></li>
        <li><a href="/wiki/Category:TypeScript">TypeScript</a></li>
      </ul>
    </div>
    <div id="footer-info-lastmod">This page was last edited on 15 January 2025, at 10:30 (UTC).</div>
  </div>
</body>
</html>`;
