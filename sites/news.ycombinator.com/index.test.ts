import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFixtureTest } from "@wapi/framework";
import site from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("news.ycombinator.com", () => {
	describe("front page", () => {
		const html = readFileSync(join(__dirname, "fixtures/front-page.html"), "utf-8");

		it("validates the front page", () => {
			const t = createFixtureTest({
				site,
				html,
				url: "https://news.ycombinator.com/news",
			});
			expect(t.validate("/news")).toBe(true);
		});

		it("extracts stories from front page", async () => {
			const t = createFixtureTest({
				site,
				html,
				url: "https://news.ycombinator.com/news",
			});
			const data = await t.extract("/news");
			const stories = data["frontPage"] as Array<Record<string, unknown>>;

			expect(stories).toHaveLength(3);
			expect(stories[0]!["id"]).toBe("12345");
			expect(stories[0]!["title"]).toBe("Show HN: Something Cool");
			expect(stories[1]!["title"]).toBe("Why Rust is Great");
		});

		it("finds pagination link", () => {
			const t = createFixtureTest({
				site,
				html,
				url: "https://news.ycombinator.com/news",
			});
			const next = site.pages["/news"]!.paginate!.next(t.ctx);
			expect(next).toBe("https://news.ycombinator.com/news?p=2");
		});
	});

	describe("story page", () => {
		const html = readFileSync(join(__dirname, "fixtures/item-1.html"), "utf-8");

		it("validates a story page", () => {
			const t = createFixtureTest({
				site,
				html,
				url: "https://news.ycombinator.com/item?id=12345",
				params: { id: "12345" },
			});
			expect(t.validate("/item")).toBe(true);
		});

		it("extracts story with comments", async () => {
			const t = createFixtureTest({
				site,
				html,
				url: "https://news.ycombinator.com/item?id=12345",
				params: { id: "12345" },
			});
			const data = await t.extract("/item");
			const story = data["story"] as Record<string, unknown>;

			expect(story["title"]).toBe("Show HN: Something Cool");
			expect(story["author"]).toBe("testuser");
			expect(story["score"]).toBe(150);

			const comments = story["comments"] as Array<Record<string, unknown>>;
			expect(comments).toHaveLength(2);
			expect(comments[0]!["author"]).toBe("commenter1");
			expect(comments[0]!["text"]).toBe("This is a great project!");
		});
	});

	it("rejects a block page", () => {
		const t = createFixtureTest({
			site,
			html: "<html><body>Error</body></html>",
			url: "https://news.ycombinator.com/news",
			status: 503,
		});
		expect(t.validate("/news")).toBe(false);
	});
});
