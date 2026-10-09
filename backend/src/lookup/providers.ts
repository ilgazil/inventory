// Recherche produit par code-barres : Open Food Facts (alimentaire) puis Open Products Facts
// (le reste — dont les produits ménagers). Résultats normalisés et cachés en base.

export interface LookupResult {
  found: boolean;
  source?: string;
  name?: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
}

export class LookupUnavailableError extends Error {
  constructor() {
    super("Toutes les sources de recherche sont indisponibles.");
    this.name = "LookupUnavailableError";
  }
}

export interface NormalizedProduct {
  name: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
}

const SOURCES: ReadonlyArray<{ source: string; host: string }> = [
  { source: "openfoodfacts", host: "https://world.openfoodfacts.org" },
  { source: "openproductsfacts", host: "https://world.openproductsfacts.org" },
];

const USER_AGENT = "inventory/1.0 (application personnelle)";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const pickString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, maxLength)
    : undefined;

/** Extrait un produit normalisé d'une réponse OFF/OPF ; undefined si aucun nom exploitable. */
export const normalizeProductPayload = (data: unknown): NormalizedProduct | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const product = (data as { product?: unknown })["product"];
  if (typeof product !== "object" || product === null) return undefined;
  const p = product as Record<string, unknown>;
  const name =
    pickString(p["product_name"], 512) ??
    pickString(p["product_name_fr"], 512) ??
    pickString(p["product_name_en"], 512) ??
    pickString(p["generic_name"], 512);
  if (name === undefined) return undefined;
  return {
    name,
    brand: pickString(p["brands"], 255),
    quantity: pickString(p["quantity"], 64),
    imageUrl: pickString(p["image_front_small_url"], 1024),
  };
};

/**
 * Interroge les sources dans l'ordre, retourne le premier produit trouvé.
 * - aucune source injoignable mais produit absent partout → { found: false } ;
 * - toutes les sources en échec réseau/timeout → LookupUnavailableError.
 */
export const lookupBarcode = async (
  barcode: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 6000,
): Promise<LookupResult> => {
  let responded = false;

  for (const { source, host } of SOURCES) {
    try {
      const response = await fetchImpl(`${host}/api/v2/product/${encodeURIComponent(barcode)}.json`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          // Max de français, repli anglais — sinon, depuis la Suisse, les API OFF/OPF
          // renvoient souvent les noms en allemand.
          "Accept-Language": "fr, en;q=0.5",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      responded = true;
      if (!response.ok) continue;
      const data = (await response.json()) as unknown;
      const product = normalizeProductPayload(data);
      if (product) return { found: true, source, ...product };
    } catch {
      // Timeout / réseau : on tente la source suivante.
    }
  }

  if (responded) return { found: false };
  throw new LookupUnavailableError();
};
