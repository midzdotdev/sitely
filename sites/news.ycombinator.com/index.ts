import { Schema, defineSite } from "@wapi/framework";

export default defineSite({
	name: "Hacker News",
	domain: "news.ycombinator.com",

	normalizeUrl: (url: string) => {
		const u = new URL(url);
		// Keep only meaningful query params
		const id = u.searchParams.get("id");
		const p = u.searchParams.get("p");
		u.search = "";
		if (id) u.searchParams.set("id", id);
		if (p) u.searchParams.set("p", p);
		u.hash = "";
		return u.toString();
	},

	rateLimit: {
		maxConcurrent: 2,
		requestsPerSecond: 0.5,
	},

	resources: {
		story: {
			schema: Schema.Article,
			params: {
				id: {
					type: "string" as const,
					required: true,
					description: "HN story ID",
				},
			},
			resolve: (params: Record<string, string>) => `/item?id=${params.id}`,
			ttl: "1h",
		},
		frontPage: {
			schema: Schema.ItemList,
			params: {},
			resolve: () => "/news",
			ttl: "5m",
		},
	},

	pages: {
		"/news": {
			provides: ["frontPage"],
			examples: ["https://news.ycombinator.com/news", "https://news.ycombinator.com/news?p=2"],

			validate: (ctx) => {
				return ctx.$(".itemlist")?.exists() === true && ctx.status === 200;
			},

			paginate: {
				next: (ctx) => {
					const href = ctx.$("a.morelink")?.attr("href");
					if (!href) return null;
					try {
						return new URL(href, ctx.url).toString();
					} catch {
						return null;
					}
				},
			},

			extract: async (ctx) => {
				const items = ctx.$$(".athing");
				const stories = items.map((el) => {
					const titleLink = el.$(".titleline > a");
					const subtextRow = el.next();
					return {
						id: el.attr("id"),
						title: titleLink?.text() ?? "",
						url: titleLink?.attr("href") ?? "",
						score: Number.parseInt(subtextRow?.$(".score")?.text()?.replace(/\D/g, "") ?? "0", 10),
						author: subtextRow?.$(".hnuser")?.text() ?? "",
						commentCount: parseCommentCount(subtextRow?.$$("a")?.pop()?.text() ?? ""),
					};
				});

				return { frontPage: stories };
			},
		},

		"/item": {
			provides: ["story"],
			examples: ["https://news.ycombinator.com/item?id=1"],

			validate: (ctx) => {
				return ctx.$(".fatitem")?.exists() === true && ctx.status === 200;
			},

			extract: async (ctx) => {
				const titleLink = ctx.$(".titleline > a");
				const comments = ctx.$$(".comtr").map((el) => ({
					id: el.attr("id"),
					author: el.$(".hnuser")?.text() ?? "",
					text: el.$(".commtext")?.text() ?? "",
				}));

				return {
					story: {
						id: ctx.params.id,
						title: titleLink?.text() ?? "",
						url: titleLink?.attr("href") ?? "",
						author: ctx.$(".hnuser")?.text() ?? "",
						score: Number.parseInt(ctx.$(".score")?.text()?.replace(/\D/g, "") ?? "0", 10),
						comments,
						commentCount: comments.length,
					},
				};
			},
		},
	},

	crawl: {
		enabled: true,
		respectRobotsTxt: true,
		maxDepth: 1,
	},
});

function parseCommentCount(text: string): number {
	if (!text || text.includes("discuss")) return 0;
	const match = text.match(/(\d+)\s*comment/);
	return match ? Number.parseInt(match[1], 10) : 0;
}
