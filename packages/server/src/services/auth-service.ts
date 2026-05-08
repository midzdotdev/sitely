import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, consumers } from "../db/schema.js";
import { hashApiKey } from "../middleware/auth.js";
import type { Db } from "../types.js";

const INITIAL_TOKEN_BALANCE = 10_000;

export interface SignupResult {
	consumerId: string;
	apiKey: string;
	tokenBalance: number;
}

/**
 * Create a new consumer account and generate their first API key.
 * The plaintext API key is returned exactly once.
 */
export async function signup(db: Db, email: string, name?: string): Promise<SignupResult> {
	const [consumer] = await db
		.insert(consumers)
		.values({ email, name, tokenBalance: INITIAL_TOKEN_BALANCE })
		.returning({ id: consumers.id });

	const plainKey = generateApiKey();
	const keyHash = hashApiKey(plainKey);

	await db.insert(apiKeys).values({
		consumerId: consumer.id,
		keyHash,
		label: "Default",
	});

	return {
		consumerId: consumer.id,
		apiKey: plainKey,
		tokenBalance: INITIAL_TOKEN_BALANCE,
	};
}

/**
 * Create an additional API key for an existing consumer.
 */
export async function createApiKey(
	db: Db,
	consumerId: string,
	label?: string,
): Promise<{ apiKey: string; keyId: string }> {
	const plainKey = generateApiKey();
	const keyHash = hashApiKey(plainKey);

	const [row] = await db
		.insert(apiKeys)
		.values({ consumerId, keyHash, label })
		.returning({ id: apiKeys.id });

	return { apiKey: plainKey, keyId: row.id };
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(db: Db, _consumerId: string, keyId: string): Promise<boolean> {
	const result = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(eq(apiKeys.id, keyId))
		.returning({ id: apiKeys.id });

	return result.length > 0;
}

/**
 * Get consumer's current token balance.
 */
export async function getBalance(db: Db, consumerId: string): Promise<number> {
	const [row] = await db
		.select({ tokenBalance: consumers.tokenBalance })
		.from(consumers)
		.where(eq(consumers.id, consumerId))
		.limit(1);

	return row?.tokenBalance ?? 0;
}

/**
 * Grant tokens to a consumer (admin operation).
 */
export async function grantTokens(db: Db, consumerId: string, amount: number): Promise<number> {
	const [row] = await db
		.select({ tokenBalance: consumers.tokenBalance })
		.from(consumers)
		.where(eq(consumers.id, consumerId))
		.limit(1);

	if (!row) throw new Error("Consumer not found");

	const newBalance = row.tokenBalance + amount;
	await db
		.update(consumers)
		.set({ tokenBalance: newBalance, updatedAt: new Date() })
		.where(eq(consumers.id, consumerId));

	return newBalance;
}

function generateApiKey(): string {
	return `wapi_sk_${randomBytes(32).toString("hex")}`;
}
