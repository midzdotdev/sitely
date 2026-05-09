import { createFixtureLoader, describePageExtraction } from "@sitely/framework/testing";
import { describe, expect } from "vitest";
import site from "./index.js";

const loadFixture = createFixtureLoader(import.meta.url);

describe("en.wikipedia.org", () => {
	describePageExtraction({
		site,
		pageKey: "/wiki/:title",
		loadFixture,
		fixtures: [
			{ fixture: "wiki-typescript.html", url: "https://en.wikipedia.org/wiki/TypeScript" },
		],
		assertExtraction: (result) => {
			const article = result.article as Record<string, unknown>;
			expect(article.title).toBe("TypeScript");
			expect(article.summary).toContain("free and open-source");
			expect(article.categories).toEqual([
				"Programming languages",
				"Microsoft software",
				"TypeScript",
			]);
			expect(article.image).not.toBeNull();
			expect(article.canonical).toBe("https://en.wikipedia.org/wiki/TypeScript");
		},
	});
});
