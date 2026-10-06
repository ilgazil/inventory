import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.ts";
import { authMiddleware } from "../src/http/auth.ts";
import { TEST_PASSWORD, makeTestConfig, startApp } from "./helpers.ts";

// Pool factice : login et health ne touchent pas la base.
const dummyPool = {} as never;

const boot = async () => {
  const config = makeTestConfig();
  const running = await startApp(createApp(config, dummyPool));
  return { config, running };
};

test("GET /api/health est public", async (t) => {
  const { running } = await boot();
  t.after(running.close);
  const response = await fetch(`${running.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("POST /api/auth/login : succès → token JWT signé (90 jours)", async (t) => {
  const { config, running } = await boot();
  t.after(running.close);
  const response = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  assert.equal(response.status, 200);

  const data = (await response.json()) as { token: string; expiresAt: number };
  const payload = jwt.verify(data.token, config.jwtSecret);
  assert.ok(typeof payload !== "string");
  assert.equal(payload.sub, "owner");

  const expected = Date.now() + 90 * 24 * 3600 * 1000;
  assert.ok(Math.abs(data.expiresAt - expected) < 5000, "expiresAt ≈ maintenant + 90 jours");
});

test("POST /api/auth/login : mauvais mot de passe → 401", async (t) => {
  const { running } = await boot();
  t.after(running.close);
  const response = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "mauvais-mot-de-passe" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Mot de passe incorrect." });
});

test("POST /api/auth/login : corps invalide → 400", async (t) => {
  const { running } = await boot();
  t.after(running.close);
  const response = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: 42 }),
  });
  assert.equal(response.status, 400);
});

test("Les routes protégées répondent 401 sans token", async (t) => {
  const { running } = await boot();
  t.after(running.close);
  for (const path of ["/api/sync/head", "/api/sync/pull", "/api/lookup/3017620422003"]) {
    const response = await fetch(`${running.baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} doit exiger un token`);
    const data = (await response.json()) as { error: string };
    assert.ok(data.error.length > 0);
  }
});

test("authMiddleware : payload string rejeté", () => {
  let statusSent = 0;
  const fakeResponse = {
    status(value: number) {
      statusSent = value;
      return this;
    },
    json() {
      return this;
    },
  };
  const req = {
    headers: { authorization: `Bearer ${jwt.sign("chaîne", "autre-secret")}` },
  };
  let nextCalled = false;
  authMiddleware("test-secret")(
    req as never,
    fakeResponse as never,
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, false);
  assert.equal(statusSent, 401);
});
