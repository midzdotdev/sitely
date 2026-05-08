import { z } from "zod";

// ── Helpers ────────────────────────────────────────────────────────

/** A field that can be a string or an ImageObject-shaped object. */
const imageField = z
	.union([z.string(), z.looseObject({ contentUrl: z.string().optional() })])
	.optional();

// ── Base: Thing ────────────────────────────────────────────────────

const ThingSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
});

// ── ImageObject ────────────────────────────────────────────────────

const ImageObjectSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	contentUrl: z.string().optional(),
	width: z.union([z.number(), z.string()]).optional(),
	height: z.union([z.number(), z.string()]).optional(),
	caption: z.string().optional(),
});

// ── ContactPoint ───────────────────────────────────────────────────

const ContactPointSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	telephone: z.string().optional(),
	contactType: z.string().optional(),
	email: z.string().optional(),
});

// ── Organization ───────────────────────────────────────────────────

const OrganizationSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	logo: z.union([z.string(), ImageObjectSchema]).optional(),
	foundingDate: z.string().optional(),
	contactPoint: ContactPointSchema.optional(),
});

// ── Person ─────────────────────────────────────────────────────────

const PersonSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	givenName: z.string().optional(),
	familyName: z.string().optional(),
	email: z.string().optional(),
	jobTitle: z.string().optional(),
	affiliation: z.union([OrganizationSchema, z.string()]).optional(),
	birthDate: z.string().optional(),
	nationality: z.string().optional(),
});

// ── Rating ─────────────────────────────────────────────────────────

const RatingSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	ratingValue: z.union([z.number(), z.string()]).optional(),
	bestRating: z.union([z.number(), z.string()]).optional(),
	worstRating: z.union([z.number(), z.string()]).optional(),
});

// ── AggregateRating ────────────────────────────────────────────────

const AggregateRatingSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	ratingValue: z.union([z.number(), z.string()]).optional(),
	bestRating: z.union([z.number(), z.string()]).optional(),
	worstRating: z.union([z.number(), z.string()]).optional(),
	reviewCount: z.number().optional(),
	ratingCount: z.number().optional(),
});

// ── Review ─────────────────────────────────────────────────────────

const ReviewSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	reviewBody: z.string().optional(),
	reviewRating: RatingSchema.optional(),
	author: z.union([PersonSchema, z.string()]).optional(),
	datePublished: z.string().optional(),
	itemReviewed: ThingSchema.optional(),
});

// ── Offer ──────────────────────────────────────────────────────────

const OfferSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	price: z.union([z.number(), z.string()]).optional(),
	priceCurrency: z.string().optional(),
	availability: z.string().optional(),
	seller: z.union([OrganizationSchema, z.string()]).optional(),
	validFrom: z.string().optional(),
	validThrough: z.string().optional(),
});

// ── Article ────────────────────────────────────────────────────────

const ArticleSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	headline: z.string().optional(),
	author: z.union([PersonSchema, z.string()]).optional(),
	datePublished: z.string().optional(),
	dateModified: z.string().optional(),
	publisher: z.union([OrganizationSchema, z.string()]).optional(),
	articleBody: z.string().optional(),
	wordCount: z.number().optional(),
	keywords: z.union([z.string(), z.array(z.string())]).optional(),
	thumbnailUrl: z.string().optional(),
});

// ── Product ────────────────────────────────────────────────────────

const ProductSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	brand: z.union([z.string(), OrganizationSchema]).optional(),
	sku: z.string().optional(),
	gtin: z.string().optional(),
	offers: z.union([OfferSchema, z.array(OfferSchema)]).optional(),
	aggregateRating: AggregateRatingSchema.optional(),
	review: z.union([ReviewSchema, z.array(ReviewSchema)]).optional(),
	category: z.string().optional(),
	color: z.string().optional(),
	material: z.string().optional(),
});

// ── VideoObject ────────────────────────────────────────────────────

const VideoObjectSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	contentUrl: z.string().optional(),
	embedUrl: z.string().optional(),
	duration: z.string().optional(),
	uploadDate: z.string().optional(),
	thumbnailUrl: z.string().optional(),
	transcript: z.string().optional(),
	width: z.union([z.number(), z.string()]).optional(),
	height: z.union([z.number(), z.string()]).optional(),
});

// ── ListItem ───────────────────────────────────────────────────────

const ListItemSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	position: z.number().optional(),
	item: ThingSchema.optional(),
});

// ── ItemList ───────────────────────────────────────────────────────

const ItemListSchema = z.looseObject({
	"@type": z.string().optional(),
	name: z.string().optional(),
	url: z.string().optional(),
	description: z.string().optional(),
	image: imageField,
	sameAs: z.union([z.string(), z.array(z.string())]).optional(),
	identifier: z.string().optional(),
	itemListElement: z.array(ListItemSchema).optional(),
	numberOfItems: z.number().optional(),
	itemListOrder: z.string().optional(),
});

// ── Schema → Validator Map ─────────────────────────────────────────

/**
 * Maps each Schema enum value to its corresponding Zod validator.
 * Use `schemaValidators[Schema.Article]` to get the Article validator, etc.
 */
export const schemaValidators: Record<string, z.ZodType> = {
	Thing: ThingSchema,
	Article: ArticleSchema,
	Product: ProductSchema,
	Person: PersonSchema,
	Organization: OrganizationSchema,
	VideoObject: VideoObjectSchema,
	ItemList: ItemListSchema,
	Review: ReviewSchema,
	ImageObject: ImageObjectSchema,
};

// ── Validation Utility ─────────────────────────────────────────────

export interface ValidationResult {
	success: boolean;
	data?: unknown;
	errors?: string[];
}

/**
 * Validate extracted data against the declared schema.
 * Returns cleaned data on success or an array of human-readable error strings on failure.
 *
 * Lenient behaviour: if the data is an array, each element is validated
 * individually against the schema. This accommodates sites that return a
 * flat array of items rather than wrapping them in a container object
 * (e.g. returning an array of stories instead of an ItemList wrapper).
 */
export function validateExtraction(schema: string, data: unknown): ValidationResult {
	const validator = schemaValidators[schema];
	if (!validator) {
		return {
			success: false,
			errors: [`No validator registered for schema "${schema}"`],
		};
	}

	// If data is an array, validate each element individually.
	if (Array.isArray(data)) {
		const validatedItems: unknown[] = [];
		const errors: string[] = [];

		for (let i = 0; i < data.length; i++) {
			const result = validator.safeParse(data[i]);
			if (result.success) {
				validatedItems.push(result.data);
			} else {
				for (const issue of result.error.issues) {
					const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
					errors.push(`[${i}].${path}: ${issue.message}`);
				}
			}
		}

		if (errors.length > 0) {
			return { success: false, errors };
		}
		return { success: true, data: validatedItems };
	}

	const result = validator.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}

	const errors = result.error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `${path}: ${issue.message}`;
	});

	return { success: false, errors };
}
