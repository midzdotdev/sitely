/**
 * `matchUrl` — recognise a URL against the ordered pattern ASTs (canonical first,
 * then aliases); the first match wins, otherwise `null`. Never throws: malformed
 * input, undecodable components, and origin mismatches all resolve to a non-match.
 *
 * Params are decoded strings. The query is parsed by hand with generic
 * percent-encoding (so `+` is a literal plus and space is `%20`, not form decoding),
 * the first occurrence of a key wins, and undeclared query params plus the fragment
 * are ignored.
 */
import type { PathSegment, QueryPair } from "./ast";
import type { MatchUrl } from "./internal";

/** An absolute URL is detected by its scheme prefix (RFC 3986 `scheme ":"`). */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/** Placeholder origin for resolving relative inputs; never compared against `base`. */
const RELATIVE_BASE = "http://placeholder.invalid";

/**
 * Match decoded path segments against the pattern's path, binding params into `out`.
 * Backtracks over optional params — patterns are assumed unambiguous, so at most one
 * arrangement succeeds. Returns whether both pattern and input were fully consumed.
 */
function matchPath(
	pattern: readonly PathSegment[],
	pi: number,
	input: readonly string[],
	si: number,
	out: Record<string, string>,
): boolean {
	if (pi >= pattern.length) {
		return si >= input.length;
	}
	const seg = pattern[pi];
	if (seg === undefined) {
		return false;
	}
	if (seg.kind === "literal") {
		const current = input[si];
		if (current === undefined || current !== seg.value) {
			return false;
		}
		return matchPath(pattern, pi + 1, input, si + 1, out);
	}
	if (seg.optional) {
		const current = input[si];
		if (current !== undefined) {
			out[seg.name] = current;
			if (matchPath(pattern, pi + 1, input, si + 1, out)) {
				return true;
			}
			delete out[seg.name];
		}
		return matchPath(pattern, pi + 1, input, si, out);
	}
	const current = input[si];
	if (current === undefined) {
		return false;
	}
	out[seg.name] = current;
	if (matchPath(pattern, pi + 1, input, si + 1, out)) {
		return true;
	}
	delete out[seg.name];
	return false;
}

/**
 * Match the pattern's declared query pairs against the decoded input query, binding
 * params into `out`. A literal pair must be present with exactly its value; a required
 * param must be present and non-empty; an optional param binds when present and
 * non-empty and is omitted otherwise. Undeclared input keys are ignored.
 */
function matchQuery(
	pairs: readonly QueryPair[],
	query: ReadonlyMap<string, string>,
	out: Record<string, string>,
): boolean {
	for (const pair of pairs) {
		const present = query.get(pair.key);
		const value = pair.value;
		if (value.kind === "literal") {
			if (present === undefined || present !== value.value) {
				return false;
			}
			continue;
		}
		if (present !== undefined && present !== "") {
			out[value.name] = present;
		} else if (!value.optional) {
			return false;
		}
	}
	return true;
}

export const matchUrl: MatchUrl = (asts, url, base) => {
	// Normalise the input to a parsed URL, tracking whether it was absolute so the
	// origin check (and only that) applies. Relative inputs resolve against a
	// throwaway origin that is never compared.
	let parsed: URL;
	let absolute: boolean;
	if (url instanceof URL) {
		parsed = url;
		absolute = true;
	} else if (ABSOLUTE_URL.test(url)) {
		absolute = true;
		try {
			parsed = new URL(url);
		} catch {
			return null;
		}
	} else if (url.startsWith("//")) {
		// Protocol-relative (`//host/path`): authority-bearing but scheme-less. Treat it
		// as absolute so the origin gate still guards the authority; resolve against
		// `base` (inheriting its scheme) when present, else a throwaway origin — with no
		// base the origin stays unchecked and it matches on path + query only.
		absolute = true;
		try {
			parsed = new URL(url, base !== undefined ? base : RELATIVE_BASE);
		} catch {
			return null;
		}
	} else {
		absolute = false;
		try {
			parsed = new URL(url, RELATIVE_BASE);
		} catch {
			return null;
		}
	}

	// Origin gate: only for an absolute input with a base. WHATWG `URL.origin`
	// normalises default ports, so equality is the right comparison.
	if (absolute && base !== undefined) {
		let baseOrigin: string;
		try {
			baseOrigin = (base instanceof URL ? base : new URL(base)).origin;
		} catch {
			return null;
		}
		if (parsed.origin !== baseOrigin) {
			return null;
		}
	}

	// Path: split on "/", drop the leading empty segment, decode each. A segment that
	// fails to decode makes the whole (malformed) input a non-match.
	const rawSegments = parsed.pathname.split("/");
	if (rawSegments[0] === "") {
		rawSegments.shift();
	}
	const segments: string[] = [];
	for (const raw of rawSegments) {
		try {
			segments.push(decodeURIComponent(raw));
		} catch {
			return null;
		}
	}

	// Query: parse by hand — strip a leading "?", split on "&", split each pair on the
	// first "=", decode both halves, first key wins. A pair that fails to decode is
	// treated as noise and skipped.
	const query = new Map<string, string>();
	const rawQuery = parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search;
	if (rawQuery.length > 0) {
		for (const rawPair of rawQuery.split("&")) {
			if (rawPair === "") {
				continue;
			}
			const eq = rawPair.indexOf("=");
			const rawKey = eq === -1 ? rawPair : rawPair.slice(0, eq);
			const rawValue = eq === -1 ? "" : rawPair.slice(eq + 1);
			let key: string;
			let value: string;
			try {
				key = decodeURIComponent(rawKey);
				value = decodeURIComponent(rawValue);
			} catch {
				continue;
			}
			if (!query.has(key)) {
				query.set(key, value);
			}
		}
	}

	// Try each AST in order; the first that matches both path and query wins.
	for (const ast of asts) {
		const out: Record<string, string> = {};
		if (!matchPath(ast.path, 0, segments, 0, out)) {
			continue;
		}
		if (!matchQuery(ast.query, query, out)) {
			continue;
		}
		return out;
	}
	return null;
};
