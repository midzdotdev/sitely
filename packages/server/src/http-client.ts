import type { Logger } from "pino";

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUserAgent(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface FetchPageResult {
	html: string;
	status: number;
	headers: Record<string, string>;
	url: string;
	sizeBytes: number;
}

export interface FetchPageOptions {
	url: string;
	timeoutMs?: number;
	maxRedirects?: number;
	logger?: Logger;
}

/**
 * Fetch a page with realistic browser headers, compression, redirects, and retries.
 * Retries once on transient network errors with exponential backoff.
 */
export async function fetchPage(opts: FetchPageOptions): Promise<FetchPageResult> {
	const { url, timeoutMs = 30_000, logger } = opts;
	const ua = randomUserAgent();

	const attempt = async (retryCount: number): Promise<FetchPageResult> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				signal: controller.signal,
				redirect: "follow",
				headers: {
					"User-Agent": ua,
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
					"Accept-Encoding": "gzip, deflate, br",
					Connection: "keep-alive",
					"Cache-Control": "no-cache",
				},
			});

			const html = await response.text();
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});

			return {
				html,
				status: response.status,
				headers,
				url: response.url,
				sizeBytes: Buffer.byteLength(html),
			};
		} catch (err) {
			if (retryCount < 1 && isTransientError(err)) {
				logger?.warn({ url, retryCount, err }, "Transient fetch error, retrying");
				await sleep(1000 * (retryCount + 1));
				return attempt(retryCount + 1);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	};

	return attempt(0);
}

function isTransientError(err: unknown): boolean {
	if (err instanceof Error) {
		const msg = err.message.toLowerCase();
		return (
			msg.includes("abort") ||
			msg.includes("timeout") ||
			msg.includes("econnreset") ||
			msg.includes("econnrefused") ||
			msg.includes("enotfound") ||
			msg.includes("network")
		);
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
