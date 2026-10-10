// Moteur de synchronisation (cf. SPECS.md § 5) : push des ops locales, pull incrémental, repli complet.
// HTTP pur (pas de WebSocket) ; toute erreur réseau est non bloquante — retry au prochain déclencheur.
import { apiGet, apiPost, AuthError } from "../api/client";
import { getToken } from "../api/client";
import {
  getCursor,
  markSynced,
  pendingOps,
  receiveRemoteOps,
  rebuildProjection,
  setCursor,
} from "../db/repo";
import { setMeta } from "../db/meta";
import type { Op, StoredOp } from "../entities/types";
import { ensureEmbeddings } from "../suggest/cache";

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "error" | "auth-expired";

export interface SyncSnapshot {
  state: SyncState;
  lastSyncAt: number | null;
}

let snapshot: SyncSnapshot = { state: "idle", lastSyncAt: null };
const listeners = new Set<() => void>();

const setSnapshot = (next: Partial<SyncSnapshot>): void => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
};

export const subscribeSync = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSyncSnapshot = (): SyncSnapshot => snapshot;

const PULL_LIMIT = 200;
const PUSH_BATCH = 200;

let syncing = false;
let debounceTimer: number | null = null;

/** Seuls les 6 champs de l'op partent sur le réseau (jamais synced/seq). */
const stripForWire = (stored: StoredOp): Op =>
  // Le couple (type, payload) provient de la même op stockée : la forme discriminée est préservée.
  ({
    uuid: stored.uuid,
    deviceId: stored.deviceId,
    hlc: stored.hlc,
    type: stored.type,
    entityId: stored.entityId,
    payload: stored.payload,
  }) as Op;

const pushPending = async (): Promise<void> => {
  while (true) {
    const pending = await pendingOps(PUSH_BATCH);
    if (pending.length === 0) return;
    const result = await apiPost<{ accepted: string[]; duplicated: string[] }>(
      "/api/sync/push",
      { ops: pending.map(stripForWire) },
    );    // Un doublon serveur = op déjà enregistrée → considérée synchronisée elle aussi.
    await markSynced([...result.accepted, ...result.duplicated]);
  }
};

const pullNew = async (): Promise<void> => {
  let cursor = await getCursor();
  while (true) {
    const data = await apiGet<{ ops: Op[]; cursor: number }>(
      `/api/sync/pull?cursor=${cursor}&limit=${PULL_LIMIT}`,
    );
    if (data.ops.length > 0) {
      await receiveRemoteOps(data.ops);
    }
    cursor = data.cursor;
    await setCursor(cursor);
    if (data.ops.length < PULL_LIMIT) return;
  }
};

const runSync = async (): Promise<void> => {
  if (syncing) return;
  if (!getToken()) {
    setSnapshot({ state: "idle" });
    return;
  }
  if (!navigator.onLine) {
    setSnapshot({ state: "offline" });
    return;
  }

  syncing = true;
  setSnapshot({ state: "syncing" });
  try {
    await pushPending();
    await pullNew();
    await rebuildProjection();
    // Recalcule les vecteurs des noms nouveaux/modifiés (suggestions) — sans effet si inactif.
    void ensureEmbeddings();
    const lastSyncAt = Date.now();
    await setMeta("lastSyncAt", lastSyncAt);
    setSnapshot({ state: "synced", lastSyncAt });
  } catch (error) {
    if (error instanceof AuthError) {
      setSnapshot({ state: "auth-expired" });
    } else {
      setSnapshot({ state: navigator.onLine ? "error" : "offline" });
    }
  } finally {
    syncing = false;
  }
};

/** Sync immédiate (bouton, retour en ligne…). */
export const requestSync = (): void => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  void runSync();
};

/** Sync débouncée (après une op locale). */
export const requestSyncSoon = (delayMs = 800): void => {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, delayMs);
};

/** Installe les déclencheurs (online, visibilité, timer) et lance une première sync. */
export const startEngine = (): void => {
  window.addEventListener("online", () => requestSync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void runSync();
  }, 60_000);
  void runSync();
};
