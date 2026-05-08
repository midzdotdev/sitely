import { describe, expect, it } from "vitest";
import { migrateV1ToV2 } from "./migrate.js";

const V1_BASIC = `import { Schema, defineSite } from "@sitely/framework";

export default defineSite({
	name: "Wikipedia (English)",
	domain: "en.wikipedia.org",

	rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },

	resources: {
		article: {
			schema: Schema.Article,
			params: { title: { type: "string", required: true } },
			resolve: (p) => \`/wiki/\${p.title}\`,
			ttl: "24h",
		},
	},

	pages: {},
});
`;

describe("migrateV1ToV2", () => {
	it("rewrites imports to drop Schema", () => {
		const { migrated } = migrateV1ToV2(V1_BASIC);
		expect(migrated).not.toContain("Schema, defineSite");
		expect(migrated).toContain('import { defineSite } from "@sitely/framework";');
		expect(migrated).toContain('import { Article } from "@sitely/schemas";');
	});

	it("converts name+domain into site/origins", () => {
		const { migrated } = migrateV1ToV2(V1_BASIC);
		expect(migrated).toContain('site: { id: "wikipedia", displayName: "Wikipedia (English)" }');
		expect(migrated).toContain('origins: [{ hostname: "en.wikipedia.org" }]');
		expect(migrated).not.toMatch(/^\s*name:/m);
		expect(migrated).not.toMatch(/^\s*domain:/m);
	});

	it("converts schema: Schema.X into schema: 'X' and adds schemas map", () => {
		const { migrated } = migrateV1ToV2(V1_BASIC);
		expect(migrated).toContain('schema: "Article"');
		expect(migrated).toContain("schemas: { Article }");
	});

	it("expands ttl strings into {default,min,max}", () => {
		const { migrated } = migrateV1ToV2(V1_BASIC);
		expect(migrated).toContain('ttl: { default: "24h", min: "1m", max: "30d" }');
	});

	it("inserts the v2 marker comment for traceability", () => {
		const { migrated, changed, incomplete } = migrateV1ToV2(V1_BASIC);
		expect(changed).toBe(true);
		expect(incomplete).toBe(false);
		expect(migrated.startsWith("// sitely DSL v2")).toBe(true);
	});

	it("is idempotent on already-migrated source", () => {
		const once = migrateV1ToV2(V1_BASIC);
		const twice = migrateV1ToV2(once.migrated);
		expect(twice.changed).toBe(false);
		expect(twice.notes).toContain("already v2");
		expect(twice.migrated).toBe(once.migrated);
	});

	it("infers id by stripping common locale prefixes", () => {
		const v1 = V1_BASIC.replace('"en.wikipedia.org"', '"de.wikipedia.org"');
		const { migrated } = migrateV1ToV2(v1);
		expect(migrated).toContain('id: "wikipedia"');
	});

	it("strips www. prefixes when inferring id", () => {
		const v1 = V1_BASIC
			.replace('"Wikipedia (English)"', '"Example"')
			.replace('"en.wikipedia.org"', '"www.example.com"');
		const { migrated } = migrateV1ToV2(v1);
		expect(migrated).toContain('id: "example"');
	});

	it("drops aliases with a TODO comment", () => {
		const v1 = V1_BASIC.replace(
			"rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },",
			'aliases: ["wikipedia.org"],\n\n\trateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },',
		);
		const { migrated } = migrateV1ToV2(v1);
		expect(migrated).not.toContain('aliases: ["wikipedia.org"]');
		expect(migrated).toContain("aliases removed in v2");
	});

	it("collects multiple distinct schema usages into one import", () => {
		const v1 = V1_BASIC.replace(
			"schema: Schema.Article,",
			'schema: Schema.Article,\n\t\t},\n\t\tfeed: {\n\t\t\tschema: Schema.ItemList,',
		);
		const { migrated } = migrateV1ToV2(v1);
		expect(migrated).toContain('import { Article, ItemList } from "@sitely/schemas";');
		expect(migrated).toContain("schemas: { Article, ItemList }");
	});

	it("returns no notes and unchanged source when source is already v2", () => {
		const v2 = "// sitely DSL v2\nexport default defineSite({});\n";
		const { changed, incomplete, notes } = migrateV1ToV2(v2);
		expect(changed).toBe(false);
		expect(incomplete).toBe(false);
		expect(notes).toContain("already v2");
	});

	// ── Field-order / safety-net contract (argus review #1, #2) ─────────

	describe("field order tolerance", () => {
		it("migrates when domain is declared before name", () => {
			const v1 = `import { Schema, defineSite } from "@sitely/framework";

export default defineSite({
	domain: "en.wikipedia.org",
	name: "Wikipedia (English)",

	rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },

	resources: {
		article: {
			schema: Schema.Article,
			params: {},
			resolve: () => "/",
			ttl: "1h",
		},
	},
	pages: {},
});
`;
			const { migrated, incomplete } = migrateV1ToV2(v1);
			expect(incomplete).toBe(false);
			expect(migrated).toContain('site: { id: "wikipedia", displayName: "Wikipedia (English)" }');
			expect(migrated).toContain('origins: [{ hostname: "en.wikipedia.org" }]');
			// Both v1 fields removed.
			expect(migrated).not.toMatch(/\n\tname:\s*"/);
			expect(migrated).not.toMatch(/\n\tdomain:\s*"/);
			// v2 marker present (full migration).
			expect(migrated.startsWith("// sitely DSL v2")).toBe(true);
		});

		it("migrates when a comment sits between name and domain", () => {
			const v1 = `import { Schema, defineSite } from "@sitely/framework";

export default defineSite({
	name: "Wikipedia (English)",
	// the canonical hostname for English Wikipedia
	domain: "en.wikipedia.org",

	rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },

	resources: {
		article: {
			schema: Schema.Article,
			params: {},
			resolve: () => "/",
			ttl: "1h",
		},
	},
	pages: {},
});
`;
			const { migrated, incomplete } = migrateV1ToV2(v1);
			expect(incomplete).toBe(false);
			expect(migrated).toContain('site: { id: "wikipedia", displayName: "Wikipedia (English)" }');
			expect(migrated).toContain('origins: [{ hostname: "en.wikipedia.org" }]');
			expect(migrated).not.toMatch(/\n\tname:\s*"/);
			expect(migrated).not.toMatch(/\n\tdomain:\s*"/);
			expect(migrated.startsWith("// sitely DSL v2")).toBe(true);
		});

		it("migrates when extra fields are interleaved between name and domain", () => {
			const v1 = `import { Schema, defineSite } from "@sitely/framework";

export default defineSite({
	name: "Example",
	homepage: "https://example.com/about",
	domain: "example.com",

	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },

	resources: {
		thing: {
			schema: Schema.Thing,
			params: {},
			resolve: () => "/",
			ttl: "1h",
		},
	},
	pages: {},
});
`;
			const { migrated, incomplete } = migrateV1ToV2(v1);
			expect(incomplete).toBe(false);
			expect(migrated).toContain('site: { id: "example", displayName: "Example" }');
			expect(migrated).toContain('origins: [{ hostname: "example.com" }]');
			expect(migrated).not.toMatch(/\n\tname:\s*"/);
			expect(migrated).not.toMatch(/\n\tdomain:\s*"/);
		});
	});

	describe("safety net (incomplete migration)", () => {
		it("withholds v2 marker when only name is present (no domain)", () => {
			const v1 = `import { defineSite } from "@sitely/framework";

export default defineSite({
	name: "Example",
	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
	resources: {},
	pages: {},
});
`;
			const { migrated, incomplete, notes } = migrateV1ToV2(v1);
			expect(incomplete).toBe(true);
			expect(migrated.startsWith("// sitely DSL v2")).toBe(false);
			expect(notes.some((n) => n.startsWith("WARNING"))).toBe(true);
			// Re-running on the half-migrated output is NOT a no-op (no marker).
			const second = migrateV1ToV2(migrated);
			expect(second.notes).not.toContain("already v2");
		});

		it("withholds v2 marker when only domain is present (no name)", () => {
			const v1 = `import { defineSite } from "@sitely/framework";

export default defineSite({
	domain: "example.com",
	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
	resources: {},
	pages: {},
});
`;
			const { migrated, incomplete, notes } = migrateV1ToV2(v1);
			expect(incomplete).toBe(true);
			expect(migrated.startsWith("// sitely DSL v2")).toBe(false);
			expect(notes.some((n) => n.startsWith("WARNING"))).toBe(true);
		});

		it("does not stamp v2 marker when a v1 field is left in (defense-in-depth)", () => {
			// Construct source where `name:` appears at top-level inside
			// defineSite without a corresponding `domain:` — migrateSiteIdentity
			// refuses to act on partial identity, leaving `name` in the body. The
			// safety-net scan then catches the residual and withholds the marker.
			const v1 = `import { defineSite } from "@sitely/framework";

export default defineSite({
	name: "OnlyName",
	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
	resources: {},
	pages: {},
});
`;
			const { migrated, incomplete, notes } = migrateV1ToV2(v1);
			expect(incomplete).toBe(true);
			expect(notes.some((n) => n.startsWith("WARNING") && n.includes("name"))).toBe(true);
			expect(migrated.startsWith("// sitely DSL v2")).toBe(false);
		});

		it("multi-line aliases arrays are correctly stripped (no residual)", () => {
			// Coverage of a realistic edge case: aliases as a multi-line array.
			// The current migrateSiteIdentity matches across newlines because
			// the array-content character class is permissive.
			const v1 = `import { defineSite } from "@sitely/framework";

export default defineSite({
	name: "X",
	domain: "x.com",
	aliases: [
		"legacy.x.com",
		"old.x.com",
	],
	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
	resources: {},
	pages: {},
});
`;
			const { migrated, incomplete, notes } = migrateV1ToV2(v1);
			expect(incomplete).toBe(false);
			expect(migrated).not.toContain("aliases:");
			expect(notes).toContain("Dropped `aliases` (TODO inserted)");
			expect(migrated).toContain("aliases removed in v2");
		});

		it("re-running on a half-migrated file is not a no-op (so the bug is structurally impossible to ignore)", () => {
			// Force an incomplete migration by feeding source with only `name:`.
			const incomplete = `import { defineSite } from "@sitely/framework";

export default defineSite({
	name: "OnlyName",
	rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
	resources: {},
	pages: {},
});
`;
			const first = migrateV1ToV2(incomplete);
			expect(first.incomplete).toBe(true);
			expect(first.migrated.startsWith("// sitely DSL v2")).toBe(false);

			// Author or future codemod fixes the file; re-run should proceed
			// normally (no `already v2` short-circuit).
			const fixed = first.migrated.replace(
				/name: "OnlyName",/,
				'name: "OnlyName",\n\tdomain: "onlyname.com",',
			);
			const second = migrateV1ToV2(fixed);
			expect(second.notes).not.toContain("already v2");
			expect(second.incomplete).toBe(false);
			expect(second.migrated).toContain('site: { id: "onlyname", displayName: "OnlyName" }');
		});
	});

	describe("id-inference risk warning (review note 6)", () => {
		it("warns when a non-trivial domain shape is used (e.g. news.ycombinator.com)", () => {
			const v1 = V1_BASIC.replace('"en.wikipedia.org"', '"news.ycombinator.com"').replace(
				'"Wikipedia (English)"',
				'"Hacker News"',
			);
			const { migrated, incomplete, notes } = migrateV1ToV2(v1);
			expect(incomplete).toBe(false);
			expect(notes.some((n) => n.startsWith("WARN") && n.includes("ycombinator"))).toBe(true);
			// The TODO is also embedded inline next to the inferred id.
			expect(migrated).toContain("TODO: verify");
		});

		it("does not warn for trivial domain shapes (e.g. en.wikipedia.org)", () => {
			const { notes } = migrateV1ToV2(V1_BASIC);
			expect(notes.some((n) => n.startsWith("WARN"))).toBe(false);
		});
	});
});
