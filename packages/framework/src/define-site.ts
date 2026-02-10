import type { SiteDefinition } from "./types.js";

/**
 * Type-safe builder for site definitions.
 * Use with `as const` for full literal type preservation:
 *
 * ```ts
 * export default defineSite({ ... } as const);
 * ```
 */
export function defineSite<const T extends SiteDefinition>(def: T): T {
	return def;
}
