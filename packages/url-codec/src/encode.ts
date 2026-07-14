/**
 * `buildUrl` — the canonical (producing) direction of the codec. Given a pattern
 * AST and a decoded param map, it emits the one canonical URL: root-relative by
 * default, or absolute on `base`'s origin. Each component is percent-encoded
 * (`encodeURIComponent` semantics); a missing required param or an empty value
 * throws `URLCodecError`.
 */
import type { BuildUrl } from "./internal";
import { URLCodecError } from "./errors";

export const buildUrl: BuildUrl = (ast, params, base) => {
	/**
	 * Resolve one param to its raw (decoded) value. Returns `undefined` to signal
	 * "omit this optional param"; throws for a missing required param or an empty
	 * value (an empty segment/pair could never be re-recognised by `fromUrl`).
	 */
	const resolveParam = (name: string, optional: boolean): string | undefined => {
		const value = params[name];
		if (value === undefined) {
			if (optional) {
				return undefined;
			}
			throw new URLCodecError(
				"missing-param",
				`Missing required param ":${name}" for pattern "${ast.source}".`,
			);
		}
		if (value === "") {
			throw new URLCodecError(
				"empty-param",
				`Param ":${name}" must be a non-empty value for pattern "${ast.source}".`,
			);
		}
		return value;
	};

	// Path: encode literals verbatim; substitute params; drop absent optionals so
	// no empty "//" segment is produced. A value containing "/" encodes to "%2F"
	// and stays within a single segment.
	const pathParts: string[] = [];
	for (const segment of ast.path) {
		if (segment.kind === "literal") {
			pathParts.push(encodeURIComponent(segment.value));
		} else {
			const value = resolveParam(segment.name, segment.optional);
			if (value !== undefined) {
				pathParts.push(encodeURIComponent(value));
			}
		}
	}
	const path = `/${pathParts.join("/")}`;

	// Query: emit each declared pair in the AST's canonical order. Both key and
	// value are percent-encoded so the by-hand `fromUrl` decoder (which decodes
	// each half) round-trips exactly. Absent optional params drop their whole pair.
	const queryParts: string[] = [];
	for (const pair of ast.query) {
		const key = encodeURIComponent(pair.key);
		if (pair.value.kind === "literal") {
			queryParts.push(`${key}=${encodeURIComponent(pair.value.value)}`);
		} else {
			const value = resolveParam(pair.value.name, pair.value.optional);
			if (value !== undefined) {
				queryParts.push(`${key}=${encodeURIComponent(value)}`);
			}
		}
	}

	const pathPlusQuery = queryParts.length > 0 ? `${path}?${queryParts.join("&")}` : path;

	// `base` contributes origin only. Prepend the origin literally rather than routing
	// through `new URL(pathPlusQuery, base).href`, whose special-scheme query encode-set
	// re-encodes characters `encodeURIComponent` leaves literal (e.g. "'"). That would
	// make the with-base form diverge from the baseless canonical and break canonical
	// stability (the v1 cache key). `URL.origin` still normalises default ports.
	if (base !== undefined) {
		return new URL(base).origin + pathPlusQuery;
	}
	return pathPlusQuery;
};
