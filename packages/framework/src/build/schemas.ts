import { toJSONSchema, type ZodType } from "zod";
import type { StandardSchemaV1 } from "../standard-schema.js";

/**
 * Convert a Standard Schema validator to a JSON Schema document.
 *
 * v0 only supports Zod (the default validator per atlas §1) using its
 * native Zod 4 `z.toJSONSchema()`. Valibot and ArkType adapters are TODO
 * — when added, dispatch on `~standard.vendor`.
 *
 * Determinism is provided by Zod 4's stable output (sorted properties,
 * deterministic `required` array, etc.) plus our downstream
 * {@link stableSerialize} pass.
 */
export function emitJsonSchema(schema: StandardSchemaV1, _name: string): Record<string, unknown> {
	const vendor = schema["~standard"].vendor;

	if (vendor === "zod") {
		return toJSONSchema(schema as unknown as ZodType) as Record<string, unknown>;
	}

	throw new Error(
		`Schema "${_name}" uses Standard Schema vendor "${vendor}" which has no JSON Schema adapter yet. v0 only supports Zod; file a follow-up to add ${vendor}-to-json-schema.`,
	);
}
