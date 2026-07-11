import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
	defineConfig({
		title: "sitely",
		description: "Turn any URL into structured JSON",
		appearance: "dark",
		// VitePress's built-in dead-link check only catches missing-file links;
		// Lychee handles both missing files AND broken anchor fragments after
		// the build. Disabling the VitePress check so there's one source of
		// truth for link validation. See `pnpm check:links` + the lychee step
		// in .github/workflows/docs-build.yml.
		ignoreDeadLinks: true,
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
			// The site is a single build-ordered plan. Nav is one entry; the
			// sidebar is the ordered spec list. See docs/plan/index.md.
			nav: [{ text: "Plan", link: "/plan/" }],
			sidebar: {
				"/plan/": [
					{
						text: "Implementation plan",
						items: [
							{ text: "Overview", link: "/plan/" },
							{ text: "05 · URL codec (built first)", link: "/plan/05-url-codec" },
							{ text: "00 · Contracts", link: "/plan/00-contracts" },
							{ text: "01 · @sitely/page", link: "/plan/01-page" },
							{ text: "02 · @sitely/runtime", link: "/plan/02-runtime" },
							{ text: "03 · Framework — DSL", link: "/plan/03-framework-dsl" },
							{ text: "04 · Framework — test/CLI", link: "/plan/04-framework-test" },
						],
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
