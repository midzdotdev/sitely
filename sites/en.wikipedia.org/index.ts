import { defineSite } from "@sitely/framework";
import { Article } from "@sitely/schemas";

export default defineSite({
	site: { id: "wikipedia", displayName: "Wikipedia (English)" },

	origins: [{ hostname: "{locale}.wikipedia.org", templated: true }],

	locales: {
		source: "host",
		values: ["en", "de", "fr"],
		default: "en",
	},

	normalizeUrl: (url: string) => {
		const u = new URL(url);
		u.searchParams.delete("action");
		u.searchParams.delete("oldid");
		u.searchParams.delete("variant");
		u.hash = "";
		return u.toString();
	},

	rateLimit: {
		maxConcurrent: 3,
		requestsPerSecond: 1,
	},

	schemas: { Article },

	resources: {
		article: {
			schema: "Article",
			params: {
				title: {
					type: "string" as const,
					required: true,
					description: "Article title (URL-encoded)",
				},
			},
			resolve: (params: Record<string, string>) => `/wiki/${encodeURIComponent(params.title)}`,
			ttl: { default: "24h", min: "1m", max: "30d" },
		},
	},

	pages: {
		"/wiki/:title": {
			provides: ["article"],
			examples: [
				"https://en.wikipedia.org/wiki/TypeScript",
				"https://en.wikipedia.org/wiki/Node.js",
			],

			validate: (ctx) => {
				return (
					ctx.$("#content")?.exists() === true &&
					ctx.$(".mw-parser-output")?.exists() === true &&
					ctx.status === 200
				);
			},

			extract: async (ctx) => {
				const jsonLd = ctx.jsonLd("Article");
				const ldData = jsonLd[0] ?? {};

				const categories = ctx.$$("#mw-normal-catlinks li a").map((el) => el.text());

				const image =
					ctx.$(".infobox img")?.attr("src") ??
					ctx.$(".mw-parser-output .thumbimage")?.attr("src") ??
					null;

				return {
					article: {
						title: ctx.$("#firstHeading")?.text()?.trim() ?? "",
						summary: ctx.$(".mw-parser-output > p:not(.mw-empty-elt)")?.text()?.trim() ?? "",
						image: ctx.media(image),
						categories,
						lastModified: ctx.$("#footer-info-lastmod")?.text()?.trim() ?? null,
						url: ctx.url,
						canonical: ctx.canonical,
						...ldData,
					},
				};
			},
		},
	},

	crawl: {
		enabled: true,
		respectRobotsTxt: true,
		maxDepth: 2,
		filterLinks: (url: string) =>
			!url.includes("/Special:") &&
			!url.includes("/Wikipedia:") &&
			!url.includes("/Talk:") &&
			!url.includes("/User:"),
	},
});
