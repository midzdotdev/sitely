import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSite } from "../define-site.js";
import { mergeCapabilities, DEFAULT_CAPABILITIES } from "./capabilities.js";
import { buildManifest } from "./manifest.js";
import { stableSerialize } from "./serialize.js";
import { parseTTL, validateTTL } from "./ttl.js";
import { validateSite } from "./validate.js";

const Article = z.object({
	headline: z.string(),
	wordCount: z.number().optional(),
});

function makeSite(overrides: Partial<Parameters<typeof defineSite>[0]> = {}) {
	return defineSite({
		site: { id: "wikipedia", displayName: "Wikipedia" },
		origins: [{ hostname: "{locale}.wikipedia.org", templated: true }],
		locales: { source: "host", values: ["en", "de"], default: "en" },
		schemas: { Article },
		rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
		resources: {
			article: {
				schema: "Article",
				params: { title: { type: "string" as const, required: true } },
				resolve: (p: Record<string, string>) => `/wiki/${p.title}`,
				ttl: { default: "1h", min: "1m", max: "24h" },
			},
		},
		pages: {
			"/wiki/:title": {
				provides: ["article"],
				examples: ["https://en.wikipedia.org/wiki/TypeScript"],
				validate: () => true,
				extract: async () => ({ article: { headline: "TypeScript" } }),
			},
		},
		...overrides,
	});
}

describe("parseTTL", () => {
	it("parses every supported unit", () => {
		expect(parseTTL("30s")).toBe(30);
		expect(parseTTL("5m")).toBe(300);
		expect(parseTTL("2h")).toBe(7200);
		expect(parseTTL("3d")).toBe(259_200);
	});

	it("returns null for malformed input", () => {
		expect(parseTTL("hello")).toBeNull();
		expect(parseTTL("5x")).toBeNull();
		expect(parseTTL("")).toBeNull();
	});
});

describe("validateTTL", () => {
	it("accepts a well-formed triple", () => {
		expect(
			validateTTL("article", { default: "1h", min: "1m", max: "24h" }),
		).toEqual([]);
	});

	it("rejects min > max", () => {
		const errs = validateTTL("article", { default: "1h", min: "2h", max: "1h" });
		expect(errs.some((e) => e.field === "ordering")).toBe(true);
	});

	it("rejects default outside [min, max]", () => {
		const errs = validateTTL("article", { default: "30d", min: "1m", max: "1h" });
		expect(errs.some((e) => e.field === "ordering")).toBe(true);
	});

	it("rejects max above 30d ceiling", () => {
		const errs = validateTTL("article", { default: "1h", min: "1m", max: "60d" });
		expect(errs.some((e) => e.field === "ceiling")).toBe(true);
	});
});

describe("mergeCapabilities", () => {
	it("returns the §8 defaults when nothing is declared", () => {
		expect(mergeCapabilities(undefined)).toEqual(DEFAULT_CAPABILITIES);
	});

	it("preserves declared fields and fills in defaults for the rest", () => {
		const merged = mergeCapabilities({ network: { egress: "any" } });
		expect(merged.network.egress).toBe("any");
		expect(merged.filesystem).toBe("none");
		expect(merged.timers.maxWallMs).toBe(30_000);
		expect(merged.memory.maxMb).toBe(256);
	});
});

describe("validateSite", () => {
	it("accepts a well-formed v2 site", () => {
		expect(validateSite(makeSite())).toEqual([]);
	});

	it("flags unresolved schema refs", () => {
		const site = makeSite({
			resources: {
				article: {
					schema: "DoesNotExist",
					params: {},
					resolve: () => "/",
					ttl: { default: "1h", min: "1m", max: "24h" },
				},
			},
		});
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "missing-schema-ref")).toBe(true);
	});

	it("flags resources declared but not provided by any page", () => {
		const site = makeSite({
			resources: {
				article: {
					schema: "Article",
					params: {},
					resolve: () => "/",
					ttl: { default: "1h", min: "1m", max: "24h" },
				},
				orphan: {
					schema: "Article",
					params: {},
					resolve: () => "/",
					ttl: { default: "1h", min: "1m", max: "24h" },
				},
			},
		});
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "resource-not-provided" && e.context?.resource === "orphan")).toBe(true);
	});

	it("flags pages providing unknown resources", () => {
		const site = makeSite({
			pages: {
				"/wiki/:title": {
					provides: ["article", "ghost"],
					examples: ["https://en.wikipedia.org/wiki/TypeScript"],
					validate: () => true,
					extract: async () => ({}),
				},
			},
		});
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "page-provides-unknown")).toBe(true);
	});

	it("flags host-templated origin without a locales block", () => {
		const site = makeSite({ locales: undefined });
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "locale-mismatch")).toBe(true);
	});

	it("flags locale.default not in locale.values", () => {
		const site = makeSite({
			locales: { source: "host", values: ["en", "de"], default: "fr" },
		});
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "missing-locale-default")).toBe(true);
	});

	it("flags example URLs whose locale label is not in locales.values", () => {
		const site = makeSite({
			pages: {
				"/wiki/:title": {
					provides: ["article"],
					examples: ["https://fr.wikipedia.org/wiki/TypeScript"],
					validate: () => true,
					extract: async () => ({}),
				},
			},
		});
		const errs = validateSite(site);
		expect(errs.some((e) => e.kind === "page-example-not-in-locale-set")).toBe(true);
	});
});

describe("buildManifest", () => {
	it("emits the keystone shape per atlas §0", () => {
		const m = buildManifest(makeSite(), { name: "@sitely/site-wikipedia", version: "0.1.0" }, {
			packageRoot: process.cwd(),
			tool: "sitely-cli@test",
		});
		expect(m.manifestVersion).toBe("1");
		expect(m.packageName).toBe("@sitely/site-wikipedia");
		expect(m.site.id).toBe("wikipedia");
		expect(m.origins).toEqual([{ hostname: "{locale}.wikipedia.org", templated: true }]);
		expect(m.locales).toEqual({ source: "host", values: ["en", "de"], default: "en" });
		expect(m.resources.article.schemaRef).toBe("Article");
		expect(m.resources.article.providedBy).toEqual(["page:/wiki/:title"]);
		expect(m.schemas.Article.schemaOrgType).toBe("Article");
		expect(m.capabilities).toEqual(DEFAULT_CAPABILITIES);
		expect(m.framework).toEqual({});
		expect(m.build.tool).toBe("sitely-cli@test");
		expect(typeof m.build.commit).toBe("string");
		expect(typeof m.build.builtAt).toBe("string");
	});

	it("emits resolved capabilities when partially declared", () => {
		const m = buildManifest(
			makeSite({ capabilities: { timers: { maxWallMs: 5_000 } } }),
			{ name: "@sitely/site-wikipedia", version: "0.1.0" },
			{ packageRoot: process.cwd(), tool: "sitely-cli@test" },
		);
		expect(m.capabilities.timers.maxWallMs).toBe(5_000);
		expect(m.capabilities.network.egress).toBe("site-only");
	});
});

describe("stableSerialize", () => {
	it("sorts object keys lexicographically across depths", () => {
		const a = stableSerialize({ z: 1, a: { b: 2, a: 1 } });
		const b = stableSerialize({ a: { a: 1, b: 2 }, z: 1 });
		expect(a).toBe(b);
	});

	it("ends with a trailing newline", () => {
		expect(stableSerialize({})).toBe("{}\n");
	});

	it("uses tab indentation to match repo convention", () => {
		const out = stableSerialize({ a: 1 });
		expect(out).toContain("\t");
	});
});

describe("buildManifest determinism", () => {
	it("regenerating against the same inputs produces byte-identical serialized output", () => {
		const site = makeSite();
		const pkg = { name: "@sitely/site-wikipedia", version: "0.1.0" };
		const ctx = { packageRoot: process.cwd(), tool: "sitely-cli@test" };

		const json1 = stableSerialize(buildManifest(site, pkg, ctx));
		const json2 = stableSerialize(buildManifest(site, pkg, ctx));

		expect(json1).toBe(json2);
	});
});
