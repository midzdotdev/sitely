import { createHash, randomBytes } from "node:crypto";

/**
 * In-memory auth store for MVP. Replace with Drizzle + Postgres for production.
 */

interface StoredConsumer {
	id: string;
	email: string;
	name: string | null;
	createdAt: Date;
}

interface StoredApiKey {
	id: string;
	consumerId: string;
	keyHash: string;
	label: string | null;
	createdAt: Date;
	revokedAt: Date | null;
	lastUsedAt: Date | null;
}

interface StoredBalance {
	consumerId: string;
	tokenBalance: number;
}

const consumersMap = new Map<string, StoredConsumer>();
const apiKeysMap = new Map<string, StoredApiKey>(); // keyed by keyHash
const balancesMap = new Map<string, StoredBalance>(); // keyed by consumerId

/** Hash an API key with SHA-256. */
export function hashApiKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/** Generate a random API key: wapi_sk_<32 hex bytes>. */
function generateApiKey(): string {
	return `wapi_sk_${randomBytes(32).toString("hex")}`;
}

/** Generate a UUID-like ID. */
function generateId(): string {
	return randomBytes(16).toString("hex");
}

/**
 * Create a new consumer. Returns the plaintext API key (shown only once).
 */
export function createConsumer(email: string, name?: string): {
	consumerId: string;
	apiKey: string;
	apiKeyId: string;
} {
	const consumerId = generateId();
	const consumer: StoredConsumer = {
		id: consumerId,
		email,
		name: name ?? null,
		createdAt: new Date(),
	};
	consumersMap.set(consumerId, consumer);

	// Create initial balance
	balancesMap.set(consumerId, { consumerId, tokenBalance: 10_000 });

	// Create first API key
	const plaintextKey = generateApiKey();
	const keyHash = hashApiKey(plaintextKey);
	const apiKeyId = generateId();
	const storedKey: StoredApiKey = {
		id: apiKeyId,
		consumerId,
		keyHash,
		label: "default",
		createdAt: new Date(),
		revokedAt: null,
		lastUsedAt: null,
	};
	apiKeysMap.set(keyHash, storedKey);

	return { consumerId, apiKey: plaintextKey, apiKeyId };
}

/**
 * Look up a consumer by API key hash. Returns null if not found or revoked.
 */
export function findConsumerByApiKeyHash(
	keyHash: string,
): { consumerId: string; apiKeyId: string } | null {
	const key = apiKeysMap.get(keyHash);
	if (!key || key.revokedAt) return null;

	// Update last used
	key.lastUsedAt = new Date();

	return { consumerId: key.consumerId, apiKeyId: key.id };
}

/**
 * Get token balance for a consumer.
 */
export function getBalance(consumerId: string): number {
	return balancesMap.get(consumerId)?.tokenBalance ?? 0;
}

/**
 * Deduct tokens atomically. Returns false if insufficient balance.
 */
export function deductTokens(consumerId: string, amount: number): boolean {
	const balance = balancesMap.get(consumerId);
	if (!balance || balance.tokenBalance < amount) return false;
	balance.tokenBalance -= amount;
	return true;
}

/**
 * Credit tokens back (for reconciliation when actual < estimated).
 */
export function creditTokens(consumerId: string, amount: number): void {
	const balance = balancesMap.get(consumerId);
	if (balance) {
		balance.tokenBalance += amount;
	}
}
