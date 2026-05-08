import stableStringify from "fast-json-stable-stringify";

/**
 * Serialize a manifest (or any JSON value) to a stable, byte-identical form.
 *
 * Object keys are sorted lexicographically at every depth; output is
 * pretty-printed with tab indentation to match the rest of the repo's
 * JSON style (turbo.json, package.json, etc.).
 *
 * Determinism contract: this function must produce identical bytes for
 * identical input — no Date.now(), no process.env, no Math.random.
 * `fast-json-stable-stringify` guarantees key order; we then re-pretty-print
 * to get the indentation back.
 */
export function stableSerialize(value: unknown): string {
	const sorted = JSON.parse(stableStringify(value));
	return `${JSON.stringify(sorted, null, "\t")}\n`;
}
