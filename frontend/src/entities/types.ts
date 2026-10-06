// Types du modèle d'opérations et des items (cf. frontend/SPECS.md § 4).

export type SettableField = "name" | "barcode" | "location" | "category";

export interface CreatePayload {
  name: string;
  barcode?: string;
  location?: string;
  category?: string;
}

export interface AdjustPayload {
  delta: number;
}

export interface SetPayload {
  field: SettableField;
  value: string;
}

export interface OpBase {
  uuid: string;
  deviceId: string;
  /** HLC encodé (chaîne triable lexicographiquement). */
  hlc: string;
  entityId: string;
}

export type Op =
  | (OpBase & { type: "item.create"; payload: CreatePayload })
  | (OpBase & { type: "item.adjust"; payload: AdjustPayload })
  | (OpBase & { type: "item.set"; payload: SetPayload })
  | (OpBase & { type: "item.delete"; payload: Record<string, never> });

/** Op stockée localement (Dexie) : suivi de synchronisation. */
export type StoredOp = Op & { synced: 0 | 1; seq: number | null };

export interface Item {
  id: string;
  name: string;
  barcode: string;
  location: string;
  category: string;
  qty: number;
  /** Tombstone : l'item supprimé reste en base pour la convergence, filtré par l'UI. */
  deleted: boolean;
  /** HLC de création. */
  createdAt: string;
  /** Dernier HLC appliqué par champ (LWW par champ). */
  fieldHlc: Record<SettableField, string>;
}
