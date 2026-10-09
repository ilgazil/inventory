// Recherche insensible à la casse et aux accents (convention `listen`) : tous les mots du terme
// doivent matcher sur nom + emplacement + catégorie + code-barres.
import type { Item } from "./types";

export const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const matchesQuery = (item: Item, rawQuery: string): boolean => {
  const terms = normalizeText(rawQuery)
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return true;
  const haystack = normalizeText(
    [item.name, item.location, item.category, ...item.barcodes].filter(Boolean).join(" "),
  );
  return terms.every((term) => haystack.includes(term));
};

/** Tri alphabétique français, insensible casse/accents ; ex æquo → ordre de création. */
export const compareItems = (a: Item, b: Item): number =>
  normalizeText(a.name).localeCompare(normalizeText(b.name), "fr") ||
  a.createdAt.localeCompare(b.createdAt);
