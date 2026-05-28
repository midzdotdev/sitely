import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
	defineConfig({
		title: "sitely",
		description: "Turn any URL into structured JSON",
		appearance: "dark",
		head: [
			// Tell the Dark Reader extension to leave the site alone — VitePress
			// already serves a dark theme; Dark Reader's auto-invert garbles it.
			["meta", { name: "darkreader-lock" }],
		],
		vite: {
			server: {
				host: "127.0.0.1",
			},
		},
		themeConfig: {
			nav: [
				{ text: "Guide", link: "/guide/using-the-client" },
				{ text: "Overview", link: "/overview/" },
				{ text: "Architecture", link: "/architecture/" },
				{ text: "Future", link: "/future/" },
			],
			sidebar: {
				"/guide/": [
					{
						text: "For consumers",
						items: [
							{ text: "Using the TypeScript client", link: "/guide/using-the-client" },
							{ text: "Consuming the HTTP API", link: "/guide/consuming-the-api" },
							{ text: "Self-hosting the server", link: "/guide/self-hosting" },
						],
					},
					{
						text: "For site authors",
						items: [
							{ text: "Writing a site package", link: "/guide/writing-a-site" },
							{ text: "The test suite", link: "/guide/testing" },
							{ text: "Publishing", link: "/guide/publishing" },
						],
					},
				],
				"/overview/": [
					{
						text: "Overview",
						items: [
							{ text: "What is sitely?", link: "/overview/" },
							{ text: "Glossary", link: "/overview/glossary" },
						],
					},
				],
				"/architecture/": [
					{
						text: "System",
						items: [
							{ text: "Overview", link: "/architecture/" },
							{ text: "Data flow", link: "/architecture/data-flow" },
							{ text: "The manifest", link: "/architecture/manifest" },
						],
					},
					{
						text: "Packages",
						items: [
							{ text: "@sitely/page", link: "/architecture/page" },
							{ text: "@sitely/schemas", link: "/architecture/schemas" },
							{ text: "@sitely/framework", link: "/architecture/framework" },
							{ text: " — build subsystem", link: "/architecture/framework-build" },
							{ text: " — test-pkg subsystem", link: "/architecture/framework-test-pkg" },
							{ text: "@sitely/server", link: "/architecture/server" },
							{ text: "Site packages", link: "/architecture/sites" },
						],
					},
				],
				"/future/": [
					{
						text: "Future",
						items: [{ text: "Future direction", link: "/future/" }],
					},
				],
			},
			socialLinks: [{ icon: "github", link: "https://github.com/midzdotdev/sitely" }],
			search: {
				provider: "local",
			},
		},
		mermaid: {
			theme: "dark",
		},
	}),
);
