import panzoom, { type PanZoom } from "panzoom";

let lightboxEl: HTMLDivElement | null = null;
let panzoomInstance: PanZoom | null = null;

function buildLightbox(): HTMLDivElement {
	if (lightboxEl) return lightboxEl;

	const el = document.createElement("div");
	el.className = "mermaid-lightbox";
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-modal", "true");
	el.setAttribute("aria-label", "Diagram viewer");
	el.innerHTML = `
		<div class="mermaid-lightbox-backdrop" aria-hidden="true"></div>
		<div class="mermaid-lightbox-controls">
			<button type="button" class="mermaid-lightbox-btn" data-action="zoom-in" aria-label="Zoom in">+</button>
			<button type="button" class="mermaid-lightbox-btn" data-action="zoom-out" aria-label="Zoom out">&minus;</button>
			<button type="button" class="mermaid-lightbox-btn" data-action="reset" aria-label="Reset zoom">⟲</button>
			<button type="button" class="mermaid-lightbox-btn" data-action="close" aria-label="Close">✕</button>
		</div>
		<div class="mermaid-lightbox-hint">Drag to pan · scroll or pinch to zoom · Esc to close</div>
		<div class="mermaid-lightbox-stage"></div>
	`;
	document.body.appendChild(el);

	el.querySelector(".mermaid-lightbox-backdrop")?.addEventListener(
		"click",
		closeLightbox,
	);

	const controls = el.querySelector(".mermaid-lightbox-controls");
	controls?.addEventListener("click", (event) => {
		const target = (event.target as HTMLElement).closest(
			".mermaid-lightbox-btn",
		);
		if (!target) return;
		const action = target.getAttribute("data-action");
		if (action === "close") closeLightbox();
		if (action === "zoom-in")
			panzoomInstance?.smoothZoom(
				window.innerWidth / 2,
				window.innerHeight / 2,
				1.4,
			);
		if (action === "zoom-out")
			panzoomInstance?.smoothZoom(
				window.innerWidth / 2,
				window.innerHeight / 2,
				0.7,
			);
		if (action === "reset") {
			panzoomInstance?.moveTo(0, 0);
			panzoomInstance?.zoomAbs(0, 0, 1);
		}
	});

	document.addEventListener("keydown", (event) => {
		if (
			event.key === "Escape" &&
			lightboxEl?.classList.contains("is-open")
		) {
			closeLightbox();
		}
	});

	lightboxEl = el;
	return el;
}

function openLightbox(source: SVGElement): void {
	const el = buildLightbox();
	const stage = el.querySelector(
		".mermaid-lightbox-stage",
	) as HTMLDivElement | null;
	if (!stage) return;

	stage.innerHTML = "";
	const cloned = source.cloneNode(true) as SVGElement;

	// Strip the inline width/height so the SVG fills the stage and
	// panzoom can position it freely.
	cloned.removeAttribute("width");
	cloned.removeAttribute("height");
	cloned.setAttribute("preserveAspectRatio", "xMidYMid meet");
	cloned.style.width = "100%";
	cloned.style.height = "100%";

	stage.appendChild(cloned);
	el.classList.add("is-open");
	document.documentElement.classList.add("mermaid-lightbox-open");

	panzoomInstance = panzoom(cloned, {
		bounds: false,
		minZoom: 0.2,
		maxZoom: 10,
		smoothScroll: false,
		zoomDoubleClickSpeed: 1,
	});
}

function closeLightbox(): void {
	if (!lightboxEl) return;
	lightboxEl.classList.remove("is-open");
	document.documentElement.classList.remove("mermaid-lightbox-open");
	panzoomInstance?.dispose();
	panzoomInstance = null;
}

export function setupMermaidLightbox(): void {
	const containers = document.querySelectorAll<HTMLDivElement>(".mermaid");
	containers.forEach((container) => {
		if (container.dataset.zoomBound === "true") return;
		const svg = container.querySelector("svg");
		if (!svg) return;

		container.dataset.zoomBound = "true";
		container.classList.add("mermaid-zoomable");
		container.setAttribute("role", "button");
		container.setAttribute("tabindex", "0");
		container.setAttribute("aria-label", "Open diagram in zoom view");

		container.addEventListener("click", () => openLightbox(svg));
		container.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				openLightbox(svg);
			}
		});
	});
}
