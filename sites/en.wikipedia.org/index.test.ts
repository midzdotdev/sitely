import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFixtureTest } from "@wapi/framework";
import site from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("en.wikipedia.org", () => {
	const html = readFileSync(join(__dirname, "fixtures/wiki-typescript.html"), "utf-8");

	it("validates a real article page", () => {
		const t = createFixtureTest({
			site,
			html,
			url: "https://en.wikipedia.org/wiki/TypeScript",
			params: { title: "TypeScript" },
		});
		expect(t.validate("/wiki/:title")).toBe(true);
	});

	it("extracts article data", async () => {
		const t = createFixtureTest({
			site,
			html,
			url: "https://en.wikipedia.org/wiki/TypeScript",
			params: { title: "TypeScript" },
		});
		const data = await t.extract("/wiki/:title");
		const article = data["article"] as Record<string, unknown>;

		expect(article["title"]).toBe("TypeScript");
		expect(article["summary"]).toContain("high-level programming language");
		expect(article["categories"]).toEqual([
			"Programming languages",
			"Microsoft",
			"TypeScript",
		]);
		expect(article["image"]).toBeTruthy();
	});

	it("rejects a block page", () => {
		const t = createFixtureTest({
			site,
			html: "<html><body><h1>Access Denied</h1></body></html>",
			url: "https://en.wikipedia.org/wiki/TypeScript",
			params: { title: "TypeScript" },
			status: 403,
		});
		expect(t.validate("/wiki/:title")).toBe(false);
	});
});
