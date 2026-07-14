/**
 * Internal parsed representation of a pattern. Not part of the public API — the
 * shared shape that `parse` produces and `encode`/`decode` consume.
 */

export interface LiteralSegment {
	readonly kind: "literal";
	/** Decoded literal text of one path segment. */
	readonly value: string;
}

export interface ParamSegment {
	readonly kind: "param";
	readonly name: string;
	readonly optional: boolean;
}

export type PathSegment = LiteralSegment | ParamSegment;

export interface LiteralQueryValue {
	readonly kind: "literal";
	/** The query pair must be present with exactly this decoded value to match. */
	readonly value: string;
}

export interface ParamQueryValue {
	readonly kind: "param";
	readonly name: string;
	readonly optional: boolean;
}

export interface QueryPair {
	/** Decoded query key. */
	readonly key: string;
	readonly value: LiteralQueryValue | ParamQueryValue;
}

export interface ParamInfo {
	readonly name: string;
	readonly optional: boolean;
}

export interface PatternAst {
	/** The original pattern string, for diagnostics. */
	readonly source: string;
	/** Ordered path segments (after the leading `/`). */
	readonly path: readonly PathSegment[];
	/** Declared query pairs, in declaration order (order is the canonical emission order). */
	readonly query: readonly QueryPair[];
	/** Every param (path + query), for the same-params-across-aliases check. */
	readonly params: readonly ParamInfo[];
}
