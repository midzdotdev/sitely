/**
 * Scraping HTTP client with UA rotation, compression, redirects, cookies, timeouts.
 */

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUA(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

export interface FetchPageOptions {
	url: string;
	timeoutMs?: number;
	maxRedirects?: number;
	headers?: Record<string, string>;
}

export interface FetchPageResult {
	html: string;
	status: number;
	headers: Record<string, string>;
	url: string;
	sizeBytes: number;
}

/**
 * Fetch a page with realistic headers and standard scraping practices.
 */
export async function fetchPage(opts: FetchPageOptions): Promise<FetchPageResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

	try {
		const response = await fetch(opts.url, {
			signal: controller.signal,
			redirect: "follow",
			headers: {
				"User-Agent": randomUA(),
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				"Accept-Encoding": "gzip, deflate",
				Connection: "keep-alive",
				"Cache-Control": "no-cache",
				...opts.headers,
			},
		});

		const html = await response.text();

		// Convert response headers to a plain object
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		return {
			html,
			status: response.status,
			headers: responseHeaders,
			url: response.url, // Final URL after redirects
			sizeBytes: new TextEncoder().encode(html).byteLength,
		};
	} finally {
		clearTimeout(timeout);
	}
}
