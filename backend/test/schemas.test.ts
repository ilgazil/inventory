import test from "node:test";
import assert from "node:assert/strict";
import { opSchema, pullQuerySchema, pushBodySchema } from "../src/sync/schemas.ts";

const DEVICE = "a1b2c3d4-e5f6-4c2e-9f3d-7a1b2c3d4e5f";
const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const HLC = "001728211200000:000003:a1b2c3d4-e5f6-4c2e-9f3d-7a1b2c3d4e5f";

const baseOp = {
  uuid: UUID,
  deviceId: DEVICE,
  hlc: HLC,
  entityId: UUID,
};

test("item.create valide (complet)", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "Lessic Pur", barcode: "3017620422003", location: "Cave", category: "Ménage" },
  });
  assert.equal(result.success, true);
});

test("item.create valide (minimal)", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "Scotch" },
  });
  assert.equal(result.success, true);
});

test("item.create : nom vide (espaces) rejeté", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "   " },
  });
  assert.equal(result.success, false);
});

test("item.create : code-barres invalide rejeté", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "X", barcode: "a!b" },
  });
  assert.equal(result.success, false);
});

test("item.create : code-barres vide accepté", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "X", barcode: "" },
  });
  assert.equal(result.success, true);
});

test("item.create : champ supplémentaire rejeté (strict)", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.create",
    payload: { name: "X", extra: true },
  });
  assert.equal(result.success, false);
});

test("item.adjust : delta entier accepté", () => {
  const result = opSchema.safeParse({ ...baseOp, type: "item.adjust", payload: { delta: -3 } });
  assert.equal(result.success, true);
});

test("item.adjust : delta non entier rejeté", () => {
  const result = opSchema.safeParse({ ...baseOp, type: "item.adjust", payload: { delta: 1.5 } });
  assert.equal(result.success, false);
});

test("item.adjust : delta hors bornes rejeté", () => {
  const result = opSchema.safeParse({ ...baseOp, type: "item.adjust", payload: { delta: 2_000_000 } });
  assert.equal(result.success, false);
});

test("item.set : emplacement valide", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.set",
    payload: { field: "location", value: " Garage " },
  });
  assert.equal(result.success, true);
  if (result.success && result.data.type === "item.set") {
    assert.equal(result.data.payload.value, "Garage");
  }
});

test("item.set : nom vide rejeté", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.set",
    payload: { field: "name", value: "  " },
  });
  assert.equal(result.success, false);
});

test("item.set : code-barres vide accepté (effacement)", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.set",
    payload: { field: "barcode", value: "" },
  });
  assert.equal(result.success, true);
});

test("item.set : emplacement trop long rejeté", () => {
  const result = opSchema.safeParse({
    ...baseOp,
    type: "item.set",
    payload: { field: "location", value: "x".repeat(65) },
  });
  assert.equal(result.success, false);
});

test("item.delete : payload vide requis", () => {
  assert.equal(
    opSchema.safeParse({ ...baseOp, type: "item.delete", payload: {} }).success,
    true,
  );
  assert.equal(
    opSchema.safeParse({ ...baseOp, type: "item.delete", payload: { delta: 1 } }).success,
    false,
  );
});

test("type inconnu rejeté", () => {
  const result = opSchema.safeParse({ ...baseOp, type: "item.explode", payload: {} });
  assert.equal(result.success, false);
});

test("uuid et hlc invalides rejetés", () => {
  const bad = { ...baseOp, type: "item.adjust", payload: { delta: 1 } };
  assert.equal(
    opSchema.safeParse({ ...bad, uuid: "pas-un-uuid" }).success,
    false,
  );
  assert.equal(
    opSchema.safeParse({ ...bad, hlc: "1728211200000:3:device" }).success,
    false,
  );
});

test("pushBodySchema : lot vide et trop grand rejetés", () => {
  assert.equal(pushBodySchema.safeParse({ ops: [] }).success, false);
  const ops = Array.from({ length: 501 }, (_, i) => ({
    uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    deviceId: DEVICE,
    hlc: HLC,
    type: "item.adjust",
    entityId: UUID,
    payload: { delta: 1 },
  }));
  assert.equal(pushBodySchema.safeParse({ ops }).success, false);
});

test("pullQuerySchema : défauts, coercition et bornes", () => {
  const empty = pullQuerySchema.safeParse({});
  assert.ok(empty.success);
  if (empty.success) {
    assert.deepEqual([empty.data.cursor, empty.data.limit], [0, 200]);
  }

  const coerced = pullQuerySchema.safeParse({ cursor: "5", limit: "50" });
  assert.ok(coerced.success);
  if (coerced.success) {
    assert.deepEqual([coerced.data.cursor, coerced.data.limit], [5, 50]);
  }

  assert.equal(pullQuerySchema.safeParse({ cursor: -1 }).success, false);
  assert.equal(pullQuerySchema.safeParse({ limit: 501 }).success, false);
  assert.equal(pullQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(pullQuerySchema.safeParse({ cursor: "abc" }).success, false);
});
