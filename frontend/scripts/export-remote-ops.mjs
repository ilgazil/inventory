// Exporte le journal d'opérations d'un serveur distant (ex. la prod) vers
// `public/remote-ops.json`, consommable par le hook dev `window.__inventory.importOps`
// (cf. src/main.tsx) pour fournir un jeu de test réel à l'environnement local.
//
// Usage :
//   node scripts/export-remote-ops.mjs https://mon-inventaire.example.org
//   (mot de passe demandé de façon interactive — ou REMOTE_PASSWORD en variable d'env)
//   Avec un jeton déjà connu : REMOTE_TOKEN=xxx node scripts/export-remote-ops.mjs <URL>
import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "public", "remote-ops.json");
const PULL_LIMIT = 200;

const baseUrl = process.argv[2]?.replace(/\/$/, "");
if (!baseUrl) {
  console.error("Usage : node scripts/export-remote-ops.mjs <URL du serveur distant>");
  process.exit(1);
}

const resolveToken = async () => {
  if (process.env.REMOTE_TOKEN) return process.env.REMOTE_TOKEN;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const password = process.env.REMOTE_PASSWORD ?? (await readline.question("Mot de passe : "));
  readline.close();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    throw new Error(`Connexion impossible (HTTP ${response.status}) — mot de passe ou URL invalide.`);
  }
  const data = await response.json();
  return data.token;
};

const token = await resolveToken();

const ops = [];
let cursor = 0;
while (true) {
  const response = await fetch(`${baseUrl}/api/sync/pull?cursor=${cursor}&limit=${PULL_LIMIT}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Pull échoué (HTTP ${response.status}).`);
  const data = await response.json();
  ops.push(...data.ops);
  cursor = data.cursor;
  if (data.ops.length < PULL_LIMIT) break;
}

await writeFile(outPath, `${JSON.stringify(ops, null, 2)}\n`);
console.log(`${ops.length} opérations exportées vers public/remote-ops.json`);
console.log("Dans l'app locale (console du navigateur) : await __inventory.importOps()");
