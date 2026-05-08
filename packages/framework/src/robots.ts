import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
	url: string,
	content: string,
) => {
	isAllowed(url: string, userAgent?: string): boolean | undefined;
};

/** A robots.txt checker that determines whether a URL is allowed for crawling. */
export interface RobotsChecker {
	/**
	 * Check if a URL is allowed by robots.txt rules.
	 * @param url - The full URL to check.
	 * @param userAgent - The user agent to check for. Defaults to `"*"`.
	 * @returns `true` if the URL is allowed.
	 */
	isAllowed(url: string, userAgent?: string): boolean;
}

/**
 * Parse a robots.txt string and return a {@link RobotsChecker}.
 *
 * @remarks
 * If the content is empty or invalid, the returned checker allows all URLs.
 *
 * @param robotsTxtUrl - The URL the robots.txt was fetched from (for relative path resolution).
 * @param content - The raw robots.txt file content.
 * @returns A {@link RobotsChecker} instance.
 */
export function parseRobotsTxt(robotsTxtUrl: string, content: string): RobotsChecker {
	const parser = robotsParser(robotsTxtUrl, content);
	return {
		isAllowed(url: string, userAgent = "*"): boolean {
			return parser.isAllowed(url, userAgent) ?? true;
		},
	};
}
