import { describe, expect, it } from "vitest";
import { applyOp, rebuild } from "./fold";
import type { Op, SettableField } from "./types";

const DEVICE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DEVICE_B = "bbbbbbbb-0000-4000-8000-000000000002";

const ITEM_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ITEM_ID = "20000000-0000-4000-8000-000000000002";

// Fabrique déterministe : chaque op est identifiée par un index stable → uuid et hlc
// identiques d'un appel de scenario() à l'autre (les tests de convergence le exigent).
const uuidOf = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const hlcOf = (index: number, deviceId: string = DEVICE_A): string =>
  `${String(1_700_000_000_000 + index).padStart(15, "0")}:${String(index % 1_000_000).padStart(6, "0")}:${deviceId}`;

const op = (
  index: number,
  type: Op["type"],
  payload: Op["payload"],
  options: { deviceId?: string; entityId?: string } = {},
): Op => {
  const deviceId = options.deviceId ?? DEVICE_A;
  return {
    uuid: uuidOf(index),
    deviceId,
    hlc: hlcOf(index, deviceId),
    type,
    entityId: options.entityId ?? ITEM_ID,
    payload: payload as Op["payload"],
  };
};

// Générateur pseudo-aléatoire déterministe (LCG) — pas de flakiness.
const seededShuffle = <T>(values: T[], seed: number): T[] => {
  const copy = [...values];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
};

const serialize = (items: Map<string, import("./types").Item>): string =>
  JSON.stringify([...items.entries()].sort(([a], [b]) => a.localeCompare(b)));

describe("fold — create", () => {
  it("crée un item avec qty 0", () => {
    const items = rebuild([op(1, "item.create", { name: "Lessic Pur" })]);
    expect(items.get(ITEM_ID)?.name).toBe("Lessic Pur");
    expect(items.get(ITEM_ID)?.qty).toBe(0);
    expect(items.get(ITEM_ID)?.deleted).toBe(false);
  });

  it("ignore une création avec nom vide", () => {
    const items = rebuild([op(1, "item.create", { name: "   " })]);
    expect(items.size).toBe(0);
  });

  it("ignore une création concurrente du même id (premier par ordre canonique gagne)", () => {
    const items = rebuild([
      op(1, "item.create", { name: "Premier" }),
      op(9, "item.create", { name: "Second" }),
    ]);
    expect(items.get(ITEM_ID)?.name).toBe("Premier");
  });

  it("déduplique deux créations avec le même code-barres", () => {
    const items = rebuild([
      op(1, "item.create", { name: "Original", barcode: "3017620422003" }),
      op(2, "item.create", { name: "Doublon", barcode: "3017620422003" }, { entityId: OTHER_ITEM_ID }),
    ]);
    expect(items.get(ITEM_ID)?.name).toBe("Original");
    expect(items.has(OTHER_ITEM_ID)).toBe(false);
  });
});

describe("fold — adjust", () => {
  it("incrémente et décrémente", () => {
    const items = rebuild([
      op(1, "item.create", { name: "X" }),
      op(2, "item.adjust", { delta: 3 }),
      op(3, "item.adjust", { delta: -1 }),
    ]);
    expect(items.get(ITEM_ID)?.qty).toBe(2);
  });

  it("plafonne à 0", () => {
    const items = rebuild([
      op(1, "item.create", { name: "X" }),
      op(2, "item.adjust", { delta: 1 }),
      op(3, "item.adjust", { delta: -5 }),
    ]);
    expect(items.get(ITEM_ID)?.qty).toBe(0);
  });

  it("ignore les ajustements d'un item supprimé", () => {
    const items = rebuild([
      op(1, "item.create", { name: "X" }),
      op(2, "item.delete", {}),
      op(3, "item.adjust", { delta: 4 }),
    ]);
    expect(items.get(ITEM_ID)?.qty).toBe(0);
    expect(items.get(ITEM_ID)?.deleted).toBe(true);
  });
});

describe("fold — set (LWW par champ)", () => {
  it("le HLC le plus grand gagne, quel que soit l'ordre du tableau", () => {
    const ops = [
      op(1, "item.create", { name: "Initial" }),
      op(2, "item.set", { field: "name", value: "Perdant" }),
      op(9, "item.set", { field: "name", value: "Gagnant" }),
    ];
    expect(serialize(rebuild(ops))).toBe(serialize(rebuild([...ops].reverse())));
    expect(rebuild(ops).get(ITEM_ID)?.name).toBe("Gagnant");
  });

  it("ignore un set plus vieux que le dernier champ appliqué", () => {
    const items = rebuild([
      op(9, "item.create", { name: "Récent" }),
      op(1, "item.set", { field: "name", value: "Obsolète" }),
    ]);
    expect(items.get(ITEM_ID)?.name).toBe("Récent");
  });

  it("les champs évoluent indépendamment (LWW par champ, pas par item)", () => {
    const items = rebuild([
      op(1, "item.create", { name: "X", location: "Cave" }),
      op(5, "item.set", { field: "name", value: "Y" }),
      op(3, "item.set", { field: "location", value: "Garage" }),
    ]);
    const item = items.get(ITEM_ID);
    expect(item?.name).toBe("Y");
    expect(item?.location).toBe("Garage");
    expect(item?.fieldHlc.name).toBe(hlcOf(5));
    expect(item?.fieldHlc.location).toBe(hlcOf(3));
  });

  it("ignore un set sur un item supprimé", () => {
    const items = rebuild([
      op(1, "item.create", { name: "X" }),
      op(2, "item.delete", {}),
      op(3, "item.set", { field: "name", value: "Zombie" }),
    ]);
    expect(items.get(ITEM_ID)?.name).toBe("X");
  });
});

describe("fold — convergence", () => {
  // Scénario multi-appareils : créations, ajustements (y compris négatifs), sets, suppression.
  const scenario = (): Op[] => [
    op(1, "item.create", { name: "Café", barcode: "3017620422003", location: "Cuisine" }),
    op(2, "item.adjust", { delta: 2 }),
    op(3, "item.set", { field: "name" as SettableField, value: "Café en grains" }),
    op(4, "item.adjust", { delta: -1 }, { deviceId: DEVICE_B }),
    op(5, "item.create", { name: "Thé" }, { entityId: OTHER_ITEM_ID, deviceId: DEVICE_B }),
    op(6, "item.adjust", { delta: 5 }, { entityId: OTHER_ITEM_ID, deviceId: DEVICE_B }),
    op(7, "item.set", { field: "location", value: "Garage" }, { deviceId: DEVICE_B }),
    op(8, "item.adjust", { delta: -10 }, { deviceId: DEVICE_B }),
    op(9, "item.delete", {}, { entityId: OTHER_ITEM_ID, deviceId: DEVICE_B }),
  ];

  it("le même ensemble d'ops aboutit au même état, quel que soit l'ordre d'application", () => {
    const reference = serialize(rebuild(scenario()));
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(serialize(rebuild(seededShuffle(scenario(), seed)))).toBe(reference);
    }
  });

  it("rebuild est idempotent (les tombstones persistent)", () => {
    const first = rebuild(scenario());
    const second = rebuild(scenario());
    expect(serialize(second)).toBe(serialize(first));
    expect(first.get(OTHER_ITEM_ID)?.deleted).toBe(true);
  });

  it("état attendu du scénario (quantité plafonnée, nom LWW, tombstone)", () => {
    const items = rebuild(scenario());
    expect(items.get(ITEM_ID)).toMatchObject({
      name: "Café en grains",
      qty: 0,
      location: "Garage",
    });
    expect(items.get(OTHER_ITEM_ID)?.deleted).toBe(true);
  });

  it("applyOp incrémental dans l'ordre canonique == rebuild", () => {
    const incremental: Map<string, import("./types").Item> = new Map();
    for (const one of [...scenario()].sort((a, b) => (a.hlc < b.hlc ? -1 : 1))) {
      applyOp(incremental, one);
    }
    expect(serialize(incremental)).toBe(serialize(rebuild(scenario())));
  });
});
