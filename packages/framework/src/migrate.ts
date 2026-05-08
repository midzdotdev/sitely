import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * v1 -> v2 codemod for sitely site definitions.
 *
 * Per atlas spec §3 and addendum: every breaking DSL change ships with a
 * codemod. This module rewrites a v1 site `index.ts` into the v2 shape
 * mechanically. The transforms are conservative — anything ambiguous is
 * left as a TODO for the author to tighten.
 *
 * Diff-emit by default; `--yes` to apply. Idempotent on already-v2 code.
 *
 * Transform rules:
 * 1. `import { Schema, defineSite }` -> `import { defineSite }` + named imports
 *    from `@sitely/schemas` for each `Schema.X` reference encountered.
 * 2. `name: "Foo"` (top-level) -> `site: { id: "<slug>", displayName: "Foo" }`
 * 3. `domain: "host.tld"` -> `origins: [{ hostname: "host.tld" }]`
 * 4. `aliases: [...]` -> dropped with a TODO comment (use locales/origins instead).
 * 5. `schema: Schema.X` -> `schema: "X"`, plus add `X` to a top-level
 *    `schemas: { X }` map.
 * 6. `ttl: "1h"` -> `ttl: { default: "1h", min: "1m", max: "30d" }`
 * 7. Adds `// sitely DSL v2` marker comment at the top so re-runs are no-ops.
 *
 * **Safety net:** after all transforms run, the migrated source is scanned for
 * residual v1 fields (`name:`, `domain:`, `aliases:`) at the top level inside
 * `defineSite({...})`. If any are found, the v2 marker is *withheld* (so the
 * file is not considered migrated) and a structured warning is added to the
 * notes array. This prevents silent half-migrations: the file shows up as
 * "changed" with a clear warning rather than being marked v2 in a broken state.
 */

export interface MigrationResult {
	original: string;
	migrated: string;
	changed: boolean;
	/**
	 * `true` when the codemod could not fully migrate the file. The migrated
	 * source still contains v1 fields the transforms didn't recognize. The v2
	 * marker is NOT stamped in this case so re-running the codemod (after the
	 * author fixes the file or the codemod is improved) is not a no-op.
	 */
	incomplete: boolean;
	notes: string[];
}

const V2_MARKER = "// sitely DSL v2";

/** Heuristic locale prefixes the id-inference recognizes. */
const LOCALE_PREFIXES = new Set([
	"en", "de", "fr", "es", "it", "pt", "ja", "zh", "ko", "ru", "ar", "nl", "pl", "tr", "vi", "sv",
	"no", "fi", "da", "cs", "el", "he", "hi", "id", "ms", "th", "uk", "www",
]);

/**
 * Apply the v1 -> v2 transforms to a source string.
 *
 * Returns the original source unchanged if the v2 marker is already present
 * (idempotency). Otherwise applies transforms in order, scans for residual
 * v1 fields, and decides whether to stamp the v2 marker.
 */
export function migrateV1ToV2(source: string): MigrationResult {
	const notes: string[] = [];

	// Idempotency guard.
	if (source.includes(V2_MARKER)) {
		return {
			original: source,
			migrated: source,
			changed: false,
			incomplete: false,
			notes: ["already v2"],
		};
	}

	let s = source;

	// Detect Schema.X usages BEFORE mutating imports.
	const schemaUsages = new Set<string>();
	for (const match of s.matchAll(/Schema\.(\w+)/g)) {
		schemaUsages.add(match[1]);
	}

	// 1. Rewrite imports.
	s = s.replace(
		/import\s*\{\s*Schema\s*,\s*defineSite\s*\}\s*from\s*"@sitely\/framework";?/,
		'import { defineSite } from "@sitely/framework";',
	);
	s = s.replace(
		/import\s*\{\s*defineSite\s*,\s*Schema\s*\}\s*from\s*"@sitely\/framework";?/,
		'import { defineSite } from "@sitely/framework";',
	);
	if (schemaUsages.size > 0) {
		const sorted = [...schemaUsages].sort();
		const importLine = `import { ${sorted.join(", ")} } from "@sitely/schemas";\n`;
		s = s.replace(
			/(import\s*\{\s*defineSite\s*\}\s*from\s*"@sitely\/framework";?\n)/,
			`$1${importLine}`,
		);
		notes.push(`Added @sitely/schemas import for: ${sorted.join(", ")}`);
	}

	// 2. Rewrite top-level `name`/`domain`/`aliases` -> `site`/`origins`.
	// Handles either ordering and tolerates other fields between them.
	const migrated = migrateSiteIdentity(s);
	if (migrated.changed) {
		s = migrated.source;
		for (const note of migrated.notes) notes.push(note);
	}

	// 5. Rewrite `schema: Schema.X` -> `schema: "X"` and remember which schemas to add.
	const schemasReferenced = new Set<string>();
	s = s.replace(/schema:\s*Schema\.(\w+)/g, (_, name) => {
		schemasReferenced.add(name);
		return `schema: "${name}"`;
	});

	// Insert top-level `schemas: { ... }` block right before `resources:`.
	if (schemasReferenced.size > 0 && !/\bschemas:\s*\{/.test(s)) {
		const sorted = [...schemasReferenced].sort();
		const block = `\tschemas: { ${sorted.join(", ")} },\n\n`;
		const inserted = s.replace(/(\n\t)resources:\s*\{/, `\n${block}$1resources: {`);
		if (inserted !== s) {
			s = inserted;
			notes.push(`Added schemas: { ${sorted.join(", ")} } map`);
		}
	}

	// 6. Rewrite `ttl: "1h"` -> `ttl: { default: "1h", min: "1m", max: "30d" }`.
	let ttlCount = 0;
	s = s.replace(/ttl:\s*"(\d+[smhd])"/g, (_, value) => {
		ttlCount++;
		return `ttl: { default: "${value}", min: "1m", max: "30d" }`;
	});
	if (ttlCount > 0) {
		notes.push(
			`Migrated ${ttlCount} TTL string(s) to {default,min,max}; tighten bounds manually`,
		);
	}

	// SAFETY NET: scan for residual v1 fields inside `defineSite({...})`.
	// If any are present, refuse to stamp the v2 marker. Always reports as
	// incomplete (and changed=true so CLI surfaces the warning) even when no
	// other transforms applied — a file with leftover v1 fields is broken.
	const residual = findResidualV1Fields(s);

	if (residual.length > 0) {
		notes.push(
			`WARNING: codemod could not fully migrate v1 fields: ${residual.join(", ")}. ` +
				"The v2 marker was withheld so this file is not stamped as migrated. " +
				"File a bug at the sitely repo with the source so we can extend the codemod.",
		);
		return {
			original: source,
			migrated: s,
			// Force changed=true so CLI surfaces the incomplete header even if no
			// other transforms ran. Without this, a file with only `name:` (and no
			// Schema/ttl/etc) would silently exit 0 as "no changes".
			changed: true,
			incomplete: true,
			notes,
		};
	}

	// All transforms passed; stamp the v2 marker.
	if (notes.length > 0) {
		s = `${V2_MARKER} (migrated by sitely migrate v1->v2; review TODOs)\n${s}`;
	}

	return {
		original: source,
		migrated: s,
		changed: s !== source,
		incomplete: false,
		notes,
	};
}

/**
 * Migrate the `name`/`domain`/`aliases` v1 identity fields into v2's
 * `site`/`origins` shape. Field order tolerant.
 *
 * Strategy:
 * 1. Scope to the body of the first `defineSite({ ... })` call.
 * 2. Extract `name`, `domain`, `aliases` if present.
 * 3. Strip those v1 lines from the body.
 * 4. Inject `site: {...}` + `origins: [...]` at the top of the body.
 *
 * Bounds the scope to a single `defineSite` block so we don't accidentally
 * touch unrelated `name:` / `domain:` strings deeper in the file.
 */
function migrateSiteIdentity(source: string): { source: string; changed: boolean; notes: string[] } {
	const notes: string[] = [];

	// Find `defineSite({` and the matching `})` (naive brace counting; the
	// site def files are simple enough for this to be reliable in practice).
	const openMatch = source.match(/defineSite\s*\(\s*\{/);
	if (!openMatch || openMatch.index === undefined) {
		return { source, changed: false, notes };
	}
	const bodyStart = openMatch.index + openMatch[0].length;
	const bodyEnd = findMatchingBrace(source, bodyStart - 1);
	if (bodyEnd === -1) {
		return { source, changed: false, notes };
	}

	const before = source.slice(0, bodyStart);
	const body = source.slice(bodyStart, bodyEnd);
	const after = source.slice(bodyEnd);

	// Extract `name: "..."` (top-level only — the regex anchors on a leading
	// newline + tabs/spaces matching the indent of a top-level field).
	const nameRe = /\n([\t ]+)name:\s*"([^"]+)",?[\t ]*(?=\n)/;
	const nameMatch = body.match(nameRe);

	// Extract `domain: "..."` similarly.
	const domainRe = /\n[\t ]+domain:\s*"([^"]+)",?[\t ]*(?=\n)/;
	const domainMatch = body.match(domainRe);

	// Extract `aliases: [...]` (multi-element supported, single-line form only).
	const aliasesRe = /\n[\t ]+aliases:\s*\[[^\]]*\],?[\t ]*(?=\n)/;
	const aliasesMatch = body.match(aliasesRe);

	if (!nameMatch && !domainMatch && !aliasesMatch) {
		return { source, changed: false, notes };
	}

	const indent = nameMatch ? nameMatch[1] : domainMatch ? "\t" : "\t";
	const displayName = nameMatch?.[2];
	const domain = domainMatch?.[1];

	// Remove the v1 fields from the body.
	let newBody = body;
	if (nameMatch) newBody = newBody.replace(nameMatch[0], "");
	if (domainMatch) newBody = newBody.replace(domainMatch[0], "");
	if (aliasesMatch) newBody = newBody.replace(aliasesMatch[0], "");

	// Build the v2 identity prefix. Both name and domain must be present to
	// produce a coherent `site` + `origins` block — anything less leaves the
	// safety net to flag as residual.
	if (displayName && domain) {
		const id = inferIdFromDomain(domain);
		const idGuessIsRisky = isIdInferenceRisky(domain, id);
		const idWarning = idGuessIsRisky
			? ` // TODO: verify id="${id}" matches the canonical brand name (codemod inferred from "${domain}")`
			: "";
		const v2Prefix =
			`\n${indent}site: { id: "${id}", displayName: "${displayName}" },${idWarning}\n` +
			`\n${indent}origins: [{ hostname: "${domain}" }],`;
		newBody = v2Prefix + newBody;
		notes.push(`Migrated name/domain -> site/origins (id="${id}")`);
		if (idGuessIsRisky) {
			notes.push(
				`WARN: inferred id="${id}" from domain "${domain}" — verify this matches the canonical brand name`,
			);
		}
	} else if (displayName && !domain) {
		notes.push(
			"Found `name` but not `domain` — left both fields in place for the safety net to flag",
		);
		// Restore by leaving body unchanged for the safety net check.
		return { source, changed: false, notes };
	} else if (!displayName && domain) {
		notes.push(
			"Found `domain` but not `name` — left both fields in place for the safety net to flag",
		);
		return { source, changed: false, notes };
	}

	if (aliasesMatch) {
		// Insert the TODO comment after the origins block.
		newBody = newBody.replace(
			/(origins: \[[^\]]+\],)/,
			`$1\n${indent}// TODO: aliases removed in v2; declare locales+origins instead`,
		);
		notes.push("Dropped `aliases` (TODO inserted)");
	}

	return {
		source: before + newBody + after,
		changed: true,
		notes,
	};
}

/**
 * Find the index of the closing brace matching the opening brace at `openIndex`.
 * Returns -1 if no match. Naive — does not skip braces inside strings/regexes,
 * which is acceptable for site def files where braces in strings are rare.
 */
function findMatchingBrace(source: string, openIndex: number): number {
	let depth = 1;
	for (let i = openIndex + 1; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Scan the migrated source for v1 field names that should have been removed.
 *
 * Returns a list of v1 field names still present at the top level of the
 * `defineSite({...})` body. Used by the safety net to refuse stamping the
 * v2 marker when migration is incomplete.
 */
function findResidualV1Fields(source: string): string[] {
	const openMatch = source.match(/defineSite\s*\(\s*\{/);
	if (!openMatch || openMatch.index === undefined) return [];
	const bodyStart = openMatch.index + openMatch[0].length;
	const bodyEnd = findMatchingBrace(source, bodyStart - 1);
	if (bodyEnd === -1) return [];
	const body = source.slice(bodyStart, bodyEnd);

	const found: string[] = [];
	for (const field of ["name", "domain", "aliases"]) {
		// Match the field at top-level depth only: `\n<indent><field>:`. A
		// nested field (e.g. `site: { displayName: ...` would have deeper indent
		// or be on a continuation line). We assume top-level fields use a single
		// tab or two-to-four-space indent — that covers all current site defs.
		const re = new RegExp(`\\n[\\t ]+${field}:`);
		if (re.test(body)) found.push(field);
	}
	return found;
}

/**
 * Infer a canonical site id from a domain.
 *
 * Strips common locale prefixes (en, de, ja, ...) and the TLD, returns the
 * remainder lowercased + alphanumerics-only.
 *
 * Best-effort. For domains where the brand name doesn't match the second-level
 * label (e.g. `news.ycombinator.com` → "ycombinator" but the canonical brand is
 * "hackernews"), {@link isIdInferenceRisky} flags the result so the codemod
 * surfaces a TODO for the author to verify.
 */
function inferIdFromDomain(domain: string): string {
	const parts = domain.toLowerCase().split(".");
	const filtered = parts.filter((p, i) => !(i === 0 && LOCALE_PREFIXES.has(p)));
	if (filtered.length > 1) filtered.pop();
	return filtered.join("").replace(/[^a-z0-9]/g, "");
}

/**
 * True when the inferred id is likely wrong because the domain has a non-trivial
 * shape — multiple non-locale labels, a brand-vs-domain mismatch, or any case
 * worth surfacing for author review.
 *
 * Conservative: any domain with more than one non-locale label below the TLD
 * (e.g. `news.ycombinator.com`, `forum.example.org`) flags as risky.
 */
function isIdInferenceRisky(domain: string, _inferredId: string): boolean {
	const parts = domain.toLowerCase().split(".");
	const nonLocale = parts.filter((p, i) => !(i === 0 && LOCALE_PREFIXES.has(p)));
	if (nonLocale.length > 2) return true; // domain-of-domain shape
	return false;
}

/**
 * Render a unified diff between original and migrated source.
 *
 * Naive line-by-line diff. Adequate for small DSL files; for larger files the
 * inserts (import lines, schemas block, marker comment) cause downstream lines
 * to misalign and show as both `-` and `+`. A real LCS-based diff is a
 * follow-up — see argus's review note 3.
 */
export function renderDiff(original: string, migrated: string, filePath: string): string {
	const originalLines = original.split("\n");
	const migratedLines = migrated.split("\n");
	const out: string[] = [`--- ${filePath} (v1)`, `+++ ${filePath} (v2)`];

	const max = Math.max(originalLines.length, migratedLines.length);
	for (let i = 0; i < max; i++) {
		const o = originalLines[i];
		const n = migratedLines[i];
		if (o === n) continue;
		if (o !== undefined) out.push(`- ${o}`);
		if (n !== undefined) out.push(`+ ${n}`);
	}
	return out.join("\n");
}

/**
 * Run the codemod on a file path. Returns the migration result.
 *
 * If `apply` is true, writes the migrated content back to disk.
 * Incomplete migrations are written too (with the warning notes) — the v2
 * marker withholding alone gates the idempotency guarantee.
 */
export function migrateFile(
	filePath: string,
	apply: boolean,
): MigrationResult & { filePath: string } {
	const abs = resolve(filePath);
	if (!existsSync(abs)) {
		throw new Error(`File not found: ${abs}`);
	}
	const source = readFileSync(abs, "utf-8");
	const result = migrateV1ToV2(source);

	if (apply && result.changed) {
		writeFileSync(abs, result.migrated, "utf-8");
	}

	return { ...result, filePath: abs };
}
