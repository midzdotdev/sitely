import { z } from "zod";

/**
 * The schema.org vocabulary version these schemas target.
 *
 * Used by `<sitely> build` to populate the manifest's `schemaOrgVersion` field
 * so the directory can flag packages targeting outdated schema.org revisions.
 */
export const schemaOrgVersion = "27.0";

/**
 * Per-schema metadata: the schema.org type each export maps to.
 *
 * Used by `<sitely> build` when emitting the manifest's `schemas` map.
 * Site authors can extend any schema with `.extend()` without losing the tag —
 * the framework looks up the metadata by export name, not by reference identity.
 */
export const schemaOrgMetadata = {
	Thing: { schemaOrgType: "Thing" },
	ImageObject: { schemaOrgType: "ImageObject" },
	Person: { schemaOrgType: "Person" },
	Organization: { schemaOrgType: "Organization" },
	Article: { schemaOrgType: "Article" },
	WebPage: { schemaOrgType: "WebPage" },
	VideoObject: { schemaOrgType: "VideoObject" },
	Product: { schemaOrgType: "Product" },
	Recipe: { schemaOrgType: "Recipe" },
	Review: { schemaOrgType: "Review" },
	Rating: { schemaOrgType: "Rating" },
	AggregateRating: { schemaOrgType: "AggregateRating" },
	ListItem: { schemaOrgType: "ListItem" },
	ItemList: { schemaOrgType: "ItemList" },
} as const satisfies Record<string, { schemaOrgType: string }>;

// ── Helpers ────────────────────────────────────────────────────────

const stringOrArray = z.union([z.string(), z.array(z.string())]);
const numberOrString = z.union([z.number(), z.string()]);

// ── Thing — base type ─────────────────────────────────────────────

const thingFields = {
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	identifier: z.string().optional(),
	sameAs: stringOrArray.optional(),
};

export const Thing = z.looseObject(thingFields);
export type ThingType = z.infer<typeof Thing>;

// ── ImageObject ────────────────────────────────────────────────────

export const ImageObject = z.looseObject({
	...thingFields,
	contentUrl: z.string().optional(),
	width: numberOrString.optional(),
	height: numberOrString.optional(),
	caption: z.string().optional(),
	thumbnailUrl: z.string().optional(),
});
export type ImageObjectType = z.infer<typeof ImageObject>;

// Image field accepts a string URL or an ImageObject.
const imageField = z.union([z.string(), ImageObject]).optional();

// ── Person ─────────────────────────────────────────────────────────

export const Person = z.looseObject({
	...thingFields,
	image: imageField,
	givenName: z.string().optional(),
	familyName: z.string().optional(),
	email: z.string().optional(),
	jobTitle: z.string().optional(),
	birthDate: z.string().optional(),
	nationality: z.string().optional(),
});
export type PersonType = z.infer<typeof Person>;

// ── Organization ───────────────────────────────────────────────────

export const Organization = z.looseObject({
	...thingFields,
	image: imageField,
	logo: z.union([z.string(), ImageObject]).optional(),
	foundingDate: z.string().optional(),
	address: z.string().optional(),
});
export type OrganizationType = z.infer<typeof Organization>;

// ── Rating / AggregateRating ───────────────────────────────────────

export const Rating = z.looseObject({
	...thingFields,
	ratingValue: numberOrString.optional(),
	bestRating: numberOrString.optional(),
	worstRating: numberOrString.optional(),
});
export type RatingType = z.infer<typeof Rating>;

export const AggregateRating = z.looseObject({
	...thingFields,
	ratingValue: numberOrString.optional(),
	bestRating: numberOrString.optional(),
	worstRating: numberOrString.optional(),
	reviewCount: z.number().optional(),
	ratingCount: z.number().optional(),
});
export type AggregateRatingType = z.infer<typeof AggregateRating>;

// ── Review ─────────────────────────────────────────────────────────

export const Review = z.looseObject({
	...thingFields,
	image: imageField,
	author: z.union([Person, z.string()]).optional(),
	datePublished: z.string().optional(),
	reviewBody: z.string().optional(),
	reviewRating: Rating.optional(),
});
export type ReviewType = z.infer<typeof Review>;

// ── Article ────────────────────────────────────────────────────────

export const Article = z.looseObject({
	...thingFields,
	image: imageField,
	headline: z.string().optional(),
	author: z.union([Person, z.string(), z.array(z.union([Person, z.string()]))]).optional(),
	datePublished: z.string().optional(),
	dateModified: z.string().optional(),
	publisher: z.union([Organization, z.string()]).optional(),
	articleBody: z.string().optional(),
	wordCount: z.number().optional(),
	keywords: stringOrArray.optional(),
	inLanguage: z.string().optional(),
	thumbnailUrl: z.string().optional(),
});
export type ArticleType = z.infer<typeof Article>;

// ── VideoObject ────────────────────────────────────────────────────

export const VideoObject = z.looseObject({
	...thingFields,
	image: imageField,
	contentUrl: z.string().optional(),
	embedUrl: z.string().optional(),
	duration: z.string().optional(),
	uploadDate: z.string().optional(),
	thumbnailUrl: z.string().optional(),
	transcript: z.string().optional(),
	width: numberOrString.optional(),
	height: numberOrString.optional(),
});
export type VideoObjectType = z.infer<typeof VideoObject>;

// ── WebPage ────────────────────────────────────────────────────────

export const WebPage = z.looseObject({
	...thingFields,
	image: imageField,
	breadcrumb: z.string().optional(),
	primaryImageOfPage: ImageObject.optional(),
	datePublished: z.string().optional(),
	dateModified: z.string().optional(),
	inLanguage: z.string().optional(),
});
export type WebPageType = z.infer<typeof WebPage>;

// ── Product ────────────────────────────────────────────────────────

export const Product = z.looseObject({
	...thingFields,
	image: imageField,
	brand: z.union([z.string(), Organization]).optional(),
	sku: z.string().optional(),
	gtin: z.string().optional(),
	price: numberOrString.optional(),
	priceCurrency: z.string().optional(),
	availability: z.string().optional(),
	category: z.string().optional(),
	color: z.string().optional(),
	material: z.string().optional(),
	weight: z.string().optional(),
	aggregateRating: AggregateRating.optional(),
	review: z.union([Review, z.array(Review)]).optional(),
});
export type ProductType = z.infer<typeof Product>;

// ── Recipe ─────────────────────────────────────────────────────────

export const Recipe = z.looseObject({
	...thingFields,
	image: imageField,
	author: z.union([Person, z.string()]).optional(),
	datePublished: z.string().optional(),
	recipeIngredient: z.array(z.string()).optional(),
	recipeInstructions: z
		.union([z.string(), z.array(z.union([z.string(), z.looseObject({ text: z.string() })]))])
		.optional(),
	cookTime: z.string().optional(),
	prepTime: z.string().optional(),
	totalTime: z.string().optional(),
	recipeYield: z.union([z.string(), z.number()]).optional(),
	recipeCategory: stringOrArray.optional(),
	recipeCuisine: stringOrArray.optional(),
	nutrition: z.looseObject({}).optional(),
	aggregateRating: AggregateRating.optional(),
});
export type RecipeType = z.infer<typeof Recipe>;

// ── ListItem / ItemList ────────────────────────────────────────────

export const ListItem = z.looseObject({
	...thingFields,
	image: imageField,
	position: z.number().optional(),
	item: Thing.optional(),
});
export type ListItemType = z.infer<typeof ListItem>;

export const ItemList = z.looseObject({
	...thingFields,
	image: imageField,
	numberOfItems: z.number().optional(),
	itemListElement: z.array(ListItem).optional(),
	itemListOrder: z.string().optional(),
});
export type ItemListType = z.infer<typeof ItemList>;
