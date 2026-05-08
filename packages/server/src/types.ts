import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type * as schema from "./db/schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

export type AppEnv = {
	Variables: {
		db: Db;
		redis: Redis;
		logger: Logger;
		consumerId: string;
		apiKeyId: string;
	};
};
