import { describe, expect, it } from "vitest";
import { discoverFixtures } from "./fixtures.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("discoverFixtures", () => {
	it("returns empty array when fixtures dir doesn't exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		expect(discoverFixtures(dir)).toEqual([]);
	});

	it("loads single-locale fixtures from fixtures/", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		mkdirSync(join(dir, "fixtures"), { recursive: true });
		writeFileSync(join(dir, "fixtures", "home.html"), "<html></html>");
		writeFileSync(
			join(dir, "fixtures", "home.expected.json"),
			JSON.stringify({ page: { title: "Home" } }),
		);
		const fixtures = discoverFixtures(dir);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0].name).toBe("home");
		expect(fixtures[0].locale).toBeNull();
		expect(fixtures[0].expected).toEqual({ page: { title: "Home" } });
		expect(fixtures[0].isErrorFixture).toBe(false);
	});

	it("loads locale-tagged fixtures from fixtures/<locale>/", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		mkdirSync(join(dir, "fixtures", "en"), { recursive: true });
		mkdirSync(join(dir, "fixtures", "de"), { recursive: true });
		writeFileSync(join(dir, "fixtures", "en", "ts.html"), "<html>en</html>");
		writeFileSync(join(dir, "fixtures", "de", "ts.html"), "<html>de</html>");
		const fixtures = discoverFixtures(dir);
		expect(fixtures).toHaveLength(2);
		expect(fixtures.map((f) => f.locale).sort()).toEqual(["de", "en"]);
	});

	it("loads error fixtures and meta sidecars", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		mkdirSync(join(dir, "fixtures", "en"), { recursive: true });
		writeFileSync(join(dir, "fixtures", "en", "missing.error.html"), "<html>404</html>");
		writeFileSync(
			join(dir, "fixtures", "en", "missing.meta.json"),
			JSON.stringify({ status: 404, headers: {} }),
		);
		const fixtures = discoverFixtures(dir);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0].isErrorFixture).toBe(true);
		expect(fixtures[0].meta?.status).toBe(404);
	});

	it("treats `_` directory as null locale", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		mkdirSync(join(dir, "fixtures", "_"), { recursive: true });
		writeFileSync(join(dir, "fixtures", "_", "home.html"), "<html></html>");
		const fixtures = discoverFixtures(dir);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0].locale).toBeNull();
	});

	it("sorts deterministically: locale, then name, then errors after happy path", () => {
		const dir = mkdtempSync(join(tmpdir(), "sitely-test-"));
		mkdirSync(join(dir, "fixtures", "en"), { recursive: true });
		mkdirSync(join(dir, "fixtures", "de"), { recursive: true });
		writeFileSync(join(dir, "fixtures", "en", "b.html"), "<html></html>");
		writeFileSync(join(dir, "fixtures", "en", "a.html"), "<html></html>");
		writeFileSync(join(dir, "fixtures", "en", "a.error.html"), "<html></html>");
		writeFileSync(join(dir, "fixtures", "de", "a.html"), "<html></html>");
		const fixtures = discoverFixtures(dir);
		const order = fixtures.map((f) => `${f.locale}/${f.name}${f.isErrorFixture ? ".error" : ""}`);
		expect(order).toEqual(["de/a", "en/a", "en/a.error", "en/b"]);
	});
});
