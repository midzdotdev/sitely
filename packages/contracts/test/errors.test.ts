import { describe, expect, it } from "vitest";
import {
	ExtractionError,
	FrameworkError,
	MalformedDataError,
	MissingDataError,
	ResponseRejection,
	UnsupportedInteractionError,
} from "../src/index";

/**
 * Spec 00 · Error taxonomy — every concrete class carries a stable, enumerated `kind`; the
 * response / extraction / driver layers form real `instanceof` chains; any layer can dispatch with
 * `switch (err.kind)`; and the abstract `FrameworkError` root is never constructed directly.
 */

/** Base-typed dispatcher — proves a `switch (err.kind)` over the taxonomy root routes each kind. */
function label(err: FrameworkError): string {
	switch (err.kind) {
		case "response-rejection":
			return "response";
		case "extraction":
			return "extraction";
		case "missing-data":
			return "missing";
		case "malformed-data":
			return "malformed";
		case "unsupported-interaction":
			return "unsupported";
		default:
			return "other";
	}
}

describe("enumerated kind", () => {
	it("ResponseRejection carries `response-rejection` and echoes its reason", () => {
		const err = new ResponseRejection("captcha");
		expect(err.kind).toBe("response-rejection");
		expect(err.reason).toBe("captcha");
		expect(new ResponseRejection("login-wall").reason).toBe("login-wall");

		// @ts-expect-error — "nope" is not a RejectionReason.
		new ResponseRejection("nope");
	});

	it("ExtractionError carries `extraction` when thrown directly", () => {
		expect(new ExtractionError().kind).toBe("extraction");
	});

	it("MissingDataError carries `missing-data` and echoes its field and detail", () => {
		const err = new MissingDataError({ field: "title", detail: "no <h1> in the DOM" });
		expect(err.kind).toBe("missing-data");
		expect(err.field).toBe("title");
		expect(err.detail).toBe("no <h1> in the DOM");
	});

	it("MalformedDataError carries `malformed-data` and echoes its field and detail", () => {
		const err = new MalformedDataError({ field: "price", detail: "parsed to NaN" });
		expect(err.kind).toBe("malformed-data");
		expect(err.field).toBe("price");
		expect(err.detail).toBe("parsed to NaN");
	});

	it("UnsupportedInteractionError carries `unsupported-interaction`", () => {
		expect(new UnsupportedInteractionError().kind).toBe("unsupported-interaction");
	});
});

describe("instanceof chains", () => {
	it("MissingDataError is an ExtractionError, a FrameworkError, and an Error", () => {
		const err = new MissingDataError({ field: "title", detail: "absent" });
		expect(err).toBeInstanceOf(MissingDataError);
		expect(err).toBeInstanceOf(ExtractionError);
		expect(err).toBeInstanceOf(FrameworkError);
		expect(err).toBeInstanceOf(Error);
	});

	it("MalformedDataError is an ExtractionError", () => {
		const err = new MalformedDataError({ field: "price", detail: "NaN" });
		expect(err).toBeInstanceOf(ExtractionError);
		expect(err).toBeInstanceOf(FrameworkError);
	});

	it("ResponseRejection is a sibling layer, not an ExtractionError", () => {
		const err = new ResponseRejection("blocked");
		expect(err).toBeInstanceOf(FrameworkError);
		expect(err).not.toBeInstanceOf(ExtractionError);
	});
});

describe("kind dispatch", () => {
	it("routes each instance through `switch (err.kind)`", () => {
		expect(label(new ResponseRejection("rate-limited"))).toBe("response");
		expect(label(new ExtractionError())).toBe("extraction");
		expect(label(new MissingDataError({ field: "a", detail: "b" }))).toBe("missing");
		expect(label(new MalformedDataError({ field: "a", detail: "b" }))).toBe("malformed");
		expect(label(new UnsupportedInteractionError())).toBe("unsupported");
	});
});

describe("FrameworkError is abstract", () => {
	it("cannot be constructed directly", () => {
		// @ts-expect-error — FrameworkError is abstract; cannot instantiate an abstract class.
		const orphan = new FrameworkError();
		expect(orphan).toBeInstanceOf(Error);
	});
});
