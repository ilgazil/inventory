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

export class InventoryDb extends Dexie {
  ops!: Table<StoredOp, string>;
  items!: Table<Item, string>;
  meta!: Table<MetaRow, string>;
  lookups!: Table<LookupRow, string>;

  constructor() {
    super("inventory");
    // NB : `deleted` (booléen) n'est pas indexable en IndexedDB — les requêtes filtrent en mémoire.
    this.version(1).stores({
      ops: "uuid, synced, hlc",
      items: "id, barcode, location, category",
      meta: "key",
      lookups: "barcode",
    });
  }
}

export const db = new InventoryDb();
