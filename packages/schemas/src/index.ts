export type {
	Thing,
	ImageObject,
	Article,
	Product,
	Offer,
	Person,
	Organization,
	ContactPoint,
	VideoObject,
	ItemList,
	ListItem,
	Review,
	Rating,
	AggregateRating,
} from "./types.js";

/**
 * Schema constant for use in site definitions.
 * Maps schema names to their schema.org @type strings.
 */
export const Schema = {
	Thing: "Thing",
	Article: "Article",
	Product: "Product",
	Person: "Person",
	Organization: "Organization",
	VideoObject: "VideoObject",
	ItemList: "ItemList",
	Review: "Review",
	ImageObject: "ImageObject",
} as const;

export type SchemaType = (typeof Schema)[keyof typeof Schema];
