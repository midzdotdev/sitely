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
 *    For locale-shaped hosts like `<locale>.example.com`, author broadens
 *    manually (codemod uses single-locale starter).
 * 4. `aliases: [...]` -> dropped with a TODO comment (use locales/origins instead).
 * 5. `schema: Schema.X` -> `schema: "X"`, plus add `X` to a top-level
 *    `schemas: { X }` map.
 * 6. `ttl: "1h"` -> `ttl: { default: "1h", min: "1m", max: "30d" }`
 * 7. Adds `// v1->v2 migration: review TODOs` comment at the top.
 */

export interface MigrationResult {
	original: string;
	migrated: string;
	changed: boolean;
	notes: string[];
}

const V2_MARKER = "// sitely DSL v2";

export function migrateV1ToV2(source: string): MigrationResult {
	const notes: string[] = [];

	// Idempotency guard.
	if (source.includes(V2_MARKER)) {
		return { original: source, migrated: source, changed: false, notes: ["already v2"] };
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
		// Insert right after the @sitely/framework import.
		s = s.replace(
			/(import\s*\{\s*defineSite\s*\}\s*from\s*"@sitely\/framework";?\n)/,
			`$1${importLine}`,
		);
		notes.push(`Added @sitely/schemas import for: ${sorted.join(", ")}`);
	}

	// 2. Rewrite top-level `name: "Foo"` + `domain: "host"` into `site: {...}` + `origins: [...]`.
	// Matches the (defineSite({\n\tname: "...",\n\tdomain: "...",) shape.
	const nameDomainRe =
		/(defineSite\s*\(\s*\{\s*\n\s*)name:\s*"([^"]+)",\s*\n\s*domain:\s*"([^"]+)",/;
	const m = s.match(nameDomainRe);
	if (m) {
		const [, prefix, displayName, domain] = m;
		const id = inferIdFromDomain(domain);
		const replacement = `${prefix}site: { id: "${id}", displayName: "${displayName}" },\n\n\torigins: [{ hostname: "${domain}" }],`;
		s = s.replace(nameDomainRe, replacement);
		notes.push(`Migrated name/domain -> site/origins (id="${id}")`);
	}

	// 3. Drop `aliases: [...]` if present.
	const aliasesRe = /\n\s*aliases:\s*\[[^\]]*\],?/;
	if (aliasesRe.test(s)) {
		s = s.replace(aliasesRe, "\n\t// TODO: aliases removed in v2; declare locales+origins instead");
		notes.push("Dropped `aliases` (TODO inserted)");
	}

	// 5. Rewrite `schema: Schema.X` -> `schema: "X"` and remember which schemas to add.
	const schemasReferenced = new Set<string>();
	s = s.replace(/schema:\s*Schema\.(\w+)/g, (_, name) => {
		schemasReferenced.add(name);
		return `schema: "${name}"`;
	});

	// Add a top-level `schemas: { ... }` block right before `resources:` if any
	// schema refs were rewritten and no `schemas:` block already exists.
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
		notes.push(`Migrated ${ttlCount} TTL string(s) to {default,min,max}; tighten bounds manually`);
	}

	// Add the v2 marker comment at the top so re-running is a no-op.
	if (notes.length > 0) {
		s = `${V2_MARKER} (migrated by sitely migrate v1->v2; review TODOs)\n${s}`;
	}

	return {
		original: source,
		migrated: s,
		changed: s !== source,
		notes,
	};
}

function inferIdFromDomain(domain: string): string {
	// "en.wikipedia.org" -> "wikipedia"
	// "news.ycombinator.com" -> "hackernews" -- wrong, but the codemod can't know the
	// canonical brand name; fall back to the first non-locale-looking label.
	const parts = domain.toLowerCase().split(".");
	// Drop common locale prefixes.
	const LOCALE_PREFIXES = new Set([
		"en", "de", "fr", "es", "it", "pt", "ja", "zh", "ko", "ru", "ar", "nl", "pl", "tr", "vi",
		"www",
	]);
	const filtered = parts.filter((p, i) => !(i === 0 && LOCALE_PREFIXES.has(p)));
	// Drop TLD.
	if (filtered.length > 1) filtered.pop();
	return filtered.join("").replace(/[^a-z0-9]/g, "");
}

/**
 * Render a unified diff between original and migrated source.
 *
 * Minimal implementation — full LCS would be overkill for a codemod's
 * preview output. Shows old/new headers and line-by-line markers.
 */
export function renderDiff(original: string, migrated: string, filePath: string): string {
	const originalLines = original.split("\n");
	const migratedLines = migrated.split("\n");
	const out: string[] = [`--- ${filePath} (v1)`, `+++ ${filePath} (v2)`];

	// Naive line-by-line diff. Sufficient for the small DSL files we operate on.
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
 */
export function migrateFile(filePath: string, apply: boolean): MigrationResult & { filePath: string } {
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
