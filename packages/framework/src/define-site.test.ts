import { CheerioDriver } from "@sitely/page";
import { describe, expect, it } from "vitest";
import { defineSite } from "./define-site.js";
import { extractJsonLd, filterJsonLdByType } from "./json-ld.js";
import { matchPagePattern, matchPattern } from "./test-harness.js";

describe("defineSite", () => {
	it("passes through the definition object", () => {
		const site = defineSite({
			site: { id: "test", displayName: "Test" },
			origins: [{ hostname: "test.com" }],
			rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
			schemas: {},
			resources: {},
			pages: {},
		});
		expect(site.site.id).toBe("test");
		expect(site.site.displayName).toBe("Test");
		expect(site.origins[0].hostname).toBe("test.com");
	});
});

describe("matchPattern", () => {
	it("matches static paths", () => {
		expect(matchPattern("/news", "/news")).toEqual({});
	});

	it("matches parameterized paths", () => {
		expect(matchPattern("/wiki/:title", "/wiki/TypeScript")).toEqual({
			title: "TypeScript",
		});
	});

	it("decodes URL-encoded params", () => {
		expect(matchPattern("/wiki/:title", "/wiki/C%2B%2B")).toEqual({
			title: "C++",
		});
	});

	it("returns null for non-matching paths", () => {
		expect(matchPattern("/wiki/:title", "/about")).toBeNull();
	});

	it("returns null for wrong segment count on parameterized patterns", () => {
		expect(matchPattern("/wiki/:title", "/wiki/a/b")).toBeNull();
	});

	it("matches static prefix for non-parameterized patterns", () => {
		expect(matchPattern("/news", "/news")).toEqual({});
	});
});

describe("matchPagePattern", () => {
	const site = defineSite({
		site: { id: "test", displayName: "Test" },
		origins: [{ hostname: "test.com" }],
		rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
		schemas: {},
		resources: {},
		pages: {
			"/wiki/:title": {
				provides: ["article"],
				examples: ["https://test.com/wiki/Hello"],
				validate: () => true,
				extract: async () => ({}),
			},
			"/news": {
				provides: ["feed"],
				examples: ["https://test.com/news"],
				validate: () => true,
				extract: async () => ({}),
			},
		},
	});

	it("matches a parameterized page", () => {
		const match = matchPagePattern(site, "https://test.com/wiki/TypeScript");
		expect(match).toEqual({
			pageKey: "/wiki/:title",
			params: { title: "TypeScript" },
		});
	});

	it("matches a static page with query params", () => {
		const match = matchPagePattern(site, "https://test.com/news?p=2");
		expect(match).toEqual({
			pageKey: "/news",
			params: { p: "2" },
		});
	});

	it("returns null for unknown URLs", () => {
		expect(matchPagePattern(site, "https://test.com/about")).toBeNull();
	});
});

describe("extractJsonLd", () => {
	it("extracts JSON-LD from script tags", () => {
		const html = `
			<html><body>
				<script type="application/ld+json">
					{"@type": "Article", "name": "Test"}
				</script>
			</body></html>
		`;
		const driver = new CheerioDriver({ rawHtml: html, url: "https://example.com" });
		const items = extractJsonLd(driver);
		expect(items).toHaveLength(1);
		expect(items[0]["@type"]).toBe("Article");
		expect(items[0].name).toBe("Test");
	});

	it("handles @graph", () => {
		const html = `
			<html><body>
				<script type="application/ld+json">
					{"@graph": [{"@type": "Article"}, {"@type": "Person"}]}
				</script>
			</body></html>
		`;
		const driver = new CheerioDriver({ rawHtml: html, url: "https://example.com" });
		const items = extractJsonLd(driver);
		expect(items).toHaveLength(2);
	});

	it("handles arrays of JSON-LD objects", () => {
		const html = `
			<html><body>
				<script type="application/ld+json">
					[{"@type": "Article"}, {"@type": "Person"}]
				</script>
			</body></html>
		`;
		const driver = new CheerioDriver({ rawHtml: html, url: "https://example.com" });
		expect(extractJsonLd(driver)).toHaveLength(2);
	});

	it("skips invalid JSON", () => {
		const html = `
			<html><body>
				<script type="application/ld+json">not valid json</script>
				<script type="application/ld+json">{"@type": "Article"}</script>
			</body></html>
		`;
		const driver = new CheerioDriver({ rawHtml: html, url: "https://example.com" });
		expect(extractJsonLd(driver)).toHaveLength(1);
	});
});

describe("filterJsonLdByType", () => {
	const items = [
		{ "@type": "Article", name: "A" },
		{ "@type": "Person", name: "B" },
		{ "@type": ["Article", "NewsArticle"], name: "C" },
	];

	it("filters by exact type", () => {
		expect(filterJsonLdByType(items, "Article")).toHaveLength(2);
		expect(filterJsonLdByType(items, "Person")).toHaveLength(1);
	});

	it("returns empty for unmatched type", () => {
		expect(filterJsonLdByType(items, "Product")).toHaveLength(0);
	});
});
