import { describe, expect, it } from "vitest";
import { compareItems, matchesQuery, normalizeText } from "./search";
import type { Item } from "./types";

const makeItem = (overrides: Partial<Item> = {}): Item => ({
  id: "id-1",
  name: "Lessic Pur",
  barcodes: ["3017620422003"],
  location: "Cave",
  category: "Ménage",
  qty: 2,
  deleted: false,
  createdAt: "000000000000000001:000000:dev",
  fieldHlc: { name: "", barcode: "", location: "", category: "" },
  ...overrides,
});

describe("normalizeText", () => {
  it("retire accents et casse", () => {
    expect(normalizeText("Épée DéTerGent")).toBe("epee detergent");
  });
});

describe("matchesQuery", () => {
  const item = makeItem();

  it("terme vide → tout matche", () => {
    expect(matchesQuery(item, "")).toBe(true);
    expect(matchesQuery(item, "   ")).toBe(true);
  });

  it("matche le nom insensible aux accents et à la casse", () => {
    expect(matchesQuery(item, "lessic")).toBe(true);
    expect(matchesQuery(item, "LESSIC PUR")).toBe(true);
  });

  it("tous les mots doivent matcher", () => {
    expect(matchesQuery(item, "lessic cave")).toBe(true);
    expect(matchesQuery(item, "lessic garage")).toBe(false);
  });

  it("matche l'emplacement, la catégorie et le code-barres", () => {
    expect(matchesQuery(item, "cave")).toBe(true);
    expect(matchesQuery(item, "menage")).toBe(true);
    expect(matchesQuery(item, "3017620422003")).toBe(true);
  });
});

describe("compareItems", () => {
  it("tri alphabétique insensible accents/casse (français)", () => {
    const items = [
      makeItem({ id: "3", name: "Éponge" }),
      makeItem({ id: "1", name: "Café" }),
      makeItem({ id: "2", name: "éclair" }),
    ];
    const sorted = [...items].sort(compareItems);
    expect(sorted.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });

  it("ex æquo → ordre de création", () => {
    const a = makeItem({ id: "a", name: "Café", createdAt: "000000000000000002:000000:dev" });
    const b = makeItem({ id: "b", name: "café", createdAt: "000000000000000001:000000:dev" });
    expect(compareItems(a, b)).toBe(1);
  });
});
