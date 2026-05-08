import type { ResourceTTL } from "../types.js";

/**
 * Sanity bounds per atlas spec §5:
 * - `min` >= 1s
 * - `max` <= 30d
 * - `min` <= `default` <= `max`
 */
const MIN_FLOOR_S = 1;
const MAX_CEILING_S = 30 * 24 * 60 * 60; // 30 days

const DURATION_RE = /^(\d+)([smhd])$/;

/**
 * Parse a duration string like `"30s"` / `"5m"` / `"24h"` / `"7d"` into seconds.
 *
 * Returns `null` if the input doesn't match the expected shape.
 */
export function parseTTL(s: string): number | null {
	const m = s.match(DURATION_RE);
	if (!m) return null;
	const value = Number.parseInt(m[1], 10);
	switch (m[2]) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 3600;
		case "d":
			return value * 86_400;
		default:
			return null;
	}
}

export interface TTLValidationError {
	resource: string;
	field: "default" | "min" | "max" | "ordering" | "ceiling" | "floor";
	message: string;
}

/**
 * Validate a single resource's TTL triple against atlas §5 sanity bounds.
 *
 * Returns the empty array when the TTL is valid; otherwise returns one or
 * more structured errors. The returned errors carry the field name + a
 * human-readable message; callers compose them into the final build report.
 */
export function validateTTL(resourceName: string, ttl: ResourceTTL): TTLValidationError[] {
	const errors: TTLValidationError[] = [];

	const defaultS = parseTTL(ttl.default);
	const minS = parseTTL(ttl.min);
	const maxS = parseTTL(ttl.max);

	if (defaultS === null) {
		errors.push({
			resource: resourceName,
			field: "default",
			message: `ttl.default "${ttl.default}" is not a valid duration (expected <digits><s|m|h|d>)`,
		});
	}
	if (minS === null) {
		errors.push({
			resource: resourceName,
			field: "min",
			message: `ttl.min "${ttl.min}" is not a valid duration`,
		});
	}
	if (maxS === null) {
		errors.push({
			resource: resourceName,
			field: "max",
			message: `ttl.max "${ttl.max}" is not a valid duration`,
		});
	}

	if (errors.length > 0) return errors;

	// All three parsed; check ordering + bounds.
	if (minS! < MIN_FLOOR_S) {
		errors.push({
			resource: resourceName,
			field: "floor",
			message: `ttl.min "${ttl.min}" is below the 1s floor`,
		});
	}
	if (maxS! > MAX_CEILING_S) {
		errors.push({
			resource: resourceName,
			field: "ceiling",
			message: `ttl.max "${ttl.max}" exceeds the 30d ceiling`,
		});
	}
	if (minS! > maxS!) {
		errors.push({
			resource: resourceName,
			field: "ordering",
			message: `ttl.min "${ttl.min}" > ttl.max "${ttl.max}"`,
		});
	}
	if (defaultS! < minS! || defaultS! > maxS!) {
		errors.push({
			resource: resourceName,
			field: "ordering",
			message: `ttl.default "${ttl.default}" not in [ttl.min "${ttl.min}", ttl.max "${ttl.max}"]`,
		});
	}

	return errors;
}
