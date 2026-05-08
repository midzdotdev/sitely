import type { CapabilityConfig, SiteDefinition } from "../types.js";
import type { ManifestCapabilities } from "./manifest-types.js";

/**
 * Default capabilities per atlas spec §8.
 *
 * Applied when the site def's `capabilities` field is missing or partial.
 * Community packages may not declare wider capabilities than these without
 * manual sign-off (deferred trust pass).
 */
export const DEFAULT_CAPABILITIES: ManifestCapabilities = {
	network: { egress: "site-only" },
	filesystem: "none",
	process: "none",
	timers: { maxWallMs: 30_000 },
	memory: { maxMb: 256 },
};

/**
 * Resolve a site's capability declarations against the §8 defaults.
 *
 * Returns a fully-populated `ManifestCapabilities` record. Use this anywhere
 * the harness, runner, or manifest emitter needs concrete capability values
 * — never operate on the raw optional `site.capabilities` field directly.
 *
 * Per argus review note 5 on #0c0f10a0: the harness needs this guarantee so
 * it never operates on undefined capability fields when the worker_threads
 * sandbox enforces them.
 */
export function resolveCapabilities(site: SiteDefinition): ManifestCapabilities {
	return mergeCapabilities(site.capabilities);
}

export function mergeCapabilities(declared?: CapabilityConfig): ManifestCapabilities {
	if (!declared) return { ...DEFAULT_CAPABILITIES };
	return {
		network: declared.network ?? { ...DEFAULT_CAPABILITIES.network },
		filesystem: declared.filesystem ?? DEFAULT_CAPABILITIES.filesystem,
		process: declared.process ?? DEFAULT_CAPABILITIES.process,
		timers: declared.timers ?? { ...DEFAULT_CAPABILITIES.timers },
		memory: declared.memory ?? { ...DEFAULT_CAPABILITIES.memory },
	};
}
