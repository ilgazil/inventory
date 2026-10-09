import test from "node:test";
import assert from "node:assert/strict";
import {
  LookupUnavailableError,
  lookupBarcode,
  normalizeProductPayload,
} from "../src/lookup/providers.ts";

test("normalizeProductPayload : priorité product_name, puis fr, puis en, puis generic", () => {
  const result = normalizeProductPayload({
    product: { product_name: "Lessic Pur", brands: "Dr. Beckmann", quantity: "750 ml" },
  });
  assert.deepEqual(result, {
    name: "Lessic Pur",
    brand: "Dr. Beckmann",
    quantity: "750 ml",
    imageUrl: undefined,
  });

  const fallback = normalizeProductPayload({
    product: { product_name_fr: "Produit FR", generic_name: "Générique" },
  });
  assert.ok(fallback);
  assert.equal(fallback.name, "Produit FR");

  const fallbackEn = normalizeProductPayload({
    product: { product_name_en: "Product EN", generic_name: "Générique" },
  });
  assert.ok(fallbackEn);
  assert.equal(fallbackEn.name, "Product EN");

  const generic = normalizeProductPayload({ product: { generic_name: "Générique" } });
  assert.ok(generic);
  assert.equal(generic.name, "Générique");
});

test("normalizeProductPayload : undefined sans nom exploitable", () => {
  assert.equal(normalizeProductPayload({ product: {} }), undefined);
  assert.equal(normalizeProductPayload({ product: { product_name: "   " } }), undefined);
  assert.equal(normalizeProductPayload({ status: 0 }), undefined);
  assert.equal(normalizeProductPayload("n'importe quoi"), undefined);
});

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const stubFetch = (handler: (url: string) => Promise<Response>): { fetch: typeof fetch; urls: string[] } => {
  const urls: string[] = [];
  const stub = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetch: stub, urls };
};

test("lookupBarcode : première source (Open Food Facts) trouvée", async () => {
  const { fetch: fetchImpl, urls } = stubFetch(async () =>
    jsonResponse({
      product: { product_name: "Lessic Pur", brands: "Dr. Beckmann" },
    }),
  );
  const result = await lookupBarcode("3017620422003", fetchImpl, 1000);
  assert.equal(result.found, true);
  assert.equal(result.source, "openfoodfacts");
  assert.equal(result.name, "Lessic Pur");
  assert.equal(urls[0], "https://world.openfoodfacts.org/api/v2/product/3017620422003.json");
});

test("lookupBarcode : bascule sur Open Products Facts si la première source échoue", async () => {
  const { fetch: fetchImpl } = stubFetch(async (url) => {
    if (url.includes("openfoodfacts")) throw new Error("réseau indisponible");
    return jsonResponse({ product: { product_name: "Liquide vaisselle" } });
  });
  const result = await lookupBarcode("1234567", fetchImpl, 1000);
  assert.equal(result.found, true);
  assert.equal(result.source, "openproductsfacts");
});

test("lookupBarcode : produit absent partout → found: false", async () => {
  const { fetch: fetchImpl } = stubFetch(async () =>
    jsonResponse({ status: 0, status_verbose: "product not found" }),
  );
  const result = await lookupBarcode("0000000000000", fetchImpl, 1000);
  assert.deepEqual(result, { found: false });
});

test("lookupBarcode : toutes les sources injoignables → LookupUnavailableError", async () => {
  const unreachable = (async () => {
    throw new Error("réseau indisponible");
  }) as unknown as typeof fetch;
  await assert.rejects(() => lookupBarcode("3017620422003", unreachable, 100), LookupUnavailableError);
});

test("lookupBarcode : 404 sur la première source puis produit sur la seconde", async () => {
  const { fetch: fetchImpl } = stubFetch(async (url) =>
    url.includes("openfoodfacts")
      ? jsonResponse({}, 404)
      : jsonResponse({ product: { product_name: "Nettoyant" } }),
  );
  const result = await lookupBarcode("9876543210", fetchImpl, 1000);
  assert.equal(result.found, true);
  assert.equal(result.name, "Nettoyant");
});
