// @sitely/contracts — the shared type surface every v0 component imports (spec: docs/plan/00-contracts.md).
// Types only, plus the error taxonomy (the one runtime export). This spec DECLARES every
// cross-boundary interface; the other packages implement them. `URLCodec` belongs to the standalone
// codec root and is re-exported here — the package graph is a strict DAG
// (url-codec ← contracts ← page ← runtime ← framework) with contracts as the sitely root.

export type { Resource, FieldFns, Binding } from "./resources";
export type { PageElement, PageDriver, PageController } from "./read-surface";
export type { ExtractContext } from "./context";
export type { PageDef, FixtureSpec } from "./pages";
export type { SiteDefinition } from "./site";
export type {
	JsonSchema,
	AssetType,
	MediaFormat,
	Asset,
	Interface,
	SchemaIssue,
	ValidationIssue,
	ValidateExtraction,
} from "./schema";
export type { RunnerResult, FieldDiagnostic } from "./runner";
export type { RejectionReason } from "./errors";

// The error taxonomy is runtime (classes carrying an enumerated `kind`) — a value export.
export {
	FrameworkError,
	ResponseRejection,
	ExtractionError,
	MissingDataError,
	MalformedDataError,
	UnsupportedInteractionError,
} from "./errors";

// Re-export the standalone codec's type (spec: 00 · URL codec). The `urlCodec` factory stays in
// @sitely/url-codec; the DSL (03) imports it directly.
export type { URLCodec } from "@sitely/url-codec";
