// Base locale IndexedDB (Dexie) — source de vérité de l'UI (cf. SPECS.md § 3).
import Dexie from "dexie";
import type { Table } from "dexie";
import type { Item, StoredOp } from "../entities/types";

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface LookupRow {
  barcode: string;
  found: boolean;
  source?: string;
  name?: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
  fetchedAt: number;
}

/** Cache du vecteur d'embedding du nom d'un item (suggestions de doublons, cf. SPECS.md § 9). */
export interface EmbeddingRow {
  itemId: string;
  /** Nom normalisé au moment du calcul — une row obsolète si différent du nom courant. */
  nameHash: string;
  /** Float32Array normalisée, sérialisée en ArrayBuffer (384 dims pour e5-small). */
  vector: ArrayBuffer;
}

/**
 * Migration v1 → v2 (mutale, testée unitairement) : l'ancien champ scalaire `barcode` devient la
 * liste `barcodes` (multi-association de codes-barres pour la fusion).
 */
export const migrateItemV1ToV2 = (item: { barcode?: string; barcodes?: string[] }): void => {
  item.barcodes = item.barcode ? [item.barcode] : [];
  delete item.barcode;
};

export class InventoryDb extends Dexie {
  ops!: Table<StoredOp, string>;
  items!: Table<Item, string>;
  meta!: Table<MetaRow, string>;
  lookups!: Table<LookupRow, string>;
  embeddings!: Table<EmbeddingRow, string>;

  constructor() {
    super("inventory");
    // NB : `deleted` (booléen) n'est pas indexable en IndexedDB — les requêtes filtrent en mémoire.
    this.version(1).stores({
      ops: "uuid, synced, hlc",
      items: "id, barcode, location, category",
      meta: "key",
      lookups: "barcode",
    });
    // v2 : un item peut porter plusieurs codes-barres (`*barcodes` : index multi-entrées).
    this.version(2)
      .stores({
        ops: "uuid, synced, hlc",
        items: "id, *barcodes, location, category",
        meta: "key",
        lookups: "barcode",
      })
      .upgrade(async (tx) => {
        await tx.table("items").toCollection().modify(migrateItemV1ToV2);
      });
    // v3 : cache des vecteurs d'embeddings des noms (suggestions) — table neuve, rien à migrer.
    this.version(3).stores({
      ops: "uuid, synced, hlc",
      items: "id, *barcodes, location, category",
      meta: "key",
      lookups: "barcode",
      embeddings: "itemId",
    });
  }
}

export const db = new InventoryDb();
