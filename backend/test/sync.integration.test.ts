import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "mysql2/promise";
import { createApp } from "../src/app.ts";
import { createPool } from "../src/db/pool.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { TEST_PASSWORD, makeTestConfig, startApp } from "./helpers.ts";

// Tests d'intégration : nécessitent TEST_DATABASE_URL (MariaDB de test, ex. via docker).
// Sans cette variable, les tests sont silencieusement ignorés.
const testDbUrl = process.env.TEST_DATABASE_URL;

const DEVICE = "a1b2c3d4-e5f6-4c2e-9f3d-7a1b2c3d4e5f";
const HLC = "001728211200000:000003:a1b2c3d4-e5f6-4c2e-9f3d-7a1b2c3d4e5f";

const op = (uuid: string, type: string, entityId: string, payload: unknown) => ({
  uuid,
  deviceId: DEVICE,
  hlc: HLC,
  type,
  entityId,
  payload,
});

test(
  "sync : push idempotent, pull par curseur, head",
  { skip: testDbUrl === undefined ? "TEST_DATABASE_URL non défini" : false },
  async (t) => {
    const config = makeTestConfig();
    const applied = await runMigrations(config.database);
    assert.ok(Array.isArray(applied));

    const pool = createPool(config);
    t.after(async () => {
      // Nettoyage résilient : TRUNCATE remet aussi l'AUTO_INCREMENT à zéro
      // (important : les INSERT IGNORE des runs précédents brûlent des valeurs de seq,
      // et l'AUTO_INCREMENT persiste dans MariaDB 10.6 — DELETE ne le remet pas à zéro).
      try {
        await pool.query("TRUNCATE TABLE ops");
        await pool.query("TRUNCATE TABLE barcode_cache");
      } catch {
        // tables absentes (échec de migration) : rien à nettoyer
      }
      await pool.end();
    });

    // Idem au démarrage : le test doit être indépendant des runs précédents (même tués).
    await pool.query("TRUNCATE TABLE ops");

    const app = createApp(config, pool as unknown as Pool);
    const running = await startApp(app);
    t.after(running.close);
    const baseUrl = running.baseUrl;

    // Login → token.
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    assert.equal(loginResponse.status, 200);
    const { token } = (await loginResponse.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // head initial.
    const headBefore = (await (await fetch(`${baseUrl}/api/sync/head`, { headers })).json()) as {
      cursor: number;
    };

    // push de 3 ops.
    const ops = [
      op("10000000-0000-4000-8000-000000000001", "item.create", "20000000-0000-4000-8000-000000000001", {
        name: "Lessic Pur",
        barcode: "3017620422003",
      }),
      op("10000000-0000-4000-8000-000000000002", "item.adjust", "20000000-0000-4000-8000-000000000001", {
        delta: 2,
      }),
      op("10000000-0000-4000-8000-000000000003", "item.set", "20000000-0000-4000-8000-000000000001", {
        field: "location",
        value: "Cave",
      }),
    ];
    const pushResponse = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ops }),
    });
    assert.equal(pushResponse.status, 200);
    const pushed = (await pushResponse.json()) as { accepted: string[]; duplicated: string[] };
    assert.equal(pushed.accepted.length, 3);
    assert.equal(pushed.duplicated.length, 0);

    // push identique : tout en doublons (idempotence).
    const pushAgain = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ops }),
    });
    const again = (await pushAgain.json()) as { accepted: string[]; duplicated: string[] };
    assert.equal(again.accepted.length, 0);
    assert.equal(again.duplicated.length, 3);

    // head = head initial + 3.
    const headAfter = (await (await fetch(`${baseUrl}/api/sync/head`, { headers })).json()) as {
      cursor: number;
    };
    assert.equal(headAfter.cursor, headBefore.cursor + 3);

    // pull paginé.
    const pullPage1 = (await (
      await fetch(`${baseUrl}/api/sync/pull?cursor=${headBefore.cursor}&limit=2`, { headers })
    ).json()) as { ops: unknown[]; cursor: number };
    assert.equal(pullPage1.ops.length, 2);
    assert.equal(pullPage1.cursor, headBefore.cursor + 2);

    const pullPage2 = (await (
      await fetch(`${baseUrl}/api/sync/pull?cursor=${pullPage1.cursor}&limit=2`, { headers })
    ).json()) as { ops: unknown[]; cursor: number };
    assert.equal(pullPage2.ops.length, 1);
    assert.equal(pullPage2.cursor, headAfter.cursor);

    // pull à jour → vide, cursor inchangé.
    const pullEmpty = (await (
      await fetch(`${baseUrl}/api/sync/pull?cursor=${headAfter.cursor}&limit=2`, { headers })
    ).json()) as { ops: unknown[]; cursor: number };
    assert.equal(pullEmpty.ops.length, 0);
    assert.equal(pullEmpty.cursor, headAfter.cursor);

    // op invalide → 400, lot entier rejeté.
    const badResponse = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ops: [ops[0], { ...ops[1], payload: { delta: "beaucoup" } }] }),
    });
    assert.equal(badResponse.status, 400);

    // 404 pour une route /api inconnue.
    const unknownResponse = await fetch(`${baseUrl}/api/inconnu`, { headers });
    assert.equal(unknownResponse.status, 404);
  },
);
