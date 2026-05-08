import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../middleware/auth.js";
import type { MockDbData } from "./helpers.js";
import { createTestApiKey, createTestApp } from "./helpers.js";

// Mock modules that are not relevant to auth tests
vi.mock("../http-client.js", () => ({
	fetchPage: vi.fn(),
}));

vi.mock("../services/robots-service.js", () => ({
	isAllowedByRobots: vi.fn().mockResolvedValue(true),
}));

describe("Auth middleware", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;

	beforeEach(() => {
		vi.clearAllMocks();
		const testApp = createTestApp();
		app = testApp.app;
		data = testApp.data;
	});

	it("rejects requests without Authorization header", async () => {
		const res = await app.request("/v1/sites");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toContain("Authorization");
	});

	it("rejects requests with non-Bearer auth scheme", async () => {
		const res = await app.request("/v1/sites", {
			headers: { Authorization: "Basic dXNlcjpwYXNz" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toContain("Bearer");
	});

	it("rejects keys without the sitely_sk_ prefix", async () => {
		const res = await app.request("/v1/sites", {
			headers: { Authorization: "Bearer invalid_prefix_key" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toContain("sitely_sk_");
	});

	it("rejects keys that are not in the database", async () => {
		const res = await app.request("/v1/sites", {
			headers: { Authorization: "Bearer sitely_sk_nonexistent000000000000000000000000" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toBe("Invalid API key");
	});

	it("accepts a valid API key and allows the request through", async () => {
		const { plainKey } = createTestApiKey(data);
		const res = await app.request("/v1/sites", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
	});

	describe("dev API key (SITELY_DEV_API_KEY)", () => {
		const DEV_KEY = "my-dev-key-for-testing";

		beforeEach(() => {
			vi.stubEnv("SITELY_DEV_API_KEY", DEV_KEY);
		});

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("authenticates with the dev key, bypassing DB", async () => {
			// Fresh app so the middleware reads the env var at init time
			const { app: devApp } = createTestApp();

			const res = await devApp.request("/v1/sites", {
				headers: { Authorization: `Bearer ${DEV_KEY}` },
			});
			expect(res.status).toBe(200);
		});

		it("does not require the sitely_sk_ prefix for dev keys", async () => {
			const { app: devApp } = createTestApp();

			const res = await devApp.request("/v1/sites", {
				headers: { Authorization: `Bearer ${DEV_KEY}` },
			});
			expect(res.status).toBe(200);
		});

		it("still rejects invalid keys when dev key is set", async () => {
			const { app: devApp } = createTestApp();

			const res = await devApp.request("/v1/sites", {
				headers: { Authorization: "Bearer wrong-key" },
			});
			expect(res.status).toBe(401);
		});
	});

	it("rejects a revoked API key", async () => {
		const { plainKey } = createTestApiKey(data, {
			revokedAt: new Date("2024-01-01"),
		});
		const res = await app.request("/v1/sites", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toContain("revoked");
	});
});

describe("API key management", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;

	beforeEach(() => {
		vi.clearAllMocks();
		const testApp = createTestApp();
		app = testApp.app;
		data = testApp.data;
	});

	it("creates a new API key via POST /v1/auth/keys", async () => {
		const { plainKey, consumerId } = createTestApiKey(data);

		const res = await app.request("/v1/auth/keys", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${plainKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ label: "My New Key" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.apiKey).toBeDefined();
		expect(body.apiKey).toMatch(/^sitely_sk_/);
		expect(body.keyId).toBeDefined();

		// Verify the new key was stored
		const newKeyHash = hashApiKey(body.apiKey);
		const stored = data.apiKeys.find((k) => k.keyHash === newKeyHash);
		expect(stored).toBeDefined();
		expect(stored!.consumerId).toBe(consumerId);
	});

	it("creates a key without a label", async () => {
		const { plainKey } = createTestApiKey(data);

		const res = await app.request("/v1/auth/keys", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${plainKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.apiKey).toMatch(/^sitely_sk_/);
	});

	it("revokes an API key via DELETE /v1/auth/keys/:id", async () => {
		const { plainKey } = createTestApiKey(data);

		// Create a second key to revoke
		const createRes = await app.request("/v1/auth/keys", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${plainKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ label: "To Revoke" }),
		});
		const { keyId, apiKey: newKey } = await createRes.json();

		// Revoke the key
		const revokeRes = await app.request(`/v1/auth/keys/${keyId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(revokeRes.status).toBe(200);
		const revokeBody = await revokeRes.json();
		expect(revokeBody.revoked).toBe(true);

		// Verify the revoked key can no longer be used
		const testRes = await app.request("/v1/sites", {
			headers: { Authorization: `Bearer ${newKey}` },
		});
		expect(testRes.status).toBe(401);
		const testBody = await testRes.json();
		expect(testBody.error.message).toContain("revoked");
	});

	it("returns 404 when revoking a non-existent key", async () => {
		const { plainKey } = createTestApiKey(data);

		const res = await app.request("/v1/auth/keys/00000000-0000-0000-0000-000000000000", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("not_found");
	});
});

describe("Balance endpoint", () => {
	let app: ReturnType<typeof createTestApp>["app"];
	let data: MockDbData;

	beforeEach(() => {
		vi.clearAllMocks();
		const testApp = createTestApp();
		app = testApp.app;
		data = testApp.data;
	});

	it("returns the consumer token balance", async () => {
		const { plainKey } = createTestApiKey(data, { tokenBalance: 5_000 });

		const res = await app.request("/v1/auth/balance", {
			headers: { Authorization: `Bearer ${plainKey}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.tokenBalance).toBe(5_000);
	});
});

describe("hashApiKey", () => {
	it("produces consistent hashes for the same input", () => {
		const key = "sitely_sk_testkey123";
		const hash1 = hashApiKey(key);
		const hash2 = hashApiKey(key);
		expect(hash1).toBe(hash2);
	});

	it("produces different hashes for different inputs", () => {
		const hash1 = hashApiKey("sitely_sk_key1");
		const hash2 = hashApiKey("sitely_sk_key2");
		expect(hash1).not.toBe(hash2);
	});

	it("produces a hex string", () => {
		const hash = hashApiKey("sitely_sk_test");
		expect(hash).toMatch(/^[a-f0-9]+$/);
	});
});
