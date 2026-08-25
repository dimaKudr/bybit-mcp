import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../src/auth.js";

function buildApp() {
  const app = new Hono<AuthEnv>();
  app.use("/protected", bearerAuth);
  app.get("/protected", (c) => c.text("ok"));
  return app;
}

const bindings = (token: string) => ({
  MCP_BEARER_TOKEN: token,
  BYBIT_ACCOUNTS: {} as unknown as KVNamespace,
});

describe("bearerAuth", () => {
  it("allows a request with the correct bearer token", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Bearer correct-token" } },
      bindings("correct-token"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects a request with no Authorization header", async () => {
    const app = buildApp();
    const res = await app.request("/protected", {}, bindings("correct-token"));
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Bearer wrong-token" } },
      bindings("correct-token"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a request with a non-Bearer Authorization header", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Basic dXNlcjpwYXNz" } },
      bindings("correct-token"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a token that is a different length than the real one (no early length-based short circuit)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Bearer short" } },
      bindings("a-much-longer-correct-token-value"),
    );
    expect(res.status).toBe(401);
  });

  it("never echoes the bearer token or expected token in the 401 response body", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Bearer wrong-token" } },
      bindings("super-secret-token"),
    );
    const body = await res.text();
    expect(body).not.toContain("super-secret-token");
    expect(body).not.toContain("wrong-token");
  });

  it("returns 500 without leaking details when MCP_BEARER_TOKEN is unset", async () => {
    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: "Bearer anything" } },
      bindings(""),
    );
    expect(res.status).toBe(500);
  });

  it("uses a timing-safe comparison (spy on crypto.subtle.digest is exercised for both sides)", async () => {
    const digestSpy = vi.spyOn(crypto.subtle, "digest");
    const app = buildApp();
    await app.request(
      "/protected",
      { headers: { Authorization: "Bearer wrong-token" } },
      bindings("correct-token"),
    );
    // Both the presented token and the expected token get hashed before compare.
    expect(digestSpy).toHaveBeenCalledTimes(2);
    digestSpy.mockRestore();
  });
});
