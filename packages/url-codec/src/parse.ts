/**
 * `parsePattern` — turn a pattern string into its `PatternAst`, the shared shape
 * that `encode` (`toUrl`) and `decode` (`fromUrl`) consume.
 *
 * A pattern is a root-relative path optionally followed by a query tail. The
 * path/query boundary is the first `?` that is NOT a param's optional marker: a
 * `?` right after a param name is the optional marker only when what follows it
 * is a boundary (end-of-string, another `?`, `/`, or `&`). When a query body
 * follows the `?` directly (`/item/:id?ref=:ref`) that same `?` is the
 * separator and the preceding param stays required — matching how the DSL spells
 * an optional path param plus a query as a double `?` (`/x/:id/:opt??q=:q`).
 */
import type { ParamInfo, PathSegment, QueryPair } from "./ast";
import { URLCodecError } from "./errors";
import type { ParsePattern } from "./internal";

/** Reject the pattern; construction only ever throws `URLCodecError`. */
const invalid = (message: string): never => {
	throw new URLCodecError("invalid-pattern", message);
};

/** `decodeURIComponent`, but a malformed escape surfaces as `invalid-pattern`, never a raw `URIError`. */
const decode = (raw: string): string => {
	try {
		return decodeURIComponent(raw);
	} catch {
		return invalid(`malformed percent-encoding in pattern: "${raw}"`);
	}
};

/** Characters that terminate a param name (mirrors the type-level scanner's delimiters). */
const isNameEnd = (c: string | undefined): boolean =>
	c === undefined || c === "/" || c === "?" || c === "&" || c === "=";

/** After a param's `?`, these keep it an optional marker rather than a query separator. */
const isOptionalBoundary = (c: string | undefined): boolean =>
	c === undefined || c === "?" || c === "/" || c === "&";

/**
 * Index of the `?` that splits path from query, or `-1` when there is no query
 * tail. Each `:name?` optional marker is skipped so only a genuine separator wins.
 */
const findQuerySeparator = (pattern: string): number => {
	const len = pattern.length;
	let i = 0;
	while (i < len) {
		const c = pattern[i];
		if (c === ":") {
			i += 1; // consume the ":"
			const nameStart = i;
			while (i < len && !isNameEnd(pattern[i])) {
				i += 1;
			}
			if (i > nameStart && pattern[i] === "?") {
				if (isOptionalBoundary(pattern[i + 1])) {
					i += 1; // optional marker — consume it and keep scanning
					continue;
				}
				return i; // a query body follows directly — this `?` is the separator
			}
			continue;
		}
		if (c === "?") {
			return i;
		}
		i += 1;
	}
	return -1;
};

/** Parse the path portion (which starts with "/") into ordered segments and its params. */
const parsePath = (pathPart: string): { segments: PathSegment[]; params: ParamInfo[] } => {
	const segments: PathSegment[] = [];
	const params: ParamInfo[] = [];
	// `pathPart` starts with "/", so `split("/")`'s first element is the empty
	// leading segment; drop it. A trailing "/" keeps its trailing empty segment.
	for (const raw of pathPart.split("/").slice(1)) {
		if (raw.startsWith(":")) {
			const optional = raw.endsWith("?");
			const name = optional ? raw.slice(1, -1) : raw.slice(1);
			if (name === "") {
				invalid(`empty param name in path segment "${raw}"`);
			}
			if (name.includes(":")) {
				// A second ":" inside the name (`/:x:y`) is not a whole-segment param.
				invalid(`a ":" may not appear inside a param name: "${raw}"`);
			}
			segments.push({ kind: "param", name, optional });
			params.push({ name, optional });
		} else if (raw.includes(":")) {
			// A ":" anywhere but the segment start is an intended-but-dropped param
			// (`/@:user`, `/a:b`): type-level `ExtractParams` captures it, so silently
			// treating the segment as a literal would be unsound. Reject at construction.
			invalid(`a ":" param must occupy the whole path segment ("/:name"), not "${raw}"`);
		} else {
			segments.push({ kind: "literal", value: decode(raw) });
		}
	}
	return { segments, params };
};

/** Parse the query tail (everything after the separator `?`) into declared pairs and its params. */
const parseQuery = (queryPart: string): { pairs: QueryPair[]; params: ParamInfo[] } => {
	const pairs: QueryPair[] = [];
	const params: ParamInfo[] = [];
	if (queryPart === "") {
		return { pairs, params };
	}
	const seenKeys = new Set<string>();
	for (const rawPair of queryPart.split("&")) {
		const eq = rawPair.indexOf("=");
		const rawKey = eq === -1 ? rawPair : rawPair.slice(0, eq);
		const rawValue = eq === -1 ? "" : rawPair.slice(eq + 1);
		if (rawKey === "") {
			invalid(`empty query key in "${rawPair}"`);
		}
		const key = decode(rawKey);
		if (seenKeys.has(key)) {
			invalid(`query key "${key}" is declared more than once`);
		}
		seenKeys.add(key);
		if (rawValue.startsWith(":")) {
			const optional = rawValue.endsWith("?");
			const name = optional ? rawValue.slice(1, -1) : rawValue.slice(1);
			if (name === "") {
				invalid(`empty param name in query pair "${rawPair}"`);
			}
			if (name.includes(":")) {
				// A second ":" inside the name (`?a=:x:y`) is not a whole-value param.
				invalid(`a ":" may not appear inside a param name: "${rawPair}"`);
			}
			pairs.push({ key, value: { kind: "param", name, optional } });
			params.push({ name, optional });
		} else if (rawValue.includes(":")) {
			// Same whole-value rule as the path: a ":" that doesn't start the value is a
			// dropped param (`ref=a:b`), not a literal. Keys are out of scope. Reject here.
			invalid(`a ":" param must occupy the whole query value ("=:name"), not "${rawValue}"`);
		} else {
			pairs.push({ key, value: { kind: "literal", value: decode(rawValue) } });
		}
	}
	return { pairs, params };
};

export const parsePattern: ParsePattern = (pattern) => {
	if (!pattern.startsWith("/")) {
		invalid(`pattern must be a root-relative path starting with "/": "${pattern}"`);
	}
	if (pattern.includes("*")) {
		invalid(`wildcard "*" is not part of the reversible grammar: "${pattern}"`);
	}
	if (pattern.includes("(") || pattern.includes(")")) {
		invalid(`regex group "(...)" is not part of the reversible grammar: "${pattern}"`);
	}

	const sep = findQuerySeparator(pattern);
	const path = parsePath(sep === -1 ? pattern : pattern.slice(0, sep));
	const query = parseQuery(sep === -1 ? "" : pattern.slice(sep + 1));

	const params: ParamInfo[] = [...path.params, ...query.params];
	const seen = new Set<string>();
	for (const p of params) {
		if (seen.has(p.name)) {
			invalid(`param ":${p.name}" is declared more than once`);
		}
		seen.add(p.name);
	}

	return {
		source: pattern,
		path: path.segments,
		query: query.pairs,
		params,
	};
};
