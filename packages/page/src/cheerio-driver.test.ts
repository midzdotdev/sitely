import { describe, expect, it } from "vitest";
import { createCheerioDriver } from "./cheerio-driver.js";

const HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1 id="heading">Hello World</h1>
  <ul class="items">
    <li class="item first" data-id="1">One</li>
    <li class="item" data-id="2">Two</li>
    <li class="item" data-id="3">Three</li>
  </ul>
  <a href="/link">Click</a>
</body>
</html>`;

describe("CheerioDriver", () => {
	const driver = createCheerioDriver({
		html: HTML,
		url: "https://example.com/test",
		status: 200,
	});

	it("exposes page metadata", () => {
		expect(driver.title()).toBe("Test Page");
		expect(driver.url).toBe("https://example.com/test");
		expect(driver.status).toBe(200);
	});

	it("queries single elements", () => {
		const h1 = driver.$("#heading");
		expect(h1).not.toBeNull();
		expect(h1!.text()).toBe("Hello World");
		expect(h1!.attr("id")).toBe("heading");
		expect(h1!.exists()).toBe(true);
	});

	it("queries multiple elements", () => {
		const items = driver.$$(".item");
		expect(items).toHaveLength(3);
		expect(items[0]!.text()).toBe("One");
		expect(items[1]!.text()).toBe("Two");
		expect(items[2]!.text()).toBe("Three");
	});

	it("returns null for missing elements", () => {
		expect(driver.$(".nonexistent")).toBeNull();
	});

	it("reads data attributes", () => {
		const first = driver.$(".item.first");
		expect(first!.data("id")).toBe("1");
	});

	it("reads classes", () => {
		const first = driver.$(".item.first");
		expect(first!.classes()).toEqual(["item", "first"]);
	});

	it("navigates siblings", () => {
		const first = driver.$(".item.first");
		const second = first!.next();
		expect(second).not.toBeNull();
		expect(second!.text()).toBe("Two");
	});

	it("navigates parent and children", () => {
		const ul = driver.$("ul.items");
		const children = ul!.children();
		expect(children).toHaveLength(3);
		expect(children[0]!.parent()!.classes()).toEqual(["items"]);
	});

	it("supports nested queries", () => {
		const ul = driver.$("ul.items");
		const item = ul!.$(".item");
		expect(item!.text()).toBe("One");
		const allItems = ul!.$$(".item");
		expect(allItems).toHaveLength(3);
	});

	it("reads href attributes", () => {
		const a = driver.$("a");
		expect(a!.attr("href")).toBe("/link");
	});
});
