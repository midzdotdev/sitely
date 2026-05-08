/**
 * `@wapi/schemas` provides TypeScript types for common schema.org entities
 * and the {@link Schema} constant for referencing them by name in site definitions.
 *
 * @packageDocumentation
 */
export type {
	Thing,
	Article,
	Person,
	Organization,
	Product,
	VideoObject,
	WebPage,
	ItemList,
	ListItem,
	ImageObject,
	Review,
	Rating,
	AggregateRating,
	SchemaType,
	SchemaTypeName,
} from "./types.js";

/**
 * Namespace constant for referencing schema.org types in site definitions.
 * Provides autocompletion and type safety over bare string literals.
 *
 * @example
 * ```ts
 * import { Schema } from "@wapi/schemas";
 *
 * const resource = {
 *   schema: Schema.Article,
 *   params: { id: { type: "string", required: true } },
 *   resolve: (p) => `/article/${p.id}`,
 *   ttl: "1h",
 * };
 * ```
 */
export const Schema = {
	Article: "Article" as const,
	Person: "Person" as const,
	Organization: "Organization" as const,
	Product: "Product" as const,
	VideoObject: "VideoObject" as const,
	WebPage: "WebPage" as const,
	ItemList: "ItemList" as const,
	ImageObject: "ImageObject" as const,
	Review: "Review" as const,
} satisfies Record<string, string>;

// Validation
export { schemaValidators, validateExtraction } from "./validation.js";
export type { ValidationResult } from "./validation.js";
