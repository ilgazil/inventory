// Moteur de suggestions sémantiques (cf. SPECS.md § 9) : modèle d'embeddings exécuté dans le
// navigateur (transformers.js / ONNX Runtime WASM), activé explicitement via les paramètres.
// Poids self-hostés (public/models) + binaires wasm locaux (public/transformers) → 100 % offline
// après activation, aucune dépendance à un CDN au runtime.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { getMeta, setMeta } from "../db/meta";

export type SuggestState =
  | { status: "inactive" }
  | { status: "loading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string };

let state: SuggestState = { status: "inactive" };
const listeners = new Set<() => void>();

const setState = (next: SuggestState): void => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const subscribeSuggest = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSuggestState = (): SuggestState => state;

const MODEL_ID = "e5-small";
const ACTIVE_META_KEY = "suggestActive";

/** Entrées de Cache Storage à purger à la désactivation : poids du modèle + binaires wasm. */
const isModelAsset = (pathname: string): boolean =>
  pathname.startsWith("/models/") || pathname.includes("ort-wasm");

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/** Progression agrégée sur les fichiers en cours (poids + tokenizer). */
const downloadSizes = new Map<string, { loaded: number; total: number }>();
const reportProgress = (): void => {
  let loaded = 0;
  let total = 0;
  for (const entry of downloadSizes.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }
  if (total > 0) {
    setState({ status: "loading", progress: Math.min(100, Math.round((loaded / total) * 100)) });
  }
};

const loadPipeline = (): Promise<FeatureExtractionPipeline> => {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Poids self-hostés uniquement (public/models) ; les binaires wasm sont packagés par Vite
    // depuis node_modules (aucun CDN au runtime, offline garanti après activation).
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/models/";
    return (await pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (
          (info.status === "progress" || info.status === "download") &&
          info.file &&
          typeof info.loaded === "number" &&
          typeof info.total === "number"
        ) {
          downloadSizes.set(info.file, { loaded: info.loaded, total: info.total });
          reportProgress();
        }
      },
    })) as FeatureExtractionPipeline;
  })();
  return extractorPromise;
};

/** Au démarrage de l'app : recharge le pipeline depuis le cache si activé précédemment. */
export const initSuggest = async (): Promise<void> => {
  if (state.status !== "inactive") return;
  if (!(await getMeta<boolean>(ACTIVE_META_KEY))) return;
  setState({ status: "loading", progress: 0 });
  try {
    await loadPipeline();
    setState({ status: "ready" });
  } catch (error) {
    extractorPromise = null;
    setState({
      status: "error",
      message: error instanceof Error ? error.message : "Modèle indisponible.",
    });
  }
};

/** Activation explicite : télécharge les poids une fois (progression suivie), puis prêt. */
export const activateSuggest = async (): Promise<void> => {
  if (state.status === "loading" || state.status === "ready") return;
  downloadSizes.clear();
  setState({ status: "loading", progress: 0 });
  try {
    await loadPipeline();
    await setMeta(ACTIVE_META_KEY, true);
    setState({ status: "ready" });
  } catch (error) {
    extractorPromise = null;
    setState({
      status: "error",
      message:
        error instanceof Error ? error.message : "Téléchargement impossible. Vérifie la connexion.",
    });
  }
};

/** Désactivation : purge les poids du Cache Storage (service worker) et réinitialise l'état. */
export const deactivateSuggest = async (): Promise<void> => {
  if ("caches" in window) {
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) {
        if (isModelAsset(new URL(request.url).pathname)) {
          await cache.delete(request);
        }
      }
    }
  }
  await setMeta(ACTIVE_META_KEY, false);
  extractorPromise = null;
  downloadSizes.clear();
  setState({ status: "inactive" });
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * Vecteur d'un texte, normalisé. `query` pour la saisie en cours, `passage` pour les noms de la
 * base (préfixes requis par e5) ; les appels sont sérialisés (session wasm unique).
 */
export const embed = async (text: string, kind: "query" | "passage"): Promise<Float32Array> => {
  const task = async (): Promise<Float32Array> => {
    const extractor = await loadPipeline();
    const output = await extractor(`${kind}: ${text}`, { pooling: "mean", normalize: true });
    return new Float32Array(output.data as Float32Array);
  };
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};
