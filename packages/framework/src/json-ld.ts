/**
 * Parse all JSON-LD blocks from raw HTML.
 * Returns an array of parsed objects.
 */
export function parseJsonLd(html: string): Record<string, unknown>[] {
	const results: Record<string, unknown>[] = [];
	const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(html)) !== null) {
		const content = match[1];
		if (!content) continue;
		try {
			const parsed: unknown = JSON.parse(content);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (item && typeof item === "object") {
						results.push(item as Record<string, unknown>);
					}
				}
			} else if (parsed && typeof parsed === "object") {
				// Handle @graph
				const obj = parsed as Record<string, unknown>;
				if (Array.isArray(obj["@graph"])) {
					for (const item of obj["@graph"] as unknown[]) {
						if (item && typeof item === "object") {
							results.push(item as Record<string, unknown>);
						}
					}
				} else {
					results.push(obj);
				}
			}
		} catch {
			// Silently skip malformed JSON-LD
		}
	}

	return results;
}

/**
 * Extract <link rel="canonical"> href from raw HTML.
 */
export function getCanonicalFromHtml(html: string): string | null {
	const match = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i.exec(html);
	if (match?.[1]) return match[1];
	// Also try reversed attribute order
	const match2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i.exec(html);
	return match2?.[1] ?? null;
}
