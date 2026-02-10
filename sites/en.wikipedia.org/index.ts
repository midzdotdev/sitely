import { defineSite, Schema } from "@wapi/framework";

export default defineSite({
	name: "Wikipedia (English)",
	domain: "en.wikipedia.org",
	aliases: ["www.wikipedia.org"],

	normalizeUrl: (url) => {
		const u = new URL(url);
		u.searchParams.delete("action");
		u.searchParams.delete("oldid");
		u.hash = "";
		return u.toString();
	},

	rateLimit: {
		maxConcurrent: 3,
		requestsPerSecond: 1,
	},

	resources: {
		article: {
			schema: Schema.Article,
			params: {
				title: {
					type: "string",
					required: true,
					description: "Article title (URL-encoded)",
				},
			},
			resolve: (p) => `/wiki/${encodeURIComponent(p["title"] ?? "")}`,
			ttl: "24h",
		},
	},

	pages: {
		"/wiki/:title": {
			provides: ["article"],
			examples: ["https://en.wikipedia.org/wiki/TypeScript"],

			validate: (ctx) => {
				return (
					ctx.$("#content")?.exists() === true &&
					ctx.$(".mw-parser-output")?.exists() === true &&
					ctx.status === 200
				);
			},

			extract: async (ctx) => {
				const ld = ctx.jsonLd(Schema.Article);
				return {
					article: {
						title: ctx.$("#firstHeading")?.text()?.trim() ?? "",
						summary:
							ctx
								.$(".mw-parser-output > p")
								?.text()
								?.trim() ?? "",
						image: ctx.media(ctx.$(".infobox img")?.attr("src")),
						categories: ctx
							.$$("#mw-normal-catlinks li a")
							.map((el) => el.text()),
						lastModified: ctx.$("#footer-info-lastmod")?.text() ?? "",
						...((ld[0] as Record<string, unknown>) ?? {}),
					},
				};
			},
		},
	},

	crawl: {
		enabled: true,
		respectRobotsTxt: true,
		maxDepth: 2,
		filterLinks: (url) => !url.includes("/Special:"),
	},
});
