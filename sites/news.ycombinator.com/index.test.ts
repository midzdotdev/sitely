import {
	createFixtureLoader,
	createTestContext,
	describePageExtraction,
} from "@wapi/framework/testing";
import { describe, expect, it } from "vitest";
import site from "./index.js";

const loadFixture = createFixtureLoader(import.meta.url);

describe("news.ycombinator.com", () => {
	describePageExtraction({
		site,
		pageKey: "/news",
		loadFixture,
		fixtures: [{ fixture: "front-page.html", url: "https://news.ycombinator.com/news" }],
		assertExtraction: (result) => {
			const stories = result.frontPage as Array<Record<string, unknown>>;
			expect(stories).toHaveLength(3);
			expect(stories[0].id).toBe("40001");
			expect(stories[0].title).toBe("Show HN: A cool open source project");
			expect(stories[0].score).toBe(142);
			expect(stories[0].author).toBe("dev1");
			expect(stories[0].commentCount).toBe(87);
		},
	});

	describePageExtraction({
		site,
		pageKey: "/item",
		loadFixture,
		fixtures: [{ fixture: "item-1.html", url: "https://news.ycombinator.com/item?id=40001" }],
		assertExtraction: (result) => {
			const story = result.story as Record<string, unknown>;
			expect(story.id).toBe("40001");
			expect(story.title).toBe("Show HN: A cool open source project");
			expect(story.author).toBe("dev1");
			expect(story.score).toBe(142);

			const comments = story.comments as Array<Record<string, unknown>>;
			expect(comments).toHaveLength(2);
			expect(comments[0].author).toBe("commenter1");
			expect(comments[0].text).toContain("amazing");
		},
	});

	describe("pagination", () => {
		const html = loadFixture("front-page.html");

		it("detects next page link", () => {
			const ctx = createTestContext({
				html,
				url: "https://news.ycombinator.com/news",
			});
			const nextUrl = site.pages["/news"].paginate!.next(ctx);
			expect(nextUrl).toBe("https://news.ycombinator.com/news?p=2");
		});

		it("returns null when no next page", () => {
			const htmlNoMore = html.replace('<a class="morelink" href="/news?p=2">More</a>', "");
			const ctx = createTestContext({
				html: htmlNoMore,
				url: "https://news.ycombinator.com/news",
			});
			expect(site.pages["/news"].paginate!.next(ctx)).toBeNull();
		});
	});
});
