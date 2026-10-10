#!/usr/bin/env node
// Calibration des seuils de similarité sur les données réelles : lit les opérations du backend
// local, reconstruit les noms des items, les vectorise (e5-small) et mesure la distribution des
// scores de toutes les paires — pour choisir des seuils en connaissance de cause.
//
// Usage : node --env-file=.env scripts/calibrate-similarity.mjs
// (le modèle d'embeddings vit dans frontend/public/models — chargé via chemin explicite)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "..", "frontend");

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

// Le package transformers est installé côté frontend (résolution par chemin explicite — ses
// dépendances se résolvent depuis frontend/node_modules).
const transformers = await import(
  path.join(frontend, "node_modules", "@huggingface/transformers", "dist", "transformers.node.mjs")
);

const envConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// ------------------------------------------------------------------ fold (noms uniquement)

/** Rejoue le journal : nom courant + tombstones (LWW sur le champ name, cf. frontend fold.ts). */
const foldNames = (ops) => {
  const items = new Map();
  const compare = (a, b) =>
    a.hlc.localeCompare(b.hlc) || a.device_id.localeCompare(b.device_id) || a.uuid.localeCompare(b.uuid);
  for (const op of [...ops].sort(compare)) {
    const item = items.get(op.entity_id);
    if (op.type === "item.create") {
      if (item) continue;
      items.set(op.entity_id, {
        name: (op.payload.name ?? "").trim(),
        deleted: false,
        nameHlc: op.hlc,
      });
    } else if (op.type === "item.set" && op.payload.field === "name") {
      if (!item || item.deleted) continue;
      if (op.hlc > item.nameHlc) {
        item.name = op.payload.value.trim();
        item.nameHlc = op.hlc;
      }
    } else if (op.type === "item.delete") {
      if (item) item.deleted = true;
    }
  }
  return [...items.values()].filter((item) => !item.deleted && item.name !== "");
};

// ------------------------------------------------------------------ scores (cf. suggest/score.ts)

const normalizeText = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const bigrams = (text) => {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  const grams = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
};

const dice = (a, b) => {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) intersection += 1;
  return (2 * intersection) / (gramsA.size + gramsB.size);
};

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

// ------------------------------------------------------------------ mesures

const pool = mysql.createPool(envConfig);
const [rows] = await pool.query("SELECT uuid, device_id, hlc, type, entity_id, payload FROM ops");
await pool.end();

const items = foldNames(rows);
console.log(`${items.length} items actifs — vectorisation en cours…`);

const { pipeline, env } = transformers;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(frontend, "public", "models") + path.sep;
const extractor = await pipeline("feature-extraction", "e5-small", { dtype: "q8", device: "cpu" });

// Deux variantes d'embedding : avec le préfixe e5 (contrat du modèle) et sans (sur des textes
// courts, le préfixe commun peut gonfler artificiellement tous les cosinus). Test aussi du
// recentrage : soustraire le centroïde des vecteurs élimine le fond sémantique commun au domaine
// (tous les produits partagent un contexte qui gonfle les cosinus vers le haut).
const embedAll = async (texts) => {
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
};
const centerVectors = (vectors) => {
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vector of vectors) for (let d = 0; d < dim; d += 1) centroid[d] += vector[d] / vectors.length;
  return vectors.map((vector) => {
    const centered = vector.map((value, d) => value - centroid[d]);
    const norm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
    return centered.map((value) => value / norm);
  });
};
const variants = {
  "avec préfixe e5 (passage:)": await embedAll(items.map((item) => `passage: ${item.name}`)),
  "avec préfixe + recentrage": centerVectors(await embedAll(items.map((item) => `passage: ${item.name}`))),
  "sans préfixe": await embedAll(items.map((item) => item.name)),
  "sans préfixe + recentrage": centerVectors(await embedAll(items.map((item) => item.name))),
};

// Paires de référence pour évaluer la séparabilité de chaque variante.
const REFERENCES = [
  { a: "Liquide vaisselle citron", b: "Liquide vaisselle lavande", expect: true },
  { a: "Liquide vaisselle citron", b: "Liquide vaisselle", expect: true },
  { a: "Liquide vaisselle", b: "Liquide de rinçage", expect: false },
  { a: "Gel concentré lave vaisselle", b: "sel régénérant lave vaisselle", expect: false },
  { a: "Sanytol désinfectant", b: "Sanytol lessive", expect: false },
  { a: "Cream cleanser", b: "Lessive Ariel", expect: false },
];

const pairsOf = (vectors) => {
  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const semantic = dot(vectors[i], vectors[j]);
      const lexical = dice(items[i].name, items[j].name);
      const prefix = dice(items[i].name.slice(0, 16), items[j].name.slice(0, 16));
      const hybrid = prefix < 0.5 ? Math.min(Math.max(semantic, lexical), prefix) : Math.max(semantic, lexical);
      pairs.push({ a: items[i].name, b: items[j].name, semantic, lexical, prefix, hybrid });
    }
  }
  return pairs.sort((x, y) => y.hybrid - x.hybrid);
};

for (const [label, vectors] of Object.entries(variants)) {
  const pairs = pairsOf(vectors);
  const quantile = (q) => pairs[Math.floor((pairs.length - 1) * q)].hybrid;
  console.log(`\n=== ${label} ===`);
  console.log(
    `  plancher ${quantile(1).toFixed(3)}  p25 ${quantile(0.75).toFixed(3)}  médiane ${quantile(0.5).toFixed(3)}  p90 ${quantile(0.1).toFixed(3)}  max ${quantile(0).toFixed(3)}`,
  );
  for (const threshold of [0.85, 0.9, 0.92, 0.94, 0.95]) {
    const count = pairs.filter((pair) => pair.hybrid >= threshold).length;
    console.log(`  seuil ${threshold.toFixed(2)} : ${String(count).padStart(3)} paires (${Math.round((100 * count) / pairs.length)} %)`);
  }
  console.log("  Paires de référence (vrai = doublon attendu) :");
  for (const reference of REFERENCES) {
    const pair = pairs.find((p) => (p.a === reference.a && p.b === reference.b) || (p.a === reference.b && p.b === reference.a));
    if (pair) {
      console.log(`    ${reference.expect ? "VRAI " : "FAUX "} sem ${pair.semantic.toFixed(3)}  lex ${pair.lexical.toFixed(3)}  « ${pair.a} » ~ « ${pair.b} »`);
    }
  }
}

const pairs = pairsOf(variants["avec préfixe + recentrage"]);

console.log(`\n${items.length} items, ${pairs.length} paires — détail de la variante « préfixe + recentrage » :`);
console.log("Top 30 :");
for (const pair of pairs.slice(0, 30)) {
  console.log(
    `  hybride ${pair.hybrid.toFixed(3)} (sem ${pair.semantic.toFixed(3)}, lex ${pair.lexical.toFixed(3)})  « ${pair.a} » ~ « ${pair.b} »`,
  );
}
const above = (threshold) => pairs.filter((pair) => pair.hybrid >= threshold).length;
console.log("\nPaires au-dessus des seuils candidats :");
for (const threshold of [0.6, 0.65, 0.7, 0.72, 0.75, 0.8, 0.85]) {
  console.log(`  ${threshold.toFixed(2)} : ${String(above(threshold)).padStart(3)} paires (${Math.round((100 * above(threshold)) / pairs.length)} %)`);
}
