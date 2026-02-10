import { deductTokens, creditTokens } from "./auth-service.js";

/**
 * Billing cost constants (tokens).
 */
const COSTS = {
	cachedRead: { base: 1, perMb: 0.5 },
	liveScrapeStatic: { base: 5, perMb: 2 },
	liveScrapeDynamic: { base: 15, perMb: 2 },
	mediaDownload: { base: 5, perMb: 3 },
	mediaServing: { base: 1, perMb: 1 },
	fallbackExtraction: { base: 3, perMb: 2 },
	discovery: { base: 0, perMb: 0 },
} as const;

export type OperationType = keyof typeof COSTS;

/**
 * Estimate cost for an operation (before it begins).
 * Uses historical average size or a conservative default.
 */
export function estimateCost(
	operationType: OperationType,
	estimatedSizeBytes = 50_000,
): number {
	const cost = COSTS[operationType];
	const sizeMb = estimatedSizeBytes / (1024 * 1024);
	return cost.base + cost.perMb * sizeMb;
}

/**
 * Calculate actual cost from real data size.
 */
export function actualCost(operationType: OperationType, actualSizeBytes: number): number {
	const cost = COSTS[operationType];
	const sizeMb = actualSizeBytes / (1024 * 1024);
	return cost.base + cost.perMb * sizeMb;
}

/**
 * Deduct estimated tokens before work begins.
 * Returns the estimated amount deducted, or null if insufficient balance.
 */
export function deductEstimated(
	consumerId: string,
	operationType: OperationType,
	estimatedSizeBytes?: number,
): number | null {
	if (operationType === "discovery") return 0; // Free

	const estimated = estimateCost(operationType, estimatedSizeBytes);
	const rounded = Math.ceil(estimated);
	if (!deductTokens(consumerId, rounded)) return null;
	return rounded;
}

/**
 * Reconcile: adjust balance based on actual vs. estimated cost.
 * Credits back the difference if actual < estimated.
 * Deducts more if actual > estimated.
 */
export function reconcile(
	consumerId: string,
	operationType: OperationType,
	estimatedAmount: number,
	actualSizeBytes: number,
): number {
	const actual = Math.ceil(actualCost(operationType, actualSizeBytes));
	const diff = estimatedAmount - actual;
	if (diff > 0) {
		creditTokens(consumerId, diff);
	} else if (diff < 0) {
		deductTokens(consumerId, -diff);
	}
	return actual;
}
