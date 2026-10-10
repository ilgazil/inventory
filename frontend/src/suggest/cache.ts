// Cache des vecteurs d'embeddings (Dexie) et pass incrémental : chaque nom n'est vectorisé qu'une
// fois ; une row obsolète (nom modifié) est recalculée, les vecteurs d'items supprimés purgés.
import { db } from "../db/db";
import type { EmbeddingRow } from "../db/db";
import { getAllItems } from "../db/repo";
import { normalizeText } from "../entities/search";
import type { Item } from "../entities/types";
import { embed, getSuggestState } from "./engine";

/** Hachage d'invalidation : le nom normalisé au moment du calcul. */
export const nameHashOf = (item: Item): string => normalizeText(item.name);

const isStale = (row: EmbeddingRow | undefined, hash: string): boolean =>
  row === undefined || row.nameHash !== hash;

let running = false;

/**
 * Vectorise les noms sans vecteur à jour et purge les orphelins. Sans effet si le moteur n'est pas
 * prêt. Les appels concurrents sont ignorés (une seule passe à la fois).
 */
export const ensureEmbeddings = async (): Promise<void> => {
  if (running || getSuggestState().status !== "ready") return;
  running = true;
  try {
    const items = await getAllItems();
    const hashes = new Map(items.map((item) => [item.id, nameHashOf(item)]));
    const rows = await db.embeddings.bulkGet([...hashes.keys()]);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const hash = hashes.get(item.id)!;
      if (!isStale(rows[index], hash)) continue;
      const vector = await embed(item.name, "passage");
      await db.embeddings.put({
        itemId: item.id,
        nameHash: hash,
        vector: vector.buffer as ArrayBuffer,
      });
    }
    const activeIds = new Set(items.map((item) => item.id));
    const staleIds = (await db.embeddings.toArray())
      .map((row) => row.itemId)
      .filter((itemId) => !activeIds.has(itemId));
    if (staleIds.length > 0) await db.embeddings.bulkDelete(staleIds);
  } finally {
    running = false;
  }
};

/** Vecteurs en cache (items actifs uniquement), prêts pour les comparaisons en mémoire. */
export const getCachedVectors = async (): Promise<Map<string, Float32Array>> => {
  const rows = await db.embeddings.toArray();
  return new Map(rows.map((row) => [row.itemId, new Float32Array(row.vector)]));
};
