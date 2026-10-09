import { describe, expect, it } from "vitest";
import { migrateItemV1ToV2 } from "./db";

describe("migrateItemV1ToV2", () => {
  it("transforme le code-barres scalaire en liste", () => {
    const item: { barcode?: string; barcodes?: string[] } = { barcode: "3017620422003" };
    migrateItemV1ToV2(item);
    expect(item).toEqual({ barcodes: ["3017620422003"] });
  });

  it("un item sans code-barres obtient une liste vide", () => {
    const item: { barcode?: string; barcodes?: string[] } = { barcode: "" };
    migrateItemV1ToV2(item);
    expect(item).toEqual({ barcodes: [] });
  });
});
