import { defineConfig } from "vitepress";
import typedocSidebar from "../api/typedoc-sidebar.json";

export default defineConfig({
	title: "WAPI",
	description: "Turn websites into structured JSON APIs",
	appearance: "dark",
	vite: {
		server: {
			host: "127.0.0.1",
		},
	},
	themeConfig: {
		nav: [
			{ text: "Guide", link: "/guide/" },
			{ text: "Sites", link: "/sites/" },
			{ text: "Playground", link: "/playground" },
			{ text: "API Reference", link: "/api/" },
		],
		sidebar: {
			"/guide/": [
				{
					text: "Guide",
					items: [
						{ text: "What is WAPI?", link: "/guide/" },
						{ text: "Getting Started", link: "/guide/getting-started" },
						{ text: "Writing Site Definitions", link: "/guide/writing-site-definitions" },
						{ text: "Testing with Fixtures", link: "/guide/testing" },
					],
				},
			],
			"/sites/": [
				{
					text: "Sites",
					items: [{ text: "Site Catalog", link: "/sites/" }],
				},
			],
			"/api/": typedocSidebar,
		},
		socialLinks: [{ icon: "github", link: "https://github.com/nicholasgriffintn/wapi" }],
		search: {
			provider: "local",
		},
	},
});
