import type { Context, Next } from "hono";
import { hashApiKey, findConsumerByApiKeyHash } from "../services/auth-service.js";

export interface AuthVariables {
	consumerId: string;
	apiKeyId: string;
}

/**
 * Auth middleware: validates Bearer token, sets consumerId and apiKeyId on context.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const token = authHeader.slice(7);
	const keyHash = hashApiKey(token);
	const result = findConsumerByApiKeyHash(keyHash);

	if (!result) {
		return c.json({ error: "Invalid API key" }, 401);
	}

	c.set("consumerId", result.consumerId);
	c.set("apiKeyId", result.apiKeyId);
	await next();
}
