import { describe, expect, it } from "vitest";
import { CheerioDriver } from "./cheerio-driver.js";

const SAMPLE_HTML = `
<html>
<head><title>Test Page</title></head>
<body>
  <div id="main" class="container primary" data-version="2">
    <h1>Hello World</h1>
    <p class="intro">First paragraph</p>
    <p class="body">Second paragraph</p>
    <ul>
      <li class="item"><a href="/one">One</a></li>
      <li class="item"><a href="/two">Two</a></li>
      <li class="item"><a href="/three">Three</a></li>
    </ul>
  </div>
  <footer>Footer text</footer>
</body>
</html>
`;

function createDriver(html = SAMPLE_HTML) {
	return new CheerioDriver({
		rawHtml: html,
		url: "https://example.com/test",
		status: 200,
		headers: { "content-type": "text/html" },
	});
}

describe("CheerioDriver", () => {
	it("stores url, status, and headers", () => {
		const driver = createDriver();
		expect(driver.url).toBe("https://example.com/test");
		expect(driver.status).toBe(200);
		expect(driver.headers["content-type"]).toBe("text/html");
	});

	it("extracts page title", () => {
		expect(createDriver().title()).toBe("Test Page");
	});

	it("queries a single element with $", () => {
		const el = createDriver().$("h1");
		expect(el).not.toBeNull();
		expect(el!.text()).toBe("Hello World");
	});

	it("returns null for unmatched $ query", () => {
		expect(createDriver().$(".nonexistent")).toBeNull();
	});

	it("queries multiple elements with $$", () => {
		const items = createDriver().$$("li.item");
		expect(items).toHaveLength(3);
		expect(items[0].text()).toBe("One");
		expect(items[2].text()).toBe("Three");
	});

	it("reads attributes", () => {
		const link = createDriver().$("a[href='/two']");
		expect(link!.attr("href")).toBe("/two");
		expect(link!.attr("nonexistent")).toBeNull();
	});

	it("reads data attributes", () => {
		const el = createDriver().$("#main");
		expect(el!.data("version")).toBe("2");
		expect(el!.data("missing")).toBeNull();
	});

	it("reads classes", () => {
		const el = createDriver().$("#main");
		expect(el!.classes()).toEqual(["container", "primary"]);
	});

	it("navigates with next/prev/parent", () => {
		const intro = createDriver().$("p.intro");
		expect(intro!.next()!.text()).toBe("Second paragraph");
		expect(intro!.next()!.prev()!.text()).toBe("First paragraph");
		expect(intro!.parent()!.attr("id")).toBe("main");
	});

	it("returns null for missing next/prev/parent", () => {
		const html = "<div><span>only</span></div>";
		const driver = createDriver(html);
		const span = driver.$("span");
		expect(span!.next()).toBeNull();
		expect(span!.prev()).toBeNull();
	});

	it("lists children", () => {
		const ul = createDriver().$("ul");
		const children = ul!.children();
		expect(children).toHaveLength(3);
	});

	it("supports nested queries on elements", () => {
		const driver = createDriver();
		const main = driver.$("#main");
		const link = main!.$("a[href='/one']");
		expect(link!.text()).toBe("One");
	});

	it("exists() returns true for matched and false for null-equivalent", () => {
		const driver = createDriver();
		expect(driver.$("h1")!.exists()).toBe(true);
	});

	it("returns inner html", () => {
		const driver = createDriver();
		const h1 = driver.$("h1");
		expect(h1!.html()).toBe("Hello World");
	});
});
