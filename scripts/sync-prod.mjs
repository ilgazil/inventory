#!/usr/bin/env node
// Copie le journal d'opérations d'un serveur distant (ex. la prod) vers le backend local :
// pull paginé sur la source, push par lots sur la cible (idempotent : uuid déjà connus ignorés).
// L'app locale reçoit ensuite tout via sa synchronisation normale (fold → état reconstruit).
//
// Usage :
//   node scripts/sync-prod.mjs https://mon-site.example.app [http://localhost:3000]
// Authentification des deux côtés : REMOTE_TOKEN / LOCAL_TOKEN en variable d'env, sinon
// le mot de passe est demandé de façon interactive (jamais affiché ni stocké).
import { createInterface } from "node:readline/promises";

const remoteUrl = process.argv[2]?.replace(/\/$/, "");
const localUrl = (process.argv[3] ?? "http://localhost:3000").replace(/\/$/, "");
const PULL_LIMIT = 500;
const PUSH_BATCH = 500;

if (!remoteUrl) {
  console.error("Usage : node scripts/sync-prod.mjs <URL source> [URL cible=localhost:3000]");
  process.exit(1);
}

const promptToken = async (label, url) => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const password = await readline.question(`${label} (mot de passe pour ${url}) : `);
  readline.close();
  const response = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    throw new Error(`Connexion impossible sur ${url} (HTTP ${response.status}).`);
  }
  return (await response.json()).token;
};

const authHeader = async (envVar, label, url) => {
  const token = process.env[envVar] ?? (await promptToken(label, url));
  return { Authorization: `Bearer ${token}` };
};

console.log(`Source : ${remoteUrl}`);
console.log(`Cible  : ${localUrl}`);

const remoteHeaders = await authHeader("REMOTE_TOKEN", "Mot de passe distant", remoteUrl);

console.log("Pull du journal distant…");
const ops = [];
let cursor = 0;
while (true) {
  const response = await fetch(`${remoteUrl}/api/sync/pull?cursor=${cursor}&limit=${PULL_LIMIT}`, {
    headers: remoteHeaders,
  });
  if (!response.ok) throw new Error(`Pull échoué (HTTP ${response.status}).`);
  const data = await response.json();
  ops.push(...data.ops);
  cursor = data.cursor;
  process.stdout.write(`\r${ops.length} opérations lues…`);
  if (data.ops.length < PULL_LIMIT) break;
}
console.log(`\n${ops.length} opérations récupérées.`);

if (ops.length === 0) {
  console.log("Rien à importer.");
  process.exit(0);
}

const localHeaders = { ...(await authHeader("LOCAL_TOKEN", "Mot de passe local", localUrl)), "Content-Type": "application/json" };

let accepted = 0;
let duplicated = 0;
for (let offset = 0; offset < ops.length; offset += PUSH_BATCH) {
  const batch = ops.slice(offset, offset + PUSH_BATCH);
  const response = await fetch(`${localUrl}/api/sync/push`, {
    method: "POST",
    headers: localHeaders,
    body: JSON.stringify({ ops: batch }),
  });
  if (!response.ok) {
    throw new Error(`Push échoué (HTTP ${response.status}) sur le lot ${offset / PUSH_BATCH + 1}.`);
  }
  const result = await response.json();
  accepted += result.accepted.length;
  duplicated += result.duplicated.length;
}

console.log(`Import terminé : ${accepted} opérations insérées, ${duplicated} déjà connues.`);
console.log("Recharge l'app locale : la synchronisation ramènera l'état complet.");
