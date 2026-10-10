import { describe, expect, it } from "vitest";
import type { Item } from "../entities/types";
import {
  centerVector,
  centerVectors,
  cosine,
  diceCoefficient,
  DUPLICATE_THRESHOLD,
  findDuplicateGroups,
  hybridScore,
  PREFIX_VETO,
  prefixScore,
  rankSuggestions,
} from "./score";

const makeItem = (overrides: Partial<Item> = {}): Item => ({
  id: "id-1",
  name: "Lessic Pur",
  barcodes: [],
  location: "Cave",
  category: "Ménage",
  qty: 2,
  deleted: false,
  createdAt: "000000000000000001:000000:dev",
  fieldHlc: { name: "", barcode: "", location: "", category: "" },
  ...overrides,
});

describe("cosine", () => {
  it("parallèle → 1, orthogonal → 0, opposé → -1 (vecteurs normalisés)", () => {
    const east = new Float32Array([1, 0]);
    const north = new Float32Array([0, 1]);
    expect(cosine(east, east)).toBeCloseTo(1);
    expect(cosine(east, north)).toBeCloseTo(0);
    expect(cosine(east, new Float32Array([-1, 0]))).toBeCloseTo(-1);
  });
});

describe("centerVectors / centerVector", () => {
  it("retire le fond commun : deux vecteurs orthogonaux deviennent opposés", () => {
    const space = centerVectors(
      new Map([
        ["a", new Float32Array([1, 0])],
        ["b", new Float32Array([0, 1])],
      ]),
    );
    const a = space.vectors.get("a")!;
    const b = space.vectors.get("b")!;
    expect(a[0]).toBeCloseTo(Math.SQRT1_2);
    expect(a[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(cosine(a, b)).toBeCloseTo(-1);
  });

  it("recentre une requête dans le même espace (centroïde partagé)", () => {
    const space = centerVectors(
      new Map([
        ["a", new Float32Array([1, 0])],
        ["b", new Float32Array([0, 1])],
      ]),
    );
    const query = centerVector(new Float32Array([1, 0]), space.centroid);
    expect(cosine(query, space.vectors.get("a")!)).toBeCloseTo(1);
  });

  it("corpus vide → espace vide ; vecteur ≈ centroïde → dégénéré (cosinus 0)", () => {
    expect(centerVectors(new Map()).vectors.size).toBe(0);
    const centroid = new Float32Array([0.5, 0.5]);
    const degenerate = centerVector(new Float32Array([0.5, 0.5]), centroid);
    expect(degenerate.every((value) => value === 0)).toBe(true);
  });
});

describe("diceCoefficient", () => {
  it("identique (casse/accents ignorés) → 1", () => {
    expect(diceCoefficient("Lessic Pur", "lessic pur")).toBe(1);
    expect(diceCoefficient("Éponge", "eponge")).toBe(1);
  });

  it("disjoint → proche de 0", () => {
    expect(diceCoefficient("Lessic Pur", "Café moulu")).toBeLessThan(0.2);
  });

  it("variantes d'un même produit → intermédiaire", () => {
    const score = diceCoefficient("Liquide vaisselle citron", "Liquide vaisselle vanille");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("chaînes d'un seul caractère", () => {
    expect(diceCoefficient("a", "a")).toBe(1);
    expect(diceCoefficient("a", "b")).toBe(0);
  });
});

describe("prefixScore", () => {
  it("même début de libellé → élevé, débuts différents → sous le veto", () => {
    expect(prefixScore("Liquide vaisselle citron", "Liquide vaisselle lavande")).toBeGreaterThan(0.9);
    expect(prefixScore("Pâtes Coquillette au blé complet", "Pâtes Farfalle blé complet")).toBeLessThan(
      PREFIX_VETO,
    );
  });
});

describe("hybridScore", () => {
  it("prend le max des scores sémantique et lexical", () => {
    const east = new Float32Array([1, 0]);
    expect(hybridScore(east, new Float32Array([0, 1]), "Liquide vaisselle", "Liquide vaisselle")).toBe(1);
    expect(hybridScore(east, east, "Liquide vaisselle", "Liquide vaisselle")).toBe(1);
  });

  it("sans vecteur → lexical seul", () => {
    expect(hybridScore(null, null, "lessic", "lessic")).toBe(1);
    expect(hybridScore(null, null, "lessic", "xyzabc")).toBe(0);
  });

  it("veto de préfixe : un début de libellé différent plafonne le score (variantes ≠ doublons)", () => {
    const east = new Float32Array([1, 0]);
    const score = hybridScore(
      east,
      east,
      "Pâtes Coquillette au blé complet",
      "Pâtes Farfalle au blé complet",
    );
    expect(score).toBeLessThan(0.5);
    // Le veto ne s'applique pas quand le début du libellé correspond.
    expect(hybridScore(east, east, "Liquide vaisselle citron", "Liquide vaisselle lavande")).toBe(1);
  });
});

describe("rankSuggestions", () => {
  const items = [
    makeItem({ id: "1", name: "Liquide vaisselle citron" }),
    makeItem({ id: "2", name: "Liquide vaisselle vanille" }),
    makeItem({ id: "3", name: "Café en grains" }),
  ];
  const vectors = new Map([
    ["1", new Float32Array([1, 0])],
    ["2", new Float32Array([0.9, 0.1])],
    ["3", new Float32Array([0, 1])],
  ]);

  it("trie par score décroissant", () => {
    const results = rankSuggestions(
      "Liquide vaisselle citron",
      new Float32Array([1, 0]),
      items,
      vectors,
    );
    expect(results.map((suggestion) => suggestion.item.id)).toEqual(["1", "2"]);
  });

  it("applique le seuil (faux positif lexical exclu)", () => {
    const results = rankSuggestions(
      "Café",
      null,
      items,
      vectors,
      0.95,
    );
    expect(results).toHaveLength(0);
  });

  it("limite au top K", () => {
    const results = rankSuggestions(
      "Liquide vaisselle citron",
      new Float32Array([1, 0]),
      items,
      vectors,
      0,
      1,
    );
    expect(results).toHaveLength(1);
  });

  it("lexical seul si l'item n'a pas encore de vecteur", () => {
    const results = rankSuggestions("Liquide vaisselle citron", null, items, new Map());
    expect(results.map((suggestion) => suggestion.item.id)).toEqual(["1", "2"]);
  });
});

describe("findDuplicateGroups", () => {
  // Vecteur unitaire en 2D d'angle donné (cosinus avec [1, 0] = angle 0, avec [0, 1] = angle π/2).
  const at = (angle: number): Float32Array => new Float32Array([Math.cos(angle), Math.sin(angle)]);
  // A~B = 0.75 et B~C = 0.72 (au-dessus du seuil), mais A~C ≈ 0.08 (dessous) : la transitivité
  // doit réunir les trois dans un seul groupe.
  const angleAB = Math.acos(0.75);
  const angleBC = Math.acos(0.72);

  it("renvoie les paires au-dessus du seuil, triées par score décroissant", () => {
    const items = [
      makeItem({ id: "a", name: "Lessic Pur" }),
      makeItem({ id: "b", name: "Lessic Pur 750ml", createdAt: "000000000000000002:000000:dev" }),
      makeItem({ id: "c", name: "Café en grains", createdAt: "000000000000000003:000000:dev" }),
    ];
    const vectors = new Map([
      ["a", new Float32Array([1, 0])],
      ["b", at(angleAB)],
      ["c", new Float32Array([0, 1])],
    ]);
    const groups = findDuplicateGroups(items, vectors);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(groups[0]?.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("réunit transitivement 3 articles similaires en un seul groupe (meilleur score interne)", () => {
    const items = [
      makeItem({ id: "a", name: "Liquide vaisselle citron" }),
      makeItem({ id: "b", name: "Liquide vaisselle lavande" }),
      makeItem({ id: "c", name: "Liquide vaisselle vanille" }),
    ];
    const vectors = new Map([
      ["a", new Float32Array([1, 0])],
      ["b", at(angleAB)],
      ["c", at(angleAB + angleBC)],
    ]);
    const groups = findDuplicateGroups(items, vectors);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    // Le lien le plus fort du groupe peut venir du lexical des variantes proches.
    expect(groups[0]?.score).toBeGreaterThan(DUPLICATE_THRESHOLD);
  });

  it("sépare les groupes disjoints et trie par score décroissant", () => {
    // Deux groupes sans lien : préfixes différents entre eux (veto) et sémantique à
    // l'opposé du cercle. Le lexical interne des groupes porte les scores.
    const items = [
      makeItem({ id: "a", name: "Liquide vaisselle citron" }),
      makeItem({ id: "b", name: "Liquide vaisselle lavande" }),
      makeItem({ id: "c", name: "Café en grains" }),
      makeItem({ id: "d", name: "Café en grains bio" }),
    ];
    const vectors = new Map([
      ["a", new Float32Array([1, 0])],
      ["b", at(angleAB)],
      ["c", at(Math.PI)],
      ["d", at(Math.PI - angleBC)], // cos(c,d) = 0.72
    ]);
    const groups = findDuplicateGroups(items, vectors);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["c", "d"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    for (const group of groups) {
      expect(group.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    }
  });

  it("ignore les items sans vecteur (pas encore vectorisés)", () => {
    const items = [makeItem({ id: "a", name: "Lessic Pur" }), makeItem({ id: "b", name: "Lessic Pur" })];
    expect(findDuplicateGroups(items, new Map())).toHaveLength(0);
  });
});
