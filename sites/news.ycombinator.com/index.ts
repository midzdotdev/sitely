import { defineSite, Schema } from "@wapi/framework";

export default defineSite({
	name: "Hacker News",
	domain: "news.ycombinator.com",

	normalizeUrl: (url) => {
		const u = new URL(url);
		const id = u.searchParams.get("id");
		const p = u.searchParams.get("p");
		u.search = "";
		if (id) u.searchParams.set("id", id);
		if (p) u.searchParams.set("p", p);
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
				id: { type: "string", required: true, description: "HN story ID" },
			},
			resolve: ({ id }) => `/item?id=${id}`,
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
			examples: ["https://news.ycombinator.com/news"],

			validate: (ctx) => {
				return ctx.$(".itemlist")?.exists() === true && ctx.status === 200;
			},

			paginate: {
				next: (ctx) => {
					const more = ctx.$("a.morelink")?.attr("href");
					return more ? `https://news.ycombinator.com/${more}` : null;
				},
			},

			extract: async (ctx) => ({
				frontPage: ctx.$$(".athing").map((el) => ({
					id: el.attr("id"),
					title: el.$(".titleline > a")?.text() ?? "",
					url: el.$(".titleline > a")?.attr("href") ?? "",
					score: Number.parseInt(el.next()?.$(".score")?.text() ?? "0", 10),
				})),
			}),
		},

		"/item": {
			provides: ["story"],
			examples: ["https://news.ycombinator.com/item?id=1"],

			validate: (ctx) => {
				return ctx.$(".fatitem")?.exists() === true && ctx.status === 200;
			},

			extract: async (ctx) => ({
				story: {
					id: ctx.params["id"],
					title: ctx.$(".titleline > a")?.text() ?? "",
					url: ctx.$(".titleline > a")?.attr("href") ?? "",
					author: ctx.$(".hnuser")?.text() ?? "",
					score: Number.parseInt(ctx.$(".score")?.text() ?? "0", 10),
					comments: ctx.$$(".comtr").map((el) => ({
						id: el.attr("id"),
						author: el.$(".hnuser")?.text() ?? "",
						text: el.$(".commtext")?.text() ?? "",
					})),
				},
			}),
		},
	},

	crawl: {
		enabled: true,
		respectRobotsTxt: true,
		maxDepth: 1,
	},
});
