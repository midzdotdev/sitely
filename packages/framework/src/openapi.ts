import type { SiteDefinition } from "./types.js";

// ── JSON Schema Mappings ──────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

const thingProperties: Record<string, JsonSchema> = {
	"@type": { type: "string", description: "Schema.org type" },
	name: { type: "string" },
	url: { type: "string", format: "uri" },
	description: { type: "string" },
	image: {
		oneOf: [{ type: "string", format: "uri" }, { $ref: "#/components/schemas/ImageObject" }],
	},
	sameAs: {
		oneOf: [
			{ type: "string", format: "uri" },
			{ type: "array", items: { type: "string" } },
		],
	},
	identifier: { type: "string" },
};

const imageObjectProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["ImageObject"] },
	contentUrl: { type: "string", format: "uri" },
	width: { oneOf: [{ type: "number" }, { type: "string" }] },
	height: { oneOf: [{ type: "number" }, { type: "string" }] },
	caption: { type: "string" },
};

const contactPointProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["ContactPoint"] },
	telephone: { type: "string" },
	contactType: { type: "string" },
	email: { type: "string", format: "email" },
};

const organizationProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Organization"] },
	logo: {
		oneOf: [{ type: "string", format: "uri" }, { $ref: "#/components/schemas/ImageObject" }],
	},
	foundingDate: { type: "string" },
	contactPoint: { $ref: "#/components/schemas/ContactPoint" },
};

const personProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Person"] },
	givenName: { type: "string" },
	familyName: { type: "string" },
	email: { type: "string", format: "email" },
	jobTitle: { type: "string" },
	affiliation: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Organization" }],
	},
	birthDate: { type: "string" },
	nationality: { type: "string" },
};

const ratingProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Rating"] },
	ratingValue: { oneOf: [{ type: "number" }, { type: "string" }] },
	bestRating: { oneOf: [{ type: "number" }, { type: "string" }] },
	worstRating: { oneOf: [{ type: "number" }, { type: "string" }] },
};

const aggregateRatingProperties: Record<string, JsonSchema> = {
	...ratingProperties,
	"@type": { type: "string", enum: ["AggregateRating"] },
	reviewCount: { type: "number" },
	ratingCount: { type: "number" },
};

const offerProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Offer"] },
	price: { oneOf: [{ type: "number" }, { type: "string" }] },
	priceCurrency: { type: "string" },
	availability: { type: "string" },
	seller: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Organization" }],
	},
	validFrom: { type: "string" },
	validThrough: { type: "string" },
};

const reviewProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Review"] },
	reviewBody: { type: "string" },
	reviewRating: { $ref: "#/components/schemas/Rating" },
	author: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Person" }],
	},
	datePublished: { type: "string" },
	itemReviewed: { $ref: "#/components/schemas/Thing" },
};

const articleProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Article"] },
	headline: { type: "string" },
	author: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Person" }],
	},
	datePublished: { type: "string" },
	dateModified: { type: "string" },
	publisher: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Organization" }],
	},
	articleBody: { type: "string" },
	wordCount: { type: "number" },
	keywords: {
		oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
	},
	thumbnailUrl: { type: "string", format: "uri" },
};

const productProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["Product"] },
	brand: {
		oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Organization" }],
	},
	sku: { type: "string" },
	gtin: { type: "string" },
	offers: {
		oneOf: [
			{ $ref: "#/components/schemas/Offer" },
			{ type: "array", items: { $ref: "#/components/schemas/Offer" } },
		],
	},
	aggregateRating: { $ref: "#/components/schemas/AggregateRating" },
	review: {
		oneOf: [
			{ $ref: "#/components/schemas/Review" },
			{ type: "array", items: { $ref: "#/components/schemas/Review" } },
		],
	},
	category: { type: "string" },
	color: { type: "string" },
	material: { type: "string" },
};

const videoObjectProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["VideoObject"] },
	contentUrl: { type: "string", format: "uri" },
	embedUrl: { type: "string", format: "uri" },
	duration: { type: "string" },
	uploadDate: { type: "string" },
	thumbnailUrl: { type: "string", format: "uri" },
	transcript: { type: "string" },
	width: { oneOf: [{ type: "number" }, { type: "string" }] },
	height: { oneOf: [{ type: "number" }, { type: "string" }] },
};

const listItemProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["ListItem"] },
	position: { type: "number" },
	item: { $ref: "#/components/schemas/Thing" },
};

const itemListProperties: Record<string, JsonSchema> = {
	...thingProperties,
	"@type": { type: "string", enum: ["ItemList"] },
	itemListElement: {
		type: "array",
		items: { $ref: "#/components/schemas/ListItem" },
	},
	numberOfItems: { type: "number" },
	itemListOrder: { type: "string" },
};

/** Map of Schema enum values to their JSON Schema component definitions. */
const schemaComponentMap: Record<string, { properties: Record<string, JsonSchema> }> = {
	Thing: { properties: thingProperties },
	Article: { properties: articleProperties },
	Product: { properties: productProperties },
	Person: { properties: personProperties },
	Organization: { properties: organizationProperties },
	VideoObject: { properties: videoObjectProperties },
	ItemList: { properties: itemListProperties },
	Review: { properties: reviewProperties },
	ImageObject: { properties: imageObjectProperties },
};

/** Supporting schemas that are referenced via $ref but not in the Schema enum directly. */
const supportingSchemas: Record<string, { properties: Record<string, JsonSchema> }> = {
	ContactPoint: { properties: contactPointProperties },
	Offer: { properties: offerProperties },
	Rating: { properties: ratingProperties },
	AggregateRating: { properties: aggregateRatingProperties },
	ListItem: { properties: listItemProperties },
};

// ── OpenAPI Generator ─────────────────────────────────────────────

function buildComponentSchemas(): Record<string, JsonSchema> {
	const schemas: Record<string, JsonSchema> = {};

	for (const [name, def] of Object.entries(schemaComponentMap)) {
		schemas[name] = {
			type: "object",
			properties: def.properties,
			additionalProperties: true,
		};
	}

	for (const [name, def] of Object.entries(supportingSchemas)) {
		schemas[name] = {
			type: "object",
			properties: def.properties,
			additionalProperties: true,
		};
	}

	// Error response
	// biome-ignore lint/complexity/useLiteralKeys: index signature requires bracket access
	schemas["ErrorResponse"] = {
		type: "object",
		required: ["error"],
		properties: {
			error: { type: "string", description: "Human-readable error message" },
		},
	};

	// Extract response wrapper
	// biome-ignore lint/complexity/useLiteralKeys: index signature requires bracket access
	schemas["ExtractResponse"] = {
		type: "object",
		required: ["status", "data", "definitionType", "cost"],
		properties: {
			status: {
				type: "string",
				enum: ["success", "blocked", "stale", "forbidden_by_robots", "error"],
				description: "Extraction result status",
			},
			data: {
				type: "object",
				additionalProperties: true,
				description: "Extracted structured data",
			},
			definitionType: {
				type: "string",
				enum: ["site", "fallback"],
				description: "Whether a site-specific definition or generic fallback was used",
			},
			cost: {
				type: "object",
				properties: {
					tokens: {
						type: "number",
						description: "Number of tokens consumed by this request",
					},
				},
				required: ["tokens"],
			},
		},
	};

	return schemas;
}

function buildErrorResponses(): Record<string, JsonSchema> {
	return {
		"400": {
			description: "Bad request — missing or invalid parameters",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/ErrorResponse" },
				},
			},
		},
		"401": {
			description: "Unauthorized — missing or invalid API key",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/ErrorResponse" },
				},
			},
		},
		"404": {
			description: "Not found — unknown site or resource",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/ErrorResponse" },
				},
			},
		},
		"429": {
			description: "Rate limited — too many requests",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/ErrorResponse" },
				},
			},
		},
		"500": {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/ErrorResponse" },
				},
			},
		},
	};
}

function buildResourcePath(site: SiteDefinition, resourceName: string): JsonSchema {
	const resource = site.resources[resourceName]!;

	// Build query parameters from resource params
	const parameters: JsonSchema[] = Object.entries(resource.params).map(([name, param]) => ({
		name,
		in: "query",
		required: param.required,
		description: param.description,
		schema: { type: param.type === "number" ? "number" : "string" },
	}));

	// Determine the response schema ref
	const schemaRef = schemaComponentMap[resource.schema]
		? `#/components/schemas/${resource.schema}`
		: "#/components/schemas/Thing";

	return {
		get: {
			operationId: `get_${site.domain.replace(/\./g, "_")}_${resourceName}`,
			summary: `Extract ${resourceName} from ${site.name}`,
			description: `Extracts structured ${resource.schema} data for the "${resourceName}" resource from ${site.domain}. TTL: ${resource.ttl}.`,
			tags: [site.domain],
			security: [{ apiKey: [] }],
			parameters,
			responses: {
				"200": {
					description: "Successful extraction",
					content: {
						"application/json": {
							schema: {
								allOf: [
									{ $ref: "#/components/schemas/ExtractResponse" },
									{
										type: "object",
										properties: {
											data: {
												type: "object",
												properties: {
													[resourceName]: { $ref: schemaRef },
												},
											},
										},
									},
								],
							},
						},
					},
				},
				...buildErrorResponses(),
			},
		},
	};
}

/**
 * Generates a complete OpenAPI 3.1 specification from an array of site definitions.
 *
 * The generated spec documents the API server routes for each site's resources,
 * following the pattern: `GET /v1/sites/{domain}/{resource}`.
 */
export function generateOpenApiSpec(sites: SiteDefinition[]): Record<string, unknown> {
	const paths: Record<string, JsonSchema> = {};

	for (const site of sites) {
		for (const resourceName of Object.keys(site.resources)) {
			const pathKey = `/v1/sites/${site.domain}/${resourceName}`;
			paths[pathKey] = buildResourcePath(site, resourceName);
		}
	}

	// Add generic extract endpoint
	paths["/v1/extract"] = {
		get: {
			operationId: "extract_by_url",
			summary: "Extract structured data from any URL",
			description:
				"Extracts structured data from a given URL. Uses a site-specific definition if available, otherwise falls back to generic metadata extraction (JSON-LD, OpenGraph, meta tags).",
			tags: ["extract"],
			security: [{ apiKey: [] }],
			parameters: [
				{
					name: "url",
					in: "query",
					required: true,
					description: "The URL to extract data from",
					schema: { type: "string", format: "uri" },
				},
			],
			responses: {
				"200": {
					description: "Successful extraction",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/ExtractResponse" },
						},
					},
				},
				...buildErrorResponses(),
			},
		},
	};

	// Add discovery endpoints
	paths["/v1/sites"] = {
		get: {
			operationId: "list_sites",
			summary: "List all available site definitions",
			description:
				"Returns a list of all registered site definitions and their resources. No authentication required.",
			tags: ["discovery"],
			responses: {
				"200": {
					description: "List of sites",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									sites: {
										type: "array",
										items: {
											type: "object",
											properties: {
												name: { type: "string" },
												domain: { type: "string" },
												resources: {
													type: "array",
													items: {
														type: "object",
														properties: {
															name: { type: "string" },
															schema: { type: "string" },
															params: {
																type: "object",
																additionalProperties: true,
															},
															ttl: { type: "string" },
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	};

	paths["/v1/sites/{domain}"] = {
		get: {
			operationId: "get_site",
			summary: "Get details for a specific site",
			description:
				"Returns detailed information about a site definition including its resources and page patterns. No authentication required.",
			tags: ["discovery"],
			parameters: [
				{
					name: "domain",
					in: "path",
					required: true,
					description: "The site domain",
					schema: { type: "string" },
				},
			],
			responses: {
				"200": {
					description: "Site details",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									name: { type: "string" },
									domain: { type: "string" },
									aliases: {
										type: "array",
										items: { type: "string" },
									},
									resources: {
										type: "array",
										items: {
											type: "object",
											properties: {
												name: { type: "string" },
												schema: { type: "string" },
												params: {
													type: "object",
													additionalProperties: true,
												},
												ttl: { type: "string" },
											},
										},
									},
									pages: {
										type: "array",
										items: {
											type: "object",
											properties: {
												pattern: { type: "string" },
												provides: {
													type: "array",
													items: { type: "string" },
												},
												examples: {
													type: "array",
													items: { type: "string" },
												},
												hasPagination: { type: "boolean" },
											},
										},
									},
								},
							},
						},
					},
				},
				"404": {
					description: "Site not found",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/ErrorResponse" },
						},
					},
				},
			},
		},
	};

	paths["/v1/schemas"] = {
		get: {
			operationId: "list_schemas",
			summary: "List all supported schemas",
			description:
				"Returns a list of all schema.org types supported by the API. No authentication required.",
			tags: ["discovery"],
			responses: {
				"200": {
					description: "List of schemas",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									schemas: {
										type: "array",
										items: {
											type: "object",
											properties: {
												name: { type: "string" },
												type: { type: "string" },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	};

	// Add health endpoint
	paths["/health"] = {
		get: {
			operationId: "health_check",
			summary: "Health check",
			description: "Returns the health status of the API server.",
			tags: ["system"],
			responses: {
				"200": {
					description: "Server is healthy",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									status: { type: "string", enum: ["ok"] },
								},
							},
						},
					},
				},
			},
		},
	};

	// Build tag descriptions from sites
	const tags: Array<{ name: string; description: string }> = [
		{ name: "extract", description: "Generic URL extraction" },
		{ name: "discovery", description: "Site and schema discovery (no auth required)" },
		{ name: "system", description: "System endpoints" },
	];

	for (const site of sites) {
		tags.push({
			name: site.domain,
			description: `${site.name} — resources: ${Object.keys(site.resources).join(", ")}`,
		});
	}

	return {
		openapi: "3.1.0",
		info: {
			title: "sitely — Web API",
			version: "0.1.0",
			description:
				"Structured data extraction API. Provides site-specific scrapers that return schema.org-typed JSON for supported sites, with a generic fallback extractor for any URL.",
			contact: {
				name: "sitely",
			},
			license: {
				name: "Apache-2.0",
			},
		},
		servers: [
			{
				url: "http://localhost:3000",
				description: "Local development server",
			},
		],
		tags,
		paths,
		components: {
			securitySchemes: {
				apiKey: {
					type: "apiKey",
					in: "header",
					name: "x-api-key",
					description: "API key obtained from the /v1/auth/signup endpoint",
				},
			},
			schemas: buildComponentSchemas(),
		},
	};
}
