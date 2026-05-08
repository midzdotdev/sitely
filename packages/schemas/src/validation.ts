import type { StandardSchemaV1 } from "./standard-schema.js";

export interface ValidationResult {
	success: boolean;
	data?: unknown;
	errors?: string[];
}

/**
 * Validate extracted data against a Standard Schema validator.
 *
 * Accepts any Standard Schema-v1-compliant validator (Zod, Valibot, ArkType, ...).
 *
 * Lenient behaviour: if the data is an array, each element is validated
 * individually against the schema. This accommodates sites that return a
 * flat array of items rather than wrapping them in a container object
 * (e.g. an array of stories instead of an ItemList wrapper).
 */
export function validateExtraction(
	schema: StandardSchemaV1,
	data: unknown,
): ValidationResult {
	if (Array.isArray(data)) {
		const validatedItems: unknown[] = [];
		const errors: string[] = [];

		for (let i = 0; i < data.length; i++) {
			const result = schema["~standard"].validate(data[i]);
			// Standard Schema validate may be sync or async; we only support sync here.
			// If a vendor returns a Promise we reject it explicitly.
			if (result instanceof Promise) {
				errors.push(`[${i}]: validator returned a Promise (async validation not supported)`);
				continue;
			}
			if (result.issues) {
				for (const issue of result.issues) {
					const path = formatIssuePath(issue.path);
					errors.push(`[${i}]${path}: ${issue.message}`);
				}
			} else {
				validatedItems.push(result.value);
			}
		}

		if (errors.length > 0) return { success: false, errors };
		return { success: true, data: validatedItems };
	}

	const result = schema["~standard"].validate(data);
	if (result instanceof Promise) {
		return {
			success: false,
			errors: ["validator returned a Promise (async validation not supported)"],
		};
	}
	if (result.issues) {
		return {
			success: false,
			errors: result.issues.map((issue) => `${formatIssuePath(issue.path) || "(root)"}: ${issue.message}`),
		};
	}
	return { success: true, data: result.value };
}

function formatIssuePath(
	path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
	if (!path || path.length === 0) return "";
	return `.${path
		.map((seg) => (typeof seg === "object" ? String(seg.key) : String(seg)))
		.join(".")}`;
}
