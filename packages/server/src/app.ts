import { Hono } from "hono";
import { cors } from "hono/cors";
import { Schema } from "@wapi/schemas";
import { authMiddleware } from "./middleware/auth.js";
import { createConsumer, getBalance } from "./services/auth-service.js";
import {
	extractFromUrl,
	listSites,
	findSite,
} from "./services/extract-service.js";

type Variables = {
	consumerId: string;
	apiKeyId: string;
};

const app = new Hono<{ Variables: Variables }>();

// Global middleware
app.use("*", cors());

// ── Health ──────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ── Auth ────────────────────────────────────────────────────────────

app.post("/v1/auth/signup", async (c) => {
	const body = await c.req.json<{ email?: string; name?: string }>();
	if (!body.email) {
		return c.json({ error: "email is required" }, 400);
	}
	try {
		const result = createConsumer(body.email, body.name);
		return c.json(
			{
				consumerId: result.consumerId,
				apiKey: result.apiKey,
				apiKeyId: result.apiKeyId,
				message: "Store your API key securely — it will not be shown again.",
			},
			201,
		);
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "Failed to create account" },
			500,
		);
	}
});

app.get("/v1/auth/balance", authMiddleware, (c) => {
	const consumerId = c.get("consumerId");
	const balance = getBalance(consumerId);
	return c.json({ tokenBalance: balance });
});

// ── Discovery (free, no auth required) ──────────────────────────────

app.get("/v1/sites", (c) => {
	const sites = listSites().map((s) => ({
		name: s.name,
		domain: s.domain,
		resources: Object.entries(s.resources).map(([name, r]) => ({
			name,
			schema: r.schema,
			params: r.params,
			ttl: r.ttl,
		})),
	}));
	return c.json({ sites });
});

app.get("/v1/sites/:domain", (c) => {
	const domain = c.req.param("domain");
	const site = findSite(domain);
	if (!site) {
		return c.json({ error: `No site definition for ${domain}` }, 404);
	}
	return c.json({
		name: site.name,
		domain: site.domain,
		aliases: site.aliases,
		resources: Object.entries(site.resources).map(([name, r]) => ({
			name,
			schema: r.schema,
			params: r.params,
			ttl: r.ttl,
		})),
		pages: Object.entries(site.pages).map(([pattern, p]) => ({
			pattern,
			provides: p.provides,
			examples: p.examples,
			hasPagination: !!p.paginate,
		})),
	});
});

app.get("/v1/schemas", (c) => {
	const schemas = Object.entries(Schema).map(([name, type]) => ({ name, type }));
	return c.json({ schemas });
});

app.get("/v1/schemas/:type/sites", (c) => {
	const schemaType = c.req.param("type");
	const matchingSites = listSites()
		.filter((s) =>
			Object.values(s.resources).some((r) => r.schema === schemaType),
		)
		.map((s) => ({ name: s.name, domain: s.domain }));
	return c.json({ schemaType, sites: matchingSites });
});

// ── Extract (requires auth) ─────────────────────────────────────────

app.get("/v1/extract", authMiddleware, async (c) => {
	const url = c.req.query("url");
	if (!url) {
		return c.json({ error: "url query parameter is required" }, 400);
	}

	const consumerId = c.get("consumerId");
	const result = await extractFromUrl(url, consumerId);
	const statusCode = result.status === "error" ? 500 : result.status === "blocked" ? 503 : 200;
	return c.json(result, statusCode);
});

// ── Resource Access ─────────────────────────────────────────────────

app.get("/v1/sites/:domain/:resource", authMiddleware, async (c) => {
	const domain = c.req.param("domain");
	const resourceName = c.req.param("resource");
	const site = findSite(domain);

	if (!site) {
		return c.json({ error: `No site definition for ${domain}` }, 404);
	}

	const resource = site.resources[resourceName];
	if (!resource) {
		return c.json({ error: `No resource "${resourceName}" on ${domain}` }, 404);
	}

	// Build params from query string
	const params: Record<string, string> = {};
	for (const [key, def] of Object.entries(resource.params)) {
		const value = c.req.query(key);
		if (def.required && !value) {
			return c.json({ error: `Missing required parameter: ${key}` }, 400);
		}
		if (value) params[key] = value;
	}

	// Resolve URL
	const path = resource.resolve(params);
	const fullUrl = `https://${site.domain}${path}`;
	const consumerId = c.get("consumerId");
	const result = await extractFromUrl(fullUrl, consumerId);
	const statusCode = result.status === "error" ? 500 : result.status === "blocked" ? 503 : 200;
	return c.json(result, statusCode);
});

export { app };
