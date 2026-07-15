import { expectTypeOf, test } from "vitest";
import type { Asset, AssetType, MediaFormat } from "../src/index";

// Asset<K> resolves a conditional: the video/audio arm carries an optional transport `format`, while
// the image/document arm has no `format` key at all — so a `format` there is a compile error, not an
// ignored extra. Either arm preserves the literal `type` (Asset<"image">["type"] is "image", never
// AssetType). exactOptionalPropertyTypes is on, so the `?` modifiers below are exact — a bare
// optional, not `| undefined`. (Spec: 00 · The JSON-Schema boundary · typed asset shape.)

/** The flat shape the else arm (image/document) must resolve to — no `format` key. */
type ExpectedNoFormat<K extends AssetType> = { url: string; type: K; mimeType?: string };

/** The flat shape the video/audio arm must resolve to — `format` present and optional. */
type ExpectedWithFormat<K extends AssetType> = {
	url: string;
	type: K;
	format?: MediaFormat;
	mimeType?: string;
};

test("the image/document arm resolves to the no-`format` shape", () => {
	expectTypeOf<Asset<"image">>().toEqualTypeOf<ExpectedNoFormat<"image">>();
	expectTypeOf<Asset<"document">>().toEqualTypeOf<ExpectedNoFormat<"document">>();
});

test("the video/audio arm resolves to the with-`format` shape", () => {
	expectTypeOf<Asset<"video">>().toEqualTypeOf<ExpectedWithFormat<"video">>();
	expectTypeOf<Asset<"audio">>().toEqualTypeOf<ExpectedWithFormat<"audio">>();
});

test("the literal `type` survives — Asset<K> is not widened to AssetType", () => {
	expectTypeOf<Asset<"image">["type"]>().toEqualTypeOf<"image">();
	expectTypeOf<Asset<"video">["type"]>().toEqualTypeOf<"video">();
});

test("`format` is gated to the video/audio arm at the value level", () => {
	// A video asset MAY carry a transport `format`.
	const video: Asset<"video"> = { url: "https://x/v.m3u8", type: "video", format: "hls" };
	void video;

	// An image asset may NOT — `format` is absent from that arm, so it is an excess property.
	// @ts-expect-error — `format` is not a property of an image asset (gated to video/audio).
	const image: Asset<"image"> = { url: "https://x/p.jpg", type: "image", format: "hls" };
	void image;
});
