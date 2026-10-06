// Fold (repli déterministe) des opérations → état courant.
// Invariants (cf. SPECS.md § 4.3) : qty ≥ 0, LWW par champ, déduplication de création par code-barres,
// tombstones définitives. Deux appareils appliquant le même ensemble d'ops aboutissent au même état.
import { compareHlc } from "./hlc";
import type { AdjustPayload, CreatePayload, Item, Op, SetPayload, SettableField } from "./types";

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

const barcodeAlreadyTaken = (items: ItemMap, barcode: string, exceptId: string): boolean => {
  for (const item of items.values()) {
    if (!item.deleted && item.id !== exceptId && item.barcode !== "" && item.barcode === barcode) {
      return true;
    }
  }
  return false;
};

/** Applique une op à la carte d'items (mutation en place, pour l'usage incrémental local). */
export const applyOp = (items: ItemMap, op: Op): void => {
  const item = items.get(op.entityId);
  switch (op.type) {
    case "item.create": {
      if (item) return; // création concurrente : premier arrivé (ordre canonique) gagne
      const payload = op.payload as CreatePayload;
      const name = payload.name.trim();
      if (name === "") return;
      const barcode = (payload.barcode ?? "").trim();
      if (barcode !== "" && barcodeAlreadyTaken(items, barcode, op.entityId)) return;
      const location = (payload.location ?? "").trim();
      const category = (payload.category ?? "").trim();
      const fieldHlc = emptyFieldHlc();
      fieldHlc.name = op.hlc;
      if (barcode !== "") fieldHlc.barcode = op.hlc;
      if (location !== "") fieldHlc.location = op.hlc;
      if (category !== "") fieldHlc.category = op.hlc;
      items.set(op.entityId, {
        id: op.entityId,
        name,
        barcode,
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
      item[field] = value.trim();
      item.fieldHlc[field] = op.hlc;
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
