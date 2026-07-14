import type { ExtractContext } from "./context";
import type { JsonSchema } from "./schema";

/**
 * A resource is a NAMED ITEM SHAPE — never an array. It is the unit a consumer queries by and the
 * seam the v1 interface catalogue plugs into. It carries no extract logic itself; the per-page
 * extract (and its param typing) is attached at the page via the builder `p.one` / `p.many`.
 */
export interface Resource<Name extends string = string, T = unknown> {
	readonly name: Name;
	/** An ITEM schema — never `T[]`. */
	readonly schema: JsonSchema;
	/**
	 * Identity field, for addressing a single item (v1). Typed as `keyof Static<S> & string` at the
	 * 03 factory; here it is plain `string` because with `T = unknown`, `keyof T & string` is `never`.
	 */
	readonly key?: string;
	/**
	 * Phantom: carries the item type `T` for inference; absent at runtime. Load-bearing — without it
	 * `T` is unused, so `Resource<N, X>` and `Resource<N, Y>` collapse and the `p.one`/`p.many`
	 * builder (03) could not type its field map against `Static<schema>`. Mirrors `Interface.__static`.
	 */
	readonly __item?: T;
}

/**
 * Every field has a SYNCHRONOUS resolver, present even for optional fields (`-?` strips optionality
 * so nothing can be omitted). Even constants are functions — for per-field error isolation and drift
 * telemetry. Sync by design: extraction reads a settled snapshot.
 */
export type FieldFns<T> = { [K in keyof T]-?: () => T[K] };

/**
 * A resource + cardinality + its per-page extract. Produced by the page builder's
 * `p.one(resource, fn)` / `p.many(resource, fn)`; it appears as a value in the page's extract map. A
 * `one` binding's extract returns `FieldFns<T>`; a `many` binding's returns `FieldFns<T>[]`.
 */
export interface Binding<
	Name extends string = string,
	T = unknown,
	C extends "one" | "many" = "one" | "many",
> {
	readonly resource: Resource<Name, T>;
	readonly cardinality: C;
	readonly extract: (ctx: ExtractContext) => C extends "one" ? FieldFns<T> : FieldFns<T>[];
}
