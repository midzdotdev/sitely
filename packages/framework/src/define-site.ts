import type { SiteDefinition } from "./types.js";

/**
 * Type-safe builder for site definitions.
 *
 * @remarks
 * This is a simple identity function that preserves full type inference
 * on the definition object literal. Use it as the default export of a site module.
 *
 * @param definition - The site definition object.
 * @returns The same object, with full type inference preserved.
 *
 * @example
 * ```ts
 * import { Schema, defineSite } from "@wapi/framework";
 *
 * export default defineSite({
 *   name: "My Site",
 *   domain: "example.com",
 *   rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
 *   resources: { ... },
 *   pages: { ... },
 * });
 * ```
 */
export function defineSite<T extends SiteDefinition>(definition: T): T {
	return definition;
}
