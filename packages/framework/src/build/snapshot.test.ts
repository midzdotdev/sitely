import { describe, expect, it } from "vitest";
import { urlToFixtureName } from "./snapshot.js";

describe("urlToFixtureName", () => {
	it("derives a slug from path segments", () => {
		expect(urlToFixtureName("https://en.wikipedia.org/wiki/TypeScript")).toBe("wiki-typescript");
	});

	it("includes query params in the slug", () => {
		expect(urlToFixtureName("https://news.ycombinator.com/news?p=2")).toBe("news-p-2");
	});

	it("returns 'index' for the bare root path", () => {
		expect(urlToFixtureName("https://example.com/")).toBe("index");
	});

	it("strips non-alphanumeric characters from the slug", () => {
		expect(urlToFixtureName("https://example.com/foo!bar")).toBe("foobar");
	});

	it("collapses repeated dashes and trims edges", () => {
		expect(urlToFixtureName("https://example.com/foo--bar---baz")).toBe("foo-bar-baz");
	});

	it("lowercases segments", () => {
		expect(urlToFixtureName("https://example.com/MixedCase")).toBe("mixedcase");
	});

	it("handles multiple query params in URL-encoded order", () => {
		expect(urlToFixtureName("https://example.com/?id=42&p=2")).toBe("id-42-p-2");
	});
});
