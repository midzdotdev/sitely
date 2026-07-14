// The error taxonomy — the one runtime surface in @sitely/contracts. One coherent taxonomy with
// parity across the response / extraction / driver failure layers; every class carries a stable,
// enumerated `kind` so any layer can `switch (err.kind)`. (Spec: 00 · Error taxonomy.)

/** Categorized reasons a response is unusable. `validate → false` is sugar for `"wrong-page"`. */
export type RejectionReason =
	| "wrong-page"
	| "captcha"
	| "blocked"
	| "removed"
	| "login-wall"
	| "rate-limited";

/**
 * Root of the sitely error taxonomy. Abstract because it is never thrown directly — every concrete
 * error names its own enumerated `kind`. (`abstract readonly kind` both satisfies
 * `strictPropertyInitialization` and forces each subclass to declare a kind; the spec's naked
 * `readonly kind: string` cannot compile under strict init + `useDefineForClassFields`.)
 */
export abstract class FrameworkError extends Error {
	abstract readonly kind: string;
}

/**
 * Response layer — the page/response is wrong or blocking. `validate → false` folds in as
 * `new ResponseRejection("wrong-page")`; authors throw a categorized reason from `validate`/`extract`.
 */
export class ResponseRejection extends FrameworkError {
	override readonly kind = "response-rejection";
	readonly reason: RejectionReason;
	constructor(reason: RejectionReason) {
		super(`response rejected: ${reason}`);
		this.reason = reason;
	}
}

/**
 * Extraction layer — the DOM is good, extracting from it failed. Concrete base for the field-level
 * signals; thrown directly for an uncategorized extraction failure.
 */
export class ExtractionError extends FrameworkError {
	override readonly kind: "extraction" | "missing-data" | "malformed-data" = "extraction";
}

/** A required value was absent from an otherwise-good DOM. Maps to a field diagnostic `reason: "missing"`. */
export class MissingDataError extends ExtractionError {
	override readonly kind = "missing-data";
	readonly field: string;
	readonly detail: string;
	constructor(opts: { field: string; detail: string }) {
		super(`missing data: ${opts.field} — ${opts.detail}`);
		this.field = opts.field;
		this.detail = opts.detail;
	}
}

/** A value was present but the wrong shape. Maps to a field diagnostic `reason: "malformed"`. */
export class MalformedDataError extends ExtractionError {
	override readonly kind = "malformed-data";
	readonly field: string;
	readonly detail: string;
	constructor(opts: { field: string; detail: string }) {
		super(`malformed data: ${opts.field} — ${opts.detail}`);
		this.field = opts.field;
		this.detail = opts.detail;
	}
}

/**
 * Driver layer — a capability the backend does not have. Thrown by @sitely/page's static session when
 * any `PageController` method is called; the runner surfaces it as `{ kind: "error" }`.
 */
export class UnsupportedInteractionError extends FrameworkError {
	override readonly kind = "unsupported-interaction";
}
