import { Router } from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { Config } from "../../config.ts";
import { barcodeParamSchema } from "../../sync/schemas.ts";
import { LookupUnavailableError, lookupBarcode } from "../../lookup/providers.ts";
import type { LookupResult } from "../../lookup/providers.ts";

interface CacheRow extends RowDataPacket {
  found: number;
  source: string;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  image_url: string | null;
  fetched_at: Date;
}

const toResult = (row: CacheRow): LookupResult => ({
  found: row.found === 1,
  source: row.source,
  name: row.name ?? undefined,
  brand: row.brand ?? undefined,
  quantity: row.quantity ?? undefined,
  imageUrl: row.image_url ?? undefined,
});

export const lookupRoutes = (pool: Pool, config: Config): Router => {
  const router = Router();

  router.get("/:barcode", async (req, res) => {
    const parsed = barcodeParamSchema.safeParse(req.params["barcode"]);
    if (!parsed.success) {
      res.status(400).json({ error: "Code-barres invalide." });
      return;
    }
    const barcode = parsed.data;

    // Cache DB (résultats positifs ET négatifs) avec TTL.
    const [cachedRows] = await pool.query<CacheRow[]>(
      `SELECT found, source, name, brand, quantity, image_url, fetched_at
       FROM barcode_cache WHERE barcode = ?`,
      [barcode],
    );
    const cached = cachedRows[0];
    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      if (ageMs < config.barcodeCacheTtlDays * 24 * 3600 * 1000) {
        res.json(toResult(cached));
        return;
      }
    }

    let result: LookupResult;
    try {
      result = await lookupBarcode(barcode, fetch, config.lookupTimeoutMs);
    } catch (error) {
      if (error instanceof LookupUnavailableError) {
        res.status(502).json({ error: "Service de recherche indisponible." });
        return;
      }
      throw error;
    }

    // Écriture du cache, même pour les résultats négatifs.
    await pool.execute(
      `INSERT INTO barcode_cache (barcode, found, source, name, brand, quantity, image_url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         found = VALUES(found), source = VALUES(source), name = VALUES(name),
         brand = VALUES(brand), quantity = VALUES(quantity), image_url = VALUES(image_url),
         fetched_at = CURRENT_TIMESTAMP`,
      [
        barcode,
        result.found ? 1 : 0,
        result.source ?? "none",
        result.name ?? null,
        result.brand ?? null,
        result.quantity ?? null,
        result.imageUrl ?? null,
      ],
    );

    res.json(result);
  });

  return router;
};
