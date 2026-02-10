// robots-parser's bundled .d.ts is broken (ambient `declare module` shadows
// the actual default export). We type it manually.

interface Robot {
	isAllowed(url: string, ua?: string): boolean | undefined;
	isDisallowed(url: string, ua?: string): boolean | undefined;
	getCrawlDelay(ua?: string): number | undefined;
	getSitemaps(): string[];
	getPreferredHost(): string | null;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = (await import("robots-parser")).default as unknown as (
	url: string,
	content: string,
) => Robot;

/** Check if a URL is allowed by a robots.txt file. */
export function isAllowedByRobots(
	robotsTxtUrl: string,
	robotsTxtContent: string,
	targetUrl: string,
	userAgent = "*",
): boolean {
	const robots = robotsParser(robotsTxtUrl, robotsTxtContent);
	return robots.isAllowed(targetUrl, userAgent) !== false;
}
