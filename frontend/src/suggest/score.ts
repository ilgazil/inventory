// Scores de similarité entre produits : sémantique (cosinus sur embeddings e5 **centrés**) et
// lexical (Dice sur bigrammes normalisés). Le score final est le max des deux.
// Le recentrage (soustraction du centroïde du corpus puis renormalisation) est indispensable :
// sur des noms de produits courts, un fond sémantique commun au domaine gonfle tous les cosinus
// (plancher ~0.82 mesuré sur données réelles → ~0 après centrage, cf.
// backend/scripts/calibrate-similarity.mjs).
import { compareItems, normalizeText } from "../entities/search";
import type { Item } from "../entities/types";

/** Vecteurs normalisés → le produit scalaire est le cosinus. */
export const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
  }
  return dot;
};

/** Recentre un vecteur : soustraction du centroïde puis renormalisation (norme 1). */
export const centerVector = (vector: Float32Array, centroid: Float32Array): Float32Array => {
  const shifted = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    shifted[index] = vector[index]! - centroid[index]!;
  }
  const norm = Math.sqrt(shifted.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return shifted; // vecteur dégénéré (≈ centroïde) → cosinus 0 partout
  for (let index = 0; index < shifted.length; index += 1) {
    shifted[index] = shifted[index]! / norm;
  }
  return shifted;
};

export interface CenteredSpace {
  /** Vecteurs recentrés, par item. */
  vectors: Map<string, Float32Array>;
  /** Centroïde du corpus — sert à recentrer une requête dans le même espace. */
  centroid: Float32Array;
}

/** Recentre tout le corpus : retire le fond sémantique commun avant toute comparaison. */
export const centerVectors = (vectors: ReadonlyMap<string, Float32Array>): CenteredSpace => {
  if (vectors.size === 0) return { vectors: new Map(), centroid: new Float32Array(0) };
  const dim = vectors.values().next().value!.length;
  const centroid = new Float32Array(dim);
  for (const vector of vectors.values()) {
    for (let index = 0; index < dim; index += 1) {
      centroid[index] = centroid[index]! + vector[index]! / vectors.size;
    }
  }
  const centered = new Map<string, Float32Array>();
  for (const [itemId, vector] of vectors) {
    centered.set(itemId, centerVector(vector, centroid));
  }
  return { vectors: centered, centroid };
};

const bigrams = (text: string): Set<string> => {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
};

export const diceCoefficient = (a: string, b: string): number => {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (gramsA.size + gramsB.size);
};

export const hybridScore = (
  vectorA: Float32Array | null,
  vectorB: Float32Array | null,
  nameA: string,
  nameB: string,
): number => {
  const semantic = vectorA && vectorB ? cosine(vectorA, vectorB) : 0;
  const lexical = diceCoefficient(nameA, nameB);
  const score = Math.max(semantic, lexical);
  // Veto de préfixe : le nom du produit vient au début du libellé — deux articles du même
  // produit partagent donc leur début. Un début très différent avec une longue queue commune
  // signale des produits distincts (ex. « Pâtes Coquillette au blé complet sachet de 500g » ~
  // « Pâtes Farfalle blé complet sachet 500g ») → score plafonné.
  const prefix = prefixScore(nameA, nameB);
  return prefix < PREFIX_VETO ? Math.min(score, prefix) : score;
};

/** Longueur du préfixe comparé (normalisé) pour le veto. */
export const PREFIX_LENGTH = 16;
/** Sous ce score de préfixe, les produits sont considérés distincts (veto). */
export const PREFIX_VETO = 0.5;

/** Similarité du début des libellés (premiers caractères normalisés, Dice). */
export const prefixScore = (a: string, b: string): number =>
  diceCoefficient(a.slice(0, PREFIX_LENGTH), b.slice(0, PREFIX_LENGTH));

export interface Suggestion {
  item: Item;
  score: number;
}

/**
 * Seuils calibrés sur données réelles (scripts/calibrate-similarity.mjs) : après recentrage, les
 * vrais doublons dépassent ~0.74 et le bruit sémantique retombe sous ~0.65. Seul faux positif
 * résiduel connu : les produits partageant littéralement un mot-clé (ex. « gel » / « sel » pour
 * lave-vaisselle) — impossible à séparer par le nom seul, l'UI le gère (aucune action automatique).
 */
export const SUGGESTION_THRESHOLD = 0.65;
/** Nombre maximum de suggestions affichées. */
export const SUGGESTION_TOP_K = 3;

/** Articles existants proches du nom saisi, triés par score décroissant. */
export const rankSuggestions = (
  queryName: string,
  queryVector: Float32Array | null,
  items: readonly Item[],
  vectors: ReadonlyMap<string, Float32Array>,
  threshold = SUGGESTION_THRESHOLD,
  topK = SUGGESTION_TOP_K,
): Suggestion[] => {
  const results: Suggestion[] = [];
  for (const item of items) {
    const score = hybridScore(queryVector, vectors.get(item.id) ?? null, queryName, item.name);
    if (score >= threshold) results.push({ item, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
};

export interface DuplicateGroup {
  /** Articles du groupe, triés par ordre de liste (le premier est le survivant de la fusion). */
  items: Item[];
  /** Meilleur score de similarité interne (lien le plus fort). */
  score: number;
}

/** Seuil (hybride) pour considérer deux articles comme pseudo-dupliqués. */
export const DUPLICATE_THRESHOLD = 0.7;

/**
 * Groupes d'articles potentiellement dupliqués : composantes connexes du graphe de similarité
 * (une arête = paire au-dessus du seuil) — 3 articles ou plus mutuellement proches forment un
 * seul groupe. Triés par score décroissant, articles triés par ordre de liste.
 */
export const findDuplicateGroups = (
  items: readonly Item[],
  vectors: ReadonlyMap<string, Float32Array>,
  threshold = DUPLICATE_THRESHOLD,
): DuplicateGroup[] => {
  const candidates: Array<{ item: Item; vector: Float32Array }> = [];
  for (const item of items) {
    const vector = vectors.get(item.id);
    if (vector) candidates.push({ item, vector });
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const { item } of candidates) parent.set(item.id, item.id);

  const links: Array<{ id: string; score: number }> = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const { item: a, vector: vectorA } = candidates[i]!;
      const { item: b, vector: vectorB } = candidates[j]!;
      const score = hybridScore(vectorA, vectorB, a.name, b.name);
      if (score >= threshold) {
        links.push({ id: a.id, score });
        parent.set(find(a.id), find(b.id));
      }
    }
  }

  const groupScores = new Map<string, number>();
  for (const link of links) {
    const root = find(link.id);
    const best = groupScores.get(root);
    if (best === undefined || link.score > best) groupScores.set(root, link.score);
  }

  const members = new Map<string, Item[]>();
  for (const { item } of candidates) {
    const root = find(item.id);
    const group = members.get(root);
    if (group) group.push(item);
    else members.set(root, [item]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, groupItems] of members) {
    if (groupItems.length < 2) continue;
    groups.push({
      items: [...groupItems].sort(compareItems),
      score: groupScores.get(root) ?? 0,
    });
  }
  return groups.sort((x, y) => y.score - x.score);
};
