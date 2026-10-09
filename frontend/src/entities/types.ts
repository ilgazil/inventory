// Types du modèle d'opérations et des items (cf. frontend/SPECS.md § 4).

export type SettableField = "name" | "barcode" | "location" | "category";

export interface CreatePayload {
  name: string;
  /** Codes-barres associés (forme courante). */
  barcodes?: string[];
  /** Forme legacy (v1) : un seul code-barres. Conservée pour le replay du journal. */
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

/** Remplacement complet de la liste des codes-barres d'un item (fusion, association multiple). */
export interface BarcodesPayload {
  barcodes: string[];
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
  | (OpBase & { type: "item.barcodes.set"; payload: BarcodesPayload })
  | (OpBase & { type: "item.delete"; payload: Record<string, never> });

/** Op stockée localement (Dexie) : suivi de synchronisation. */
export type StoredOp = Op & { synced: 0 | 1; seq: number | null };

export interface Item {
  id: string;
  name: string;
  /** Codes-barres associés (multi-association : un code ne pointe que vers un item actif). */
  barcodes: string[];
  location: string;
  category: string;
  qty: number;
  /** Tombstone : l'item supprimé reste en base pour la convergence, filtré par l'UI. */
  deleted: boolean;
  /** HLC de création. */
  createdAt: string;
  /** Dernier HLC appliqué par champ (LWW par champ) ; `barcode` couvre la liste `barcodes`. */
  fieldHlc: Record<SettableField, string>;
}
