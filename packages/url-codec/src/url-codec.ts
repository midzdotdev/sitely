/**
 * The public factory. Parses the canonical pattern (and any aliases) into ASTs,
 * enforces that every alias exposes the same params as the canonical, and returns
 * a codec whose `toUrl` builds only from the canonical form while `fromUrl` matches
 * against the canonical and every alias, canonical first.
 */
import { matchUrl } from "./decode";
import { buildUrl } from "./encode";
import { URLCodecError } from "./errors";
import { parsePattern } from "./parse";
import type { ParamInfo } from "./ast";
import type { ExtractParams, FromUrlOptions, ToUrlOptions, URLCodec } from "./types";

export function urlCodec<P extends string>(
	canonical: P,
	opts?: {
		aliases?: string[];
		paramsSchema?: Partial<Record<keyof ExtractParams<P>, Record<string, unknown>>>;
	},
): URLCodec<ExtractParams<P>> {
	const aliasPatterns = opts?.aliases ?? [];
	const paramsSchema = opts?.paramsSchema;

	// Phase 1 — parse. `parsePattern` throws `invalid-pattern` for malformed syntax,
	// wildcards, regex groups, or duplicate params. Canonical first, then each alias,
	// so every parse error surfaces before the same-params check runs.
	const canonicalAst = parsePattern(canonical);
	const aliasAsts = aliasPatterns.map((alias) => parsePattern(alias));

	// Phase 2 — same-params. Every alias must expose the identical set of
	// `{ name, optional }` params as the canonical, else `alias-params-mismatch`.
	for (const aliasAst of aliasAsts) {
		if (!sameParams(canonicalAst.params, aliasAst.params)) {
			throw new URLCodecError(
				"alias-params-mismatch",
				`Alias "${aliasAst.source}" must expose the same params as canonical "${canonicalAst.source}".`,
			);
		}
	}

	return {
		canonical,
		aliases: [...aliasPatterns],
		...(paramsSchema ? { paramsSchema } : {}),
		toUrl(params: ExtractParams<P>, o?: ToUrlOptions): string {
			return buildUrl(canonicalAst, params as Record<string, string>, o?.base);
		},
		fromUrl(url: string | URL, o?: FromUrlOptions): ExtractParams<P> | null {
			return matchUrl([canonicalAst, ...aliasAsts], url, o?.base) as ExtractParams<P> | null;
		},
	} as URLCodec<ExtractParams<P>>;
}

/**
 * Two patterns expose the same params iff their param lists are equal as sets of
 * `{ name, optional }`. Param names are unique within a pattern (the parser rejects
 * duplicates), so a length check plus a name→optional lookup is an exact set test.
 */
function sameParams(a: readonly ParamInfo[], b: readonly ParamInfo[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const optionalByName = new Map<string, boolean>();
	for (const param of a) {
		optionalByName.set(param.name, param.optional);
	}
	for (const param of b) {
		// `get` yields `undefined` for a name absent from `a`, which never equals a
		// boolean `optional` — so an unmatched or differently-optional param fails here.
		if (optionalByName.get(param.name) !== param.optional) {
			return false;
		}
	}
	return true;
}
