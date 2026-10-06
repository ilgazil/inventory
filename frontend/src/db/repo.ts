// Couche d'écriture/lecture locale : enregistrement des ops, projection items, requêtes UI.
// Pas un seul appel réseau ici — l'app est offline-first (cf. SPECS.md § 3/4).
import { db } from "./db";
import { getMeta, getOrCreateDeviceId, setMeta } from "./meta";
import { createHlcClock } from "../entities/hlc";
import { applyOp, rebuild } from "../entities/fold";
import type { HlcClock } from "../entities/hlc";
import type { Item, Op, StoredOp } from "../entities/types";

let deviceId = "";
let clock: HlcClock | null = null;

/** À appeler une fois au démarrage, avant toute écriture. */
export const initRepo = async (): Promise<string> => {
  deviceId = await getOrCreateDeviceId();
  clock = createHlcClock(deviceId);
  // Restaure la monotonie de l'horloge après un rechargement : réintègre le dernier HLC connu.
  const last = await db.ops.orderBy("hlc").last();
  if (last) clock.receive(last.hlc);
  return deviceId;
};

const requireClock = (): HlcClock => {
  if (!clock) throw new Error("initRepo() doit être appelé avant toute écriture");
  return clock;
};

/** Enregistre une op locale (journal + application incrémentale à la projection). */
export const recordOp = async (op: Omit<Op, "uuid" | "deviceId" | "hlc">): Promise<Op> => {
  const full = {
    uuid: crypto.randomUUID(),
    deviceId,
    hlc: requireClock().now(),
    ...op,
  } as Op;
  const stored: StoredOp = { ...full, synced: 0, seq: null };

  await db.transaction("rw", db.ops, db.items, async () => {
    await db.ops.add(stored);
    // Application incrémentale sur l'item ciblé (le fold complet recanonisera à la sync).
    const current = await db.items.get(full.entityId);
    const map = new Map<string, Item>();
    if (current && !current.deleted) map.set(current.id, current);
    applyOp(map, full);
    const updated = map.get(full.entityId);
    if (updated) {
      await db.items.put(updated);
    } else if (full.type === "item.delete") {
      await db.items.delete(full.entityId);
    }
  });

  return full;
};

/** Insère les ops distantes reçues (idempotent : uuid PK) et intègre leur HLC. */
export const receiveRemoteOps = async (ops: readonly Op[]): Promise<void> => {
  const activeClock = requireClock();
  const stored: StoredOp[] = ops.map((op) => {
    activeClock.receive(op.hlc);
    return { ...op, synced: 1 as const, seq: null };
  });
  await db.ops.bulkPut(stored);
};

/** Repli complet : reconstruit la projection items depuis tout le journal. */
export const rebuildProjection = async (): Promise<void> => {
  const ops = await db.ops.toArray();
  const items = rebuild(ops);
  await db.transaction("rw", db.items, async () => {
    await db.items.clear();
    await db.items.bulkPut([...items.values()]);
  });
};

export const pendingCount = async (): Promise<number> =>
  db.ops.where("synced").equals(0).count();

export const pendingOps = async (limit: number): Promise<StoredOp[]> =>
  db.ops.where("synced").equals(0).limit(limit).toArray();

export const markSynced = async (uuids: readonly string[]): Promise<void> => {
  if (uuids.length === 0) return;
  await db.ops.where("uuid").anyOf([...uuids]).modify({ synced: 1 });
};

export const getCursor = async (): Promise<number> => (await getMeta<number>("cursor")) ?? 0;
export const setCursor = (cursor: number): Promise<unknown> => setMeta("cursor", cursor);

export const findItemByBarcode = async (barcode: string): Promise<Item | undefined> => {
  const item = await db.items.where("barcode").equals(barcode).first();
  return item && !item.deleted ? item : undefined;
};

export const getAllItems = async (): Promise<Item[]> => {
  const all = await db.items.toArray();
  return all.filter((item) => !item.deleted);
};
