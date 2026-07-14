/**
 * Internal function-signature contract. `parse`/`encode`/`decode` each implement
 * exactly one of these, so the modules compose without drifting.
 */
import type { PatternAst } from "./ast";

/**
 * Parse a pattern into its AST. Throws `URLCodecError("invalid-pattern")` on
 * wildcards (`*`), regex groups (`(...)`), duplicate param names, or malformed
 * syntax (a bare `:`, an empty literal query key, a repeated query key).
 */
export type ParsePattern = (pattern: string) => PatternAst;

/**
 * Build the canonical URL for `params`. Root-relative (leading `/`) unless `base`
 * is given, in which case an absolute URL on the base's origin. Percent-encodes
 * per component. Throws `URLCodecError("missing-param")` for an absent required
 * param and `URLCodecError("empty-param")` for a `""` value.
 */
export type BuildUrl = (
	ast: PatternAst,
	params: Record<string, string>,
	base?: string | URL,
) => string;

/**
 * Match `url` against the ordered ASTs (canonical first, then aliases); first
 * match wins. Returns the decoded params, or `null` on no match. Never throws.
 * Undeclared query params and the fragment are ignored; an absolute input with a
 * `base` must share the base's origin.
 */
export type MatchUrl = (
	asts: readonly PatternAst[],
	url: string | URL,
	base?: string | URL,
) => Record<string, string> | null;
