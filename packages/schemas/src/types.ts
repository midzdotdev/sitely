/**
 * Hand-written schema.org types for the sitely MVP.
 *
 * These cover the most common structured data types encountered in web extraction.
 * Each interface maps directly to its schema.org counterpart. All fields are optional
 * because extracted data is often incomplete.
 *
 * @see {@link https://schema.org | schema.org} for field-level documentation.
 *
 * @packageDocumentation
 */

/** Base type shared by all schema.org entities. See {@link https://schema.org/Thing}. */
export interface Thing {
	"@type"?: string;
	name?: string;
	url?: string;
	description?: string;
	image?: string | ImageObject;
	identifier?: string;
}

/** A visual image. See {@link https://schema.org/ImageObject}. */
export interface ImageObject extends Thing {
	"@type"?: "ImageObject";
	contentUrl?: string;
	width?: number;
	height?: number;
	caption?: string;
	thumbnailUrl?: string;
}

/** A written work such as a news story or blog post. See {@link https://schema.org/Article}. */
export interface Article extends Thing {
	"@type"?: "Article";
	headline?: string;
	author?: string | Person | (string | Person)[];
	datePublished?: string;
	dateModified?: string;
	publisher?: string | Organization;
	articleBody?: string;
	wordCount?: number;
	keywords?: string[];
	inLanguage?: string;
	thumbnailUrl?: string;
}

/** An individual person. See {@link https://schema.org/Person}. */
export interface Person extends Thing {
	"@type"?: "Person";
	givenName?: string;
	familyName?: string;
	email?: string;
	jobTitle?: string;
	affiliation?: string | Organization;
	birthDate?: string;
	nationality?: string;
}

/** A company, nonprofit, or other organization. See {@link https://schema.org/Organization}. */
export interface Organization extends Thing {
	"@type"?: "Organization";
	logo?: string | ImageObject;
	foundingDate?: string;
	founder?: string | Person;
	address?: string;
	contactPoint?: string;
}

/** A commercial product. See {@link https://schema.org/Product}. */
export interface Product extends Thing {
	"@type"?: "Product";
	brand?: string | Organization;
	sku?: string;
	gtin?: string;
	price?: number;
	priceCurrency?: string;
	availability?: string;
	category?: string;
	color?: string;
	material?: string;
	weight?: string;
	reviews?: Review[];
	aggregateRating?: AggregateRating;
}

/** A user review of something. See {@link https://schema.org/Review}. */
export interface Review extends Thing {
	"@type"?: "Review";
	author?: string | Person;
	datePublished?: string;
	reviewBody?: string;
	reviewRating?: Rating;
}

/** A numerical quality rating. See {@link https://schema.org/Rating}. */
export interface Rating extends Thing {
	"@type"?: string;
	ratingValue?: number;
	bestRating?: number;
	worstRating?: number;
}

/** An aggregate of multiple ratings. See {@link https://schema.org/AggregateRating}. */
export interface AggregateRating extends Rating {
	"@type"?: "AggregateRating";
	reviewCount?: number;
	ratingCount?: number;
}

/** A video recording. See {@link https://schema.org/VideoObject}. */
export interface VideoObject extends Thing {
	"@type"?: "VideoObject";
	contentUrl?: string;
	embedUrl?: string;
	duration?: string;
	uploadDate?: string;
	thumbnailUrl?: string;
	transcript?: string;
	width?: number;
	height?: number;
}

/** A single web page. See {@link https://schema.org/WebPage}. */
export interface WebPage extends Thing {
	"@type"?: "WebPage";
	breadcrumb?: string;
	mainEntity?: Thing;
	primaryImageOfPage?: ImageObject;
	datePublished?: string;
	dateModified?: string;
	inLanguage?: string;
}

/** An ordered or unordered list of items. See {@link https://schema.org/ItemList}. */
export interface ItemList extends Thing {
	"@type"?: "ItemList";
	numberOfItems?: number;
	itemListElement?: ListItem[];
	itemListOrder?: string;
}

/** A single item within an {@link ItemList}. See {@link https://schema.org/ListItem}. */
export interface ListItem extends Thing {
	"@type"?: "ListItem";
	position?: number;
	item?: Thing;
}

/** Union of all supported schema types. */
export type SchemaType =
	| Article
	| Person
	| Organization
	| Product
	| VideoObject
	| WebPage
	| ItemList
	| ImageObject
	| Review;

/** String literal names for schema types, used as identifiers in site definitions. */
export type SchemaTypeName =
	| "Article"
	| "Person"
	| "Organization"
	| "Product"
	| "VideoObject"
	| "WebPage"
	| "ItemList"
	| "ImageObject"
	| "Review";
