/**
 * `@sitely/schemas` provides Zod-based, schema.org-shaped Standard Schema
 * validators for use in site definitions.
 *
 * Each schema is a `z.ZodObject` with a `.schemaOrgType` and `.schemaOrgVersion`
 * tag attached as a sibling export. Site definitions reference them by name from
 * the top-level `schemas` map and use the string name in `resources[].schema`.
 *
 * Authors may extend any schema via Zod's normal `.extend()` API for per-site
 * refinements; the schema.org type tag is preserved.
 *
 * @example
 * ```ts
 * import { defineSite } from "@sitely/framework";
 * import { Article } from "@sitely/schemas";
 *
 * const MyArticle = Article.extend({ wordCount: z.number().int().nonnegative() });
 *
 * export default defineSite({
 *   schemas: { Article: MyArticle },
 *   resources: { article: { schema: "Article", ... } },
 *   // ...
 * });
 * ```
 *
 * @packageDocumentation
 */

export {
	AggregateRating,
	Article,
	ImageObject,
	ItemList,
	ListItem,
	Organization,
	Person,
	Product,
	Rating,
	Recipe,
	Review,
	Thing,
	VideoObject,
	WebPage,
	schemaOrgMetadata,
	schemaOrgVersion,
} from "./schemas.js";

export type {
	AggregateRatingType,
	ArticleType,
	ImageObjectType,
	ItemListType,
	ListItemType,
	OrganizationType,
	PersonType,
	ProductType,
	RatingType,
	RecipeType,
	ReviewType,
	ThingType,
	VideoObjectType,
	WebPageType,
} from "./schemas.js";

// Validation helper used by the test harness to run a Standard Schema validator
// against extracted data; kept here so test-harness consumers don't need to know
// the validator vendor.
export { validateExtraction } from "./validation.js";
export type { ValidationResult } from "./validation.js";
