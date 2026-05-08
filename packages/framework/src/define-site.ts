import type { SiteDefinition } from "./types.js";

/**
 * Type-safe builder for site definitions (DSL v2).
 *
 * @remarks
 * Identity function that preserves full type inference on the definition object literal.
 * Use it as the default export of a site module.
 *
 * @example
 * ```ts
 * import { defineSite } from "@sitely/framework";
 * import { Article } from "@sitely/schemas";
 *
 * export default defineSite({
 *   site: { id: "example", displayName: "Example" },
 *   origins: [{ hostname: "example.com" }],
 *   rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
 *   schemas: { Article },
 *   resources: {
 *     article: {
 *       schema: "Article",
 *       params: { id: { type: "string", required: true } },
 *       resolve: (p) => `/article/${p.id}`,
 *       ttl: { default: "1h", min: "1m", max: "24h" },
 *     },
 *   },
 *   pages: {
 *     "/article/:id": {
 *       provides: ["article"],
 *       examples: ["https://example.com/article/123"],
 *       validate: (ctx) => ctx.status === 200,
 *       extract: async (ctx) => ({
 *         article: { headline: ctx.$("h1")?.text() ?? "" },
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function defineSite<T extends SiteDefinition>(definition: T): T {
	return definition;
}
