// Lookup produit par code-barres : réseau d'abord, cache Dexie en repli (hors-ligne).
// Échec total → found: false : la création locale n'est jamais bloquée (SPECS.md § 7.3).
import { apiGet } from "./client";
import { db } from "../db/db";
import type { LookupRow } from "../db/db";

export interface LookupResult {
  found: boolean;
  source?: string;
  name?: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
}

const toRow = (barcode: string, result: LookupResult): LookupRow => ({
  barcode,
  found: result.found,
  source: result.source,
  name: result.name,
  brand: result.brand,
  quantity: result.quantity,
  imageUrl: result.imageUrl,
  fetchedAt: Date.now(),
});

export const lookupBarcode = async (barcode: string): Promise<LookupResult> => {
  const cached = await db.lookups.get(barcode);
  try {
    const result = await apiGet<LookupResult>(`/api/lookup/${encodeURIComponent(barcode)}`);
    await db.lookups.put(toRow(barcode, result));
    return result;
  } catch {
    if (cached) return cached;
    return { found: false };
  }
};
