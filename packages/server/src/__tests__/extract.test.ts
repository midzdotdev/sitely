import { Schema, defineSite } from "@wapi/framework";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockDbData } from "./helpers.js";
import { WIKIPEDIA_FIXTURE_HTML, createTestApiKey, createTestApp } from "./helpers.js";

// ─── Mock modules ────────────────────────────────────────────────────────────
// Mock fetchPage to return fixture HTML instead of making real HTTP requests.
vi.mock("../http-client.js", () => ({
	fetchPage: vi.fn(),
}));

// Mock isAllowedByRobots to always return true (robots checking is unit-tested elsewhere).
vi.mock("../services/robots-service.js", () => ({
	isAllowedByRobots: vi.fn().mockResolvedValue(true),
}));

// We need to import after mocking so the mock is in place.
import { fetchPage } from "../http-client.js";
import { isAllowedByRobots } from "../services/robots-service.js";

// ─── Test site definition ────────────────────────────────────────────────────

const wikipediaSite = defineSite({
	name: "Wikipedia (English)",
	domain: "en.wikipedia.org",
	normalizeUrl: (url: string) => {
		const u = new URL(url);
		u.searchParams.delete("action");
		u.searchParams.delete("oldid");
		u.searchParams.delete("variant");
		u.hash = "";
		return u.toString();
	},
	rateLimit: {
		maxConcurrent: 3,
		requestsPerSecond: 10, // higher limit for tests
	},
	resources: {
		article: {
			schema: Schema.Article,
			params: {
				title: {
					type: "string" as const,
					required: true,
					description: "Article title (URL-encoded)",
				},
			},
			resolve: (params: Record<string, string>) => `/wiki/${encodeURIComponent(params.title)}`,
			ttl: "24h",
		},
	},
	pages: {
		"/wiki/:title": {
			provides: ["article"],
			examples: ["https://en.wikipedia.org/wiki/TypeScript"],
			validate: (ctx) => {
				return (
					ctx.$("#content")?.exists() === true &&
					ctx.$(".mw-parser-output")?.exists() === true &&
					ctx.status === 200
				);
			},
			extract: async (ctx) => {
				const jsonLd = ctx.jsonLd("Article");
				const ldData = jsonLd[0] ?? {};
				const categories = ctx.$$("#mw-normal-catlinks li a").map((el) => el.text());
				const image =
					ctx.$(".infobox img")?.attr("src") ??
					ctx.$(".mw-parser-output .thumbimage")?.attr("src") ??
					null;

				return {
					article: {
						title: ctx.$("#firstHeading")?.text()?.trim() ?? "",
						summary: ctx.$(".mw-parser-output > p:not(.mw-empty-elt)")?.text()?.trim() ?? "",
						image: ctx.media(image),
						categories,
						lastModified: ctx.$("#footer-info-lastmod")?.text()?.trim() ?? null,
						url: ctx.url,
						canonical: ctx.canonical,
						...ldData,
					},
				};
			},
		},
	},
});

// ─── Test setup helpers ──────────────────────────────────────────────────────

function setupFetchPageMock(html: string = WIKIPEDIA_FIXTURE_HTML, url?: string) {
	const mockFetchPage = fetchPage as ReturnType<typeof vi.fn>;
	mockFetchPage.mockResolvedValue({
		html,
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
		url: url ?? "https://en.wikipedia.org/wiki/TypeScript",
		sizeBytes: Buffer.byteLength(html),
	});
}

// ─── Shared reset ────────────────────────────────────────────────────────────

function resetMocks() {
	vi.clearAllMocks();
	// Re-apply default mock return values after clearAllMocks wipes them
	(isAllowedByRobots as ReturnType<typeof vi.fn>).mockResolvedValue(true);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /v1/extract (URL-based extraction)", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;
	let plainKey: string;

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp({ sites: [wikipediaSite] });
		app = testApp.app;
		data = testApp.data;
		const keyResult = createTestApiKey(data);
		plainKey = keyResult.plainKey;
		setupFetchPageMock();
	});

	it("returns 401 when no authorization header is provided", async () => {
		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
	});

	it("returns 401 with an invalid API key", async () => {
		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: "Bearer wapi_sk_invalidkey123" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
	});

	it("returns 401 with a non-wapi-prefixed key", async () => {
		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: "Bearer some_random_key" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toContain("wapi_sk_");
	});

	it("returns 400 when url query parameter is missing", async () => {
		const res = await app.request("/v1/extract", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("bad_request");
		expect(body.error.message).toContain("url");
	});

	it("returns 400 for an invalid URL", async () => {
		const res = await app.request("/v1/extract?url=not-a-valid-url", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("bad_request");
		expect(body.error.message).toContain("Invalid URL");
	});

	it("extracts data from a known site with a valid API key", async () => {
		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("success");
		expect(body.definitionType).toBe("site");
		expect(body.data).toBeDefined();
		expect(body.data.article).toBeDefined();
		expect(body.data.article.title).toBe("TypeScript");
		expect(body.cached).toBe(false);
		expect(body.cost).toBeDefined();
		expect(body.site.domain).toBe("en.wikipedia.org");
	});

	it("returns cached results on second request", async () => {
		// First request — should fetch
		const res1 = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res1.status).toBe(200);
		const body1 = await res1.json();
		expect(body1.cached).toBe(false);

		// Second request — should use cache
		const res2 = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res2.status).toBe(200);
		const body2 = await res2.json();
		expect(body2.cached).toBe(true);
		expect(body2.data.article.title).toBe("TypeScript");
	});

	it("bypasses cache when fresh=true", async () => {
		// First request — populates cache
		await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});

		// Second request with fresh=true — should not use cache
		const res = await app.request(
			"/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript&fresh=true",
			{
				headers: { Authorization: `Bearer ${plainKey}` },
			},
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cached).toBe(false);
	});

	it("returns 403 when robots.txt forbids the URL", async () => {
		const mockRobots = isAllowedByRobots as ReturnType<typeof vi.fn>;
		mockRobots.mockResolvedValue(false);

		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.status).toBe("forbidden_by_robots");
	});
});

describe("GET /v1/sites/:domain/:resource (resource-based extraction)", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;
	let plainKey: string;

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp({ sites: [wikipediaSite] });
		app = testApp.app;
		data = testApp.data;
		const keyResult = createTestApiKey(data);
		plainKey = keyResult.plainKey;
		setupFetchPageMock();
	});

	it("returns 401 when no API key is provided", async () => {
		const res = await app.request("/v1/sites/en.wikipedia.org/article?title=TypeScript");
		expect(res.status).toBe(401);
	});

	it("extracts a resource with valid params", async () => {
		const res = await app.request("/v1/sites/en.wikipedia.org/article?title=TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("success");
		expect(body.data.article).toBeDefined();
		expect(body.data.article.title).toBe("TypeScript");
		expect(body.site.domain).toBe("en.wikipedia.org");
	});

	it("returns 404 for an unknown domain", async () => {
		const res = await app.request("/v1/sites/unknown.example.com/article?title=Test", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("not_found");
	});

	it("returns 404 for an unknown resource on a valid domain", async () => {
		const res = await app.request("/v1/sites/en.wikipedia.org/nonexistent?title=TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("not_found");
		expect(body.error.message).toContain("nonexistent");
	});

	it("returns cached results on second request", async () => {
		// First request
		const res1 = await app.request("/v1/sites/en.wikipedia.org/article?title=TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res1.status).toBe(200);
		const body1 = await res1.json();
		expect(body1.cached).toBe(false);

		// Second request — should use cache
		const res2 = await app.request("/v1/sites/en.wikipedia.org/article?title=TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res2.status).toBe(200);
		const body2 = await res2.json();
		expect(body2.cached).toBe(true);
	});
});

describe("GET /v1/sites (site discovery)", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let plainKey: string;

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp({ sites: [wikipediaSite] });
		app = testApp.app;
		const keyResult = createTestApiKey(testApp.data);
		plainKey = keyResult.plainKey;
	});

	it("lists all registered sites", async () => {
		const res = await app.request("/v1/sites", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sites).toBeInstanceOf(Array);
		const wiki = body.sites.find((s: { domain: string }) => s.domain === "en.wikipedia.org");
		expect(wiki).toBeDefined();
		expect(wiki.name).toBe("Wikipedia (English)");
		expect(wiki.resources).toBeInstanceOf(Array);
		expect(wiki.resources.length).toBeGreaterThan(0);
	});

	it("returns details for a specific site", async () => {
		const res = await app.request("/v1/sites/en.wikipedia.org", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.domain).toBe("en.wikipedia.org");
		expect(body.name).toBe("Wikipedia (English)");
	});

	it("returns 404 for unknown site domain", async () => {
		const res = await app.request("/v1/sites/nonexistent.example.com", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("not_found");
	});
});

describe("GET /v1/schemas (schema discovery)", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let plainKey: string;

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp({ sites: [wikipediaSite] });
		app = testApp.app;
		const keyResult = createTestApiKey(testApp.data);
		plainKey = keyResult.plainKey;
	});

	it("lists all schemas", async () => {
		const res = await app.request("/v1/schemas", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.schemas).toBeInstanceOf(Array);
	});

	it("finds sites for a given schema type", async () => {
		const res = await app.request(`/v1/schemas/${Schema.Article}/sites`, {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.schemaType).toBe(Schema.Article);
		expect(body.sites).toBeInstanceOf(Array);
	});
});

describe("Rate limiting", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;
	let plainKey: string;

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp({ sites: [wikipediaSite] });
		app = testApp.app;
		data = testApp.data;
		const keyResult = createTestApiKey(data);
		plainKey = keyResult.plainKey;
		setupFetchPageMock();
	});

	it("returns rate limit headers on responses", async () => {
		const res = await app.request("/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
		expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
		expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
	});
});

describe("POST /v1/auth/signup", () => {
	let app: ReturnType<typeof createTestApp>["app"];

	beforeEach(() => {
		resetMocks();
		const testApp = createTestApp();
		app = testApp.app;
	});

	it("creates a new account with email", async () => {
		const res = await app.request("/v1/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "test@example.com", name: "Test User" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.consumerId).toBeDefined();
		expect(body.apiKey).toBeDefined();
		expect(body.apiKey).toMatch(/^wapi_sk_/);
		expect(body.tokenBalance).toBe(10_000);
	});

	it("returns 400 when email is missing", async () => {
		const res = await app.request("/v1/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("bad_request");
	});

	it("returns 409 for duplicate email", async () => {
		// First signup
		await app.request("/v1/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "dupe@example.com" }),
		});

		// Duplicate signup
		const res = await app.request("/v1/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "dupe@example.com" }),
		});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe("conflict");
	});
});

describe("GET /healthz", () => {
	it("returns ok when redis is healthy", async () => {
		const testApp = createTestApp();
		const res = await testApp.app.request("/healthz");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});
});
