import { createCheerioDriver } from "@wapi/page";
import { createExtractContext } from "./context.js";
import type { SiteDefinition, ExtractContext } from "./types.js";

export interface FixtureTestOptions {
	/** The site definition to test. */
	site: SiteDefinition;
	/** Raw HTML content (e.g. loaded from a fixture file). */
	html: string;
	/** The URL this HTML was fetched from. */
	url: string;
	/** URL pattern params extracted from the URL. */
	params?: Record<string, string>;
	/** HTTP status code to simulate. */
	status?: number;
}

export interface FixtureTestResult {
	ctx: ExtractContext;
	/** Run the validate function for the matched page. */
	validate: (pagePattern: string) => boolean;
	/** Run the extract function for the matched page. */
	extract: (pagePattern: string) => Promise<Record<string, unknown>>;
}

/**
 * Create a test harness for running site definitions against HTML fixtures.
 */
export function createFixtureTest(opts: FixtureTestOptions): FixtureTestResult {
	const driver = createCheerioDriver({
		html: opts.html,
		url: opts.url,
		status: opts.status ?? 200,
	});

	const ctx = createExtractContext({
		driver,
		params: opts.params ?? {},
		rawHtml: opts.html,
	});

	return {
		ctx,
		validate(pagePattern: string) {
			const page = opts.site.pages[pagePattern];
			if (!page) throw new Error(`No page matches pattern: ${pagePattern}`);
			return page.validate(ctx);
		},
		async extract(pagePattern: string) {
			const page = opts.site.pages[pagePattern];
			if (!page) throw new Error(`No page matches pattern: ${pagePattern}`);
			return page.extract(ctx);
		},
	};
}
