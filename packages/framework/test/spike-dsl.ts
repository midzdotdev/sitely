// TYPE-SYSTEM SPIKE (ticket #5) — THROWAWAY. A types-only prototype of the `03` DSL surface,
// declared (no runtime), against the LOCKED `@sitely/contracts` + real `typebox@1.2.8`. Its job is to
// prove the authoring-inference chain composes BEFORE `03` is built (#10): builder `const E` capture,
// `FieldFns<Static<schema>>` mismatch legibility, `ExtractParams` path+query, and `Page<E>` erasure.
// Delete or absorb when #10 lands. Signatures mirror docs/plan/03-framework-dsl.md.
//
// typebox 1.x note: `Type` is a DEFAULT export; `Static`/`TSchema`/`TObject`/… are NAMED type exports
// (so the spec's bare `Static<S>` resolves — no rename churn at the type level).

import type { Static, TSchema } from "typebox";
import type { ExtractParams, URLCodec } from "@sitely/url-codec";
import type {
	Asset,
	AssetType,
	Binding,
	ExtractContext,
	FieldFns,
	FixtureSpec,
	Interface,
	JsonSchema,
	MediaFormat,
	PageController,
	PageDef,
	Resource,
	SiteDefinition,
} from "@sitely/contracts";

// Re-surface ExtractParams so tests can assert path+query inference agrees with the codec.
export type { ExtractParams };

// resource — item symbol. TypeBox overload (`Static<S>` gives the item type `T`) + a raw JSON-Schema
// escape hatch (then `T = unknown`, losing field-level checks).
export declare function resource<Name extends string, S extends TSchema>(
	name: Name,
	schema: S,
	opts?: { key?: keyof Static<S> & string },
): Resource<Name, Static<S>>;
export declare function resource<Name extends string>(
	name: Name,
	schema: JsonSchema,
	opts?: { key?: string },
): Resource<Name, unknown>;

// defineInterface — a named schema claim; TypeBox overload + raw escape hatch.
export declare function defineInterface<N extends string, S extends TSchema>(
	name: N,
	schema: S,
): Interface<N, Static<S>>;
export declare function defineInterface<N extends string>(
	name: N,
	schema: JsonSchema,
): Interface<N, unknown>;

// The page builder — its methods type each binding's `ctx.params` as the page's `TParams`, because
// the binding is created INSIDE the page where the path's params are known.
export interface PageBuilder<TParams extends Record<string, string>> {
	one<N extends string, T>(
		r: Resource<N, T>,
		extract: (ctx: ExtractContext<TParams>) => FieldFns<T>,
	): Binding<N, T, "one">;
	many<N extends string, T>(
		r: Resource<N, T>,
		extract: (ctx: ExtractContext<TParams>) => FieldFns<T>[],
	): Binding<N, T, "many">;
}

// Page<E> — the authoring form `page()` returns: a PageDef plus a compile-time capture of `E` (the
// extract map's shape). `defineSite` erases `E` → a plain PageDef.
export interface Page<E extends Record<string, Binding> = Record<string, Binding>> {
	readonly __def: PageDef;
	readonly __bindings?: E;
}

// page — captures `E` from `extract(p)`'s return with a `const` type parameter; `TParams` is inferred
// from `path: URLCodec<TParams>`. Static/dynamic discriminated union; `prepare?: never` on the static
// arm keeps `prepare` a compile error even with `render` omitted.
export declare function page<
	TParams extends Record<string, string>,
	const E extends Record<string, Binding>,
>(
	def:
		| {
				render?: "static";
				path: URLCodec<TParams>;
				validate: (ctx: ExtractContext<TParams>) => boolean;
				prepare?: never;
				extract: (p: PageBuilder<TParams>) => E;
				fixtures: FixtureSpec<TParams>[];
		  }
		| {
				render: "dynamic";
				path: URLCodec<TParams>;
				validate: (ctx: ExtractContext<TParams>) => boolean;
				prepare?: (page: PageController) => Promise<void>;
				extract: (p: PageBuilder<TParams>) => E;
				fixtures: FixtureSpec<TParams>[];
		  },
): Page<E>;

// defineSite — assembles page symbols; erases each `Page<E>` → the runtime PageDef, keyed by name.
export declare function defineSite(config: {
	id: string;
	displayName: string;
	origin: string;
	pages: Record<string, Page>;
}): SiteDefinition;

// asset — the value helpers carry the LITERAL kind (`Asset<K>`); the generic schema helper is kept
// loose here (its precise `TObject` return is a `03`/`04` concern, not one of #5's four points).
export declare const asset: {
	<K extends AssetType>(kind: K): TSchema;
	image(url: string, opts?: { mimeType?: string }): Asset<"image">;
	video(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset<"video">;
	audio(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset<"audio">;
	document(url: string, opts?: { mimeType?: string }): Asset<"document">;
};

// presence — wraps a field schema with its expected-present rate; the rate is type-level-guarded to a
// number literal in [0,1] (the tuple in the false branch makes the error self-explanatory).
export declare function presence<S extends TSchema, N extends number>(
	schema: S,
	rate: `${N}` extends "0" | "1" | `0.${string}`
		? N
		: ["presence(): rate must be a number literal in [0,1]; got", N],
): S;
