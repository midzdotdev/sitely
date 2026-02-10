import { describe, expect, it } from "vitest";
import { defineSite } from "./define-site.js";
import { Schema } from "@wapi/schemas";

describe("defineSite", () => {
	it("preserves the definition object", () => {
		const site = defineSite({
			name: "Test Site",
			domain: "example.com",
			normalizeUrl: (url) => url,
			rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
			resources: {
				page: {
					schema: Schema.Article,
					params: { id: { type: "string", required: true, description: "Page ID" } },
					resolve: ({ id }) => `/page/${id}`,
					ttl: "1h",
				},
			},
			pages: {
				"/page/:id": {
					provides: ["page"],
					examples: ["https://example.com/page/1"],
					validate: (ctx) => ctx.status === 200,
					extract: async (ctx) => ({ page: { title: ctx.$("#title")?.text() } }),
				},
			},
			crawl: { enabled: false, respectRobotsTxt: true, maxDepth: 0 },
		});

		expect(site.name).toBe("Test Site");
		expect(site.domain).toBe("example.com");
		expect(site.resources["page"]?.schema).toBe("Article");
	});

	it("returns the definition with correct structure", () => {
		const site = defineSite({
			name: "Minimal",
			domain: "min.com",
			normalizeUrl: (u) => u,
			rateLimit: { maxConcurrent: 1, requestsPerSecond: 1 },
			resources: {},
			pages: {},
			crawl: { enabled: false, respectRobotsTxt: true, maxDepth: 0 },
		});

		expect(site.domain).toBe("min.com");
		expect(site.crawl.enabled).toBe(false);
	});
});
