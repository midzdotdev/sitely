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
		const { migrated, changed } = migrateV1ToV2(V1_BASIC);
		expect(changed).toBe(true);
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
			'rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },',
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
		const { changed, notes } = migrateV1ToV2(v2);
		expect(changed).toBe(false);
		expect(notes).toContain("already v2");
	});
});
