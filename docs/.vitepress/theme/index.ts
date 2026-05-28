import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";

import "./mermaid-lightbox.css";

let setup: () => void = () => {};

if (typeof window !== "undefined") {
	import("./mermaid-lightbox").then((mod) => {
		setup = mod.setupMermaidLightbox;
		// Initial mount: wait two frames so the mermaid plugin has rendered.
		requestAnimationFrame(() => requestAnimationFrame(setup));
	});
}

const theme: Theme = {
	extends: DefaultTheme,
	enhanceApp({ router }) {
		if (typeof window === "undefined") return;
		router.onAfterRouteChange = () => {
			requestAnimationFrame(() => requestAnimationFrame(setup));
		};
	},
};

export default theme;
