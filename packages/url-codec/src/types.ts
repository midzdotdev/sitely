/**
 * The public type surface: typed param inference from a pattern string, and the
 * `URLCodec` value interface. Kept dependency-free — schema values are opaque
 * `Record<string, unknown>` (identical to JSON Schema; the codec imports nothing).
 */

/* -------------------------------------------------------------------------- */
/* Param inference                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `ExtractParams<P>` reads the typed params out of a pattern's path AND query
 * tail: `:name` → `{ name: string }`, `:name?` → `{ name?: string }`.
 *
 * Optionality is marked solely by a `?` immediately after a param name. The
 * query-separator `?` always follows a literal (never a name), so the two uses
 * of `?` never collide — a uniform scan over the whole string is correct.
 */
export type ExtractParams<P extends string> = Simplify<ScanParams<P>>;

/** Characters that terminate a param name inside the pattern grammar. */
type ParamDelimiter = "/" | "?" | "&" | "=";

/** Consume a param name — chars up to the next delimiter. Returns `[name, rest]`. */
type ReadName<S extends string, Name extends string = ""> = S extends `${infer C}${infer R}`
	? C extends ParamDelimiter
		? [Name, S]
		: ReadName<R, `${Name}${C}`>
	: [Name, ""];

/**
 * Optionality: a `?` immediately after a param name is the OPTIONAL marker only when it
 * is followed by a segment boundary — end of string, `/`, `&`, or another `?`. When a
 * query body follows the `?` directly (`:id?ref=:ref`), that `?` is the path/query
 * SEPARATOR and the param is required. Mirrors the runtime parser's separator rule, so
 * the inferred type and the runtime AST agree. Returns `[optional, rest]`.
 */
type SplitOptional<Rest extends string> = Rest extends `?${infer After}`
	? After extends "" | `/${string}` | `&${string}` | `?${string}`
		? [true, After]
		: [false, Rest]
	: [false, Rest];

/** Walk the pattern, accumulating each `:name`/`:name?` into the param record. */
type ScanParams<
	S extends string,
	Acc extends Record<string, string> = Record<never, never>,
> = S extends `${string}:${infer Rest}`
	? ReadName<Rest> extends [infer Name extends string, infer AfterName extends string]
		? Name extends ""
			? Acc
			: SplitOptional<AfterName> extends [infer Opt extends boolean, infer Tail extends string]
				? ScanParams<
						Tail,
						Acc & (Opt extends true ? Partial<Record<Name, string>> : Record<Name, string>)
					>
				: Acc
		: Acc
	: Acc;

/** Flatten an intersection into a single object type, preserving optional modifiers. */
type Simplify<T> = { [K in keyof T]: T[K] };

/* -------------------------------------------------------------------------- */
/* The codec value                                                            */
/* -------------------------------------------------------------------------- */

export interface ToUrlOptions {
	/** Origin source (`scheme://host[:port]`); any path in the base is ignored. */
	readonly base?: string | URL;
}

export interface FromUrlOptions {
	/** Origin an absolute input must match (equal `URL.origin`); ignored for relative input. */
	readonly base?: string | URL;
}

// NOTE: `TParams` is intentionally unconstrained (default `Record<string, string>`).
// A `TParams extends Record<string, string>` bound cannot be satisfied by
// `URLCodec<ExtractParams<P>>` for a generic `P` — a template-literal-derived type is
// opaque to the constraint checker. The default preserves the semantic intent; every
// value the factory produces is a string map. (tsc-forced refinement of the 05/00 spec.)
export interface URLCodec<TParams = Record<string, string>> {
	/** The canonical pattern; `toUrl` builds only from this. */
	readonly canonical: string;
	/** Match-only alternates converging on the canonical (may be empty). */
	readonly aliases: readonly string[];
	/** Per-param JSON Schema metadata; documentation/generation only, no match-time enforcement. */
	readonly paramsSchema?: Readonly<Partial<Record<keyof TParams, Record<string, unknown>>>>;
	/** Build a URL for `params`. Root-relative unless `base` is given. Throws on missing/empty params. */
	toUrl(params: TParams, opts?: ToUrlOptions): string;
	/** Recognise a URL: its params, or `null` if it does not belong here. Never throws. */
	fromUrl(url: string | URL, opts?: FromUrlOptions): TParams | null;
}
