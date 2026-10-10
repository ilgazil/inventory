import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { App } from "./App";
import { receiveRemoteOps, rebuildProjection } from "./db/repo";
import { ensureEmbeddings } from "./suggest/cache";
import type { Op } from "./entities/types";

const container = document.getElementById("root");
if (!container) throw new Error("Élément #root introuvable");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : production uniquement (cf. SPECS.md § 8).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

// Outil dev : import du journal d'ops d'un serveur distant comme jeu de test
// (fichier produit par scripts/export-remote-ops.mjs). N'existe pas en production.
declare global {
  interface Window {
    __inventory?: { importOps: (ops: Op[]) => Promise<number> };
  }
}

if (import.meta.env.DEV) {
  window.__inventory = {
    importOps: async (ops: Op[]): Promise<number> => {
      if (!Array.isArray(ops) || ops.length === 0) throw new Error("Aucune opération à importer.");
      await receiveRemoteOps(ops);
      await rebuildProjection();
      void ensureEmbeddings();
      return ops.length;
    },
  };
}
