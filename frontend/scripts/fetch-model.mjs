// Télécharge les poids du modèle d'embeddings (ignorés par git). À exécuter une fois en local
// (`npm run fetch-model`) — le déploiement publie ensuite ces fichiers en static (servis par le
// backend, mis en cache par le service worker). Les binaires wasm d'ONNX Runtime sont, eux,
// packagés par Vite depuis node_modules (aucun téléchargement manuel).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelsDir = path.join(root, "public", "models", "e5-small");

const MODEL_BASE = "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/";

// Fichiers du modèle (variante int8 : `model_quantized.onnx`, ~118 Mo).
const MODEL_FILES = [
  { remote: "onnx/model_quantized.onnx", local: "onnx/model_quantized.onnx" },
  { remote: "config.json", local: "config.json" },
  { remote: "tokenizer.json", local: "tokenizer.json" },
  { remote: "tokenizer_config.json", local: "tokenizer_config.json" },
  { remote: "special_tokens_map.json", local: "special_tokens_map.json" },
];

const download = async (remote, dest) => {
  process.stdout.write(`Téléchargement ${remote}… `);
  const response = await fetch(`${MODEL_BASE}${remote}`, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${remote}`);
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, body);
  console.log(`ok (${(body.length / 1_000_000).toFixed(1)} Mo)`);
};

for (const { remote, local } of MODEL_FILES) {
  await download(remote, path.join(modelsDir, local));
}
console.log("Modèle prêt dans public/models/e5-small/");
