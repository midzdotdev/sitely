// The JSON-Schema boundary — the required schema representation everywhere in v0, plus the typed
// asset shape, the named-schema-claim `Interface`, and the validation-boundary types. No
// validator-library type crosses this boundary (invariant 5); TypeBox is a recommended producer,
// not part of the contract. (Spec: 00 · The JSON-Schema boundary.)

/** A JSON Schema (draft 2020-12) object — the framework's boundary. TypeBox's `TSchema` satisfies it. */
export type JsonSchema = Record<string, unknown>;

/** The media KIND an asset carries. */
export type AssetType = "image" | "video" | "audio" | "document";

/** Transport for a media asset: `"hls"`/`"dash"` are manifests, `"progressive"` a direct file. */
export type MediaFormat = "hls" | "dash" | "progressive";

/**
 * A typed asset object in the extracted data — self-describing on the wire, interop-friendly.
 * Generic so the literal `type` survives (`Asset<"image">["type"]` is `"image"`, not `AssetType`).
 * `format` exists only where transport is meaningful (video/audio); asset schemas are closed, so a
 * `format` on an image is both a compile error and a validation failure. `url` is the SOURCE url as
 * found — not a durability or fetchability guarantee (delivery is a v1 concern).
 */
export type Asset<K extends AssetType = AssetType> = K extends "video" | "audio"
	? { url: string; type: K; format?: MediaFormat; mimeType?: string }
	: { url: string; type: K; mimeType?: string };

/**
 * A NAMED SCHEMA CLAIM — "data of type `name`, shaped like `schema`". Reifies the interop unit:
 * `ctx.jsonLd`'s parsed overload consumes `Interface` values today; in v1 the generated catalogue IS
 * a set of `Interface`s. The `kind` discriminant is load-bearing — a `Resource` is also structurally
 * name+schema, but its name is site-local vocabulary, so the discriminant makes `jsonLd(someResource)`
 * a compile error. Minted by `defineInterface` in the DSL (03).
 */
export interface Interface<N extends string = string, T = unknown> {
	readonly kind: "interface";
	/**
	 * The type's identity. A BARE name means schema.org (`"Article"`); a future non-schema.org
	 * vocabulary qualifies as a CURIE (`"fhir:Patient"`) — the convention is reserved now.
	 */
	readonly name: N;
	readonly schema: JsonSchema;
	/** Phantom: carries `T` for inference; absent at runtime. */
	readonly __static?: T;
}

/** A single schema violation. `path` is a JSON Pointer relative to the validated item. */
export interface SchemaIssue {
	path: string;
	message: string;
}

/** A schema violation decorated by the runner with the resource/output (and item index) it came from. */
export interface ValidationIssue {
	resource: string;
	output?: string;
	index?: number;
	path: string;
	message: string;
}

/**
 * The validation-boundary TYPE. The IMPLEMENTATION lives in @sitely/runtime (02) — an
 * Ajv/TypeBox-compiler dependency in the contracts root would hand every package a validator
 * (invariant 5). It knows only `(schema, data)`, so it returns bare `SchemaIssue`s; the runner
 * decorates them into `ValidationIssue`s with the names only it knows.
 */
export type ValidateExtraction = (
	schema: JsonSchema,
	data: unknown,
) => { ok: true } | { ok: false; issues: SchemaIssue[] };
