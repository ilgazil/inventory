// Fold (repli déterministe) des opérations → état courant.
// Invariants (cf. SPECS.md § 4.3) : qty ≥ 0, LWW par champ, unicité des codes-barres entre items
// actifs, tombstones définitives. Deux appareils appliquant le même ensemble d'ops aboutissent au
// même état.
import { compareHlc } from "./hlc";
import type {
  AdjustPayload,
  BarcodesPayload,
  CreatePayload,
  Item,
  Op,
  SetPayload,
  SettableField,
} from "./types";

export type ItemMap = Map<string, Item>;

const emptyFieldHlc = (): Record<SettableField, string> => ({
  name: "",
  barcode: "",
  location: "",
  category: "",
});

/** Ordre canonique total : (hlc, deviceId, uuid) — identique sur tous les appareils. */
export const compareOps = (a: Op, b: Op): number =>
  compareHlc(a.hlc, b.hlc) ||
  (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0) ||
  (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);

/** Normalise une liste de codes-barres : trim, vides exclus, dédupliquée. */
const normalizeBarcodes = (barcodes: readonly string[]): string[] => [
  ...new Set(barcodes.map((code) => code.trim()).filter((code) => code !== "")),
];

const hasBarcodeConflict = (
  items: ItemMap,
  barcodes: readonly string[],
  exceptId: string,
): boolean => {
  if (barcodes.length === 0) return false;
  for (const other of items.values()) {
    if (other.deleted || other.id === exceptId) continue;
    for (const code of barcodes) {
      if (other.barcodes.includes(code)) return true;
    }
  }
  return false;
};

/** Codes-barres d'une op de création : forme courante `barcodes`, repli legacy `barcode`. */
const createBarcodes = (payload: CreatePayload): string[] =>
  normalizeBarcodes(payload.barcodes ?? (payload.barcode !== undefined ? [payload.barcode] : []));

/** Applique une op à la carte d'items (mutation en place, pour l'usage incrémental local). */
export const applyOp = (items: ItemMap, op: Op): void => {
  const item = items.get(op.entityId);
  switch (op.type) {
    case "item.create": {
      if (item) return; // création concurrente : premier arrivé (ordre canonique) gagne
      const payload = op.payload as CreatePayload;
      const name = payload.name.trim();
      if (name === "") return;
      const barcodes = createBarcodes(payload);
      if (hasBarcodeConflict(items, barcodes, op.entityId)) return;
      const location = (payload.location ?? "").trim();
      const category = (payload.category ?? "").trim();
      const fieldHlc = emptyFieldHlc();
      fieldHlc.name = op.hlc;
      if (barcodes.length > 0) fieldHlc.barcode = op.hlc;
      if (location !== "") fieldHlc.location = op.hlc;
      if (category !== "") fieldHlc.category = op.hlc;
      items.set(op.entityId, {
        id: op.entityId,
        name,
        barcodes,
        location,
        category,
        qty: 0,
        deleted: false,
        createdAt: op.hlc,
        fieldHlc,
      });
      return;
    }
    case "item.adjust": {
      if (!item || item.deleted) return;
      item.qty = Math.max(0, item.qty + (op.payload as AdjustPayload).delta);
      return;
    }
    case "item.set": {
      if (!item || item.deleted) return;
      const { field, value } = op.payload as SetPayload;
      if (compareHlc(op.hlc, item.fieldHlc[field]) <= 0) return; // LWW par champ
      const trimmed = value.trim();
      if (field === "barcode") {
        // Forme legacy (un seul code) : traduite dans la liste.
        item.barcodes = trimmed === "" ? [] : [trimmed];
      } else {
        item[field] = trimmed;
      }
      item.fieldHlc[field] = op.hlc;
      return;
    }
    case "item.barcodes.set": {
      if (!item || item.deleted) return;
      if (compareHlc(op.hlc, item.fieldHlc.barcode) <= 0) return; // LWW champ codes-barres
      const barcodes = normalizeBarcodes((op.payload as BarcodesPayload).barcodes);
      if (hasBarcodeConflict(items, barcodes, op.entityId)) return;
      item.barcodes = barcodes;
      item.fieldHlc.barcode = op.hlc;
      return;
    }
    case "item.delete": {
      if (!item) return;
      item.deleted = true;
      return;
    }
  }
};

/** Repli complet : reconstruit l'état depuis TOUTES les ops, dans l'ordre canonique. */
export const rebuild = (ops: readonly Op[]): ItemMap => {
  const items: ItemMap = new Map();
  for (const op of [...ops].sort(compareOps)) {
    applyOp(items, op);
  }
  return items;
};
