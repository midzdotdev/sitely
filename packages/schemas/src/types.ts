/** Base schema.org Thing — all other types extend this. */
export interface Thing {
	"@type"?: string;
	name?: string;
	url?: string;
	description?: string;
	image?: string | ImageObject;
	sameAs?: string | string[];
	identifier?: string;
}

export interface ImageObject extends Thing {
	"@type"?: "ImageObject";
	contentUrl?: string;
	width?: number | string;
	height?: number | string;
	caption?: string;
}

export interface Article extends Thing {
	"@type"?: "Article";
	headline?: string;
	author?: Person | string;
	datePublished?: string;
	dateModified?: string;
	publisher?: Organization | string;
	articleBody?: string;
	wordCount?: number;
	keywords?: string | string[];
	thumbnailUrl?: string;
}

export interface Product extends Thing {
	"@type"?: "Product";
	brand?: string | Organization;
	sku?: string;
	gtin?: string;
	offers?: Offer | Offer[];
	aggregateRating?: AggregateRating;
	review?: Review | Review[];
	category?: string;
	color?: string;
	material?: string;
}

export interface Offer extends Thing {
	"@type"?: "Offer";
	price?: number | string;
	priceCurrency?: string;
	availability?: string;
	seller?: Organization | string;
	validFrom?: string;
	validThrough?: string;
}

export interface Person extends Thing {
	"@type"?: "Person";
	givenName?: string;
	familyName?: string;
	email?: string;
	jobTitle?: string;
	affiliation?: Organization | string;
	birthDate?: string;
	nationality?: string;
}

export interface Organization extends Thing {
	"@type"?: "Organization";
	logo?: string | ImageObject;
	foundingDate?: string;
	contactPoint?: ContactPoint;
}

export interface ContactPoint extends Thing {
	"@type"?: "ContactPoint";
	telephone?: string;
	contactType?: string;
	email?: string;
}

export interface VideoObject extends Thing {
	"@type"?: "VideoObject";
	contentUrl?: string;
	embedUrl?: string;
	duration?: string;
	uploadDate?: string;
	thumbnailUrl?: string;
	transcript?: string;
	width?: number | string;
	height?: number | string;
}

export interface ItemList extends Thing {
	"@type"?: "ItemList";
	itemListElement?: ListItem[];
	numberOfItems?: number;
	itemListOrder?: string;
}

export interface ListItem extends Thing {
	"@type"?: "ListItem";
	position?: number;
	item?: Thing;
}

export interface Review extends Thing {
	"@type"?: "Review";
	reviewBody?: string;
	reviewRating?: Rating;
	author?: Person | string;
	datePublished?: string;
	itemReviewed?: Thing;
}

export interface Rating extends Thing {
	"@type"?: "Rating";
	ratingValue?: number | string;
	bestRating?: number | string;
	worstRating?: number | string;
}

export interface AggregateRating extends Omit<Rating, "@type"> {
	"@type"?: "AggregateRating";
	reviewCount?: number;
	ratingCount?: number;
}
