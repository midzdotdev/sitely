import { usageLogs } from "../db/schema.js";
import type { Db } from "../types.js";

/** Token costs per operation type. */
export const TOKEN_COSTS = {
	cachedRead: { base: 1, perMb: 0.5 },
	liveScrape: { base: 5, perMb: 2 },
	fallbackExtraction: { base: 3, perMb: 2 },
	discovery: { base: 0, perMb: 0 },
} as const;

export type OperationType = keyof typeof TOKEN_COSTS;

/**
 * Estimate the token cost for an operation.
 * Uses a conservative default size if no historical data is available.
 */
export function estimateCost(operation: OperationType, estimatedSizeBytes = 50_000): number {
	const cost = TOKEN_COSTS[operation];
	const sizeMb = estimatedSizeBytes / (1024 * 1024);
	return cost.base + cost.perMb * sizeMb;
}

/**
 * Calculate actual token cost based on real data size.
 */
export function calculateActualCost(operation: OperationType, actualSizeBytes: number): number {
	const cost = TOKEN_COSTS[operation];
	const sizeMb = actualSizeBytes / (1024 * 1024);
	return cost.base + cost.perMb * sizeMb;
}

/**
 * Log usage to Postgres (no enforcement — just tracking for MVP).
 */
export async function logUsage(
	db: Db,
	opts: {
		consumerId: string;
		apiKeyId: string;
		operation: string;
		siteDomain?: string;
		resourceType?: string;
		tokensEstimated: number;
		tokensActual: number;
		dataBytes: number;
		status: string;
		idempotencyKey?: string;
	},
): Promise<void> {
	await db
		.insert(usageLogs)
		.values({
			consumerId: opts.consumerId,
			apiKeyId: opts.apiKeyId,
			operation: opts.operation,
			siteDomain: opts.siteDomain,
			resourceType: opts.resourceType,
			tokensEstimated: Math.round(opts.tokensEstimated * 100) / 100,
			tokensActual: Math.round(opts.tokensActual * 100) / 100,
			dataBytes: opts.dataBytes,
			status: opts.status,
			idempotencyKey: opts.idempotencyKey,
		})
		.catch(() => {
			// Usage logging should never fail the request
		});
}
