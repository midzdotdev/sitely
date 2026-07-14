/**
 * The single error type the codec raises. `fromUrl` never throws (a non-match is
 * `null`); construction and `toUrl` throw with a `kind` that names the failure.
 */
export type URLCodecErrorKind =
	| "invalid-pattern"
	| "alias-params-mismatch"
	| "missing-param"
	| "empty-param";

export class URLCodecError extends Error {
	readonly kind: URLCodecErrorKind;

	constructor(kind: URLCodecErrorKind, message: string) {
		super(message);
		this.name = "URLCodecError";
		this.kind = kind;
		// Restore the prototype chain for instanceof across the ES target downlevel.
		Object.setPrototypeOf(this, URLCodecError.prototype);
	}
}
