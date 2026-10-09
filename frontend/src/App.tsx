// Racine : initialisation du dépôt local (deviceId + horloge HLC) puis phase d'affichage.
import { useEffect, useRef, useState } from "react";
import { getToken } from "./api/client";
import { initRepo } from "./db/repo";
import { startEngine } from "./sync/engine";
import { InventoryView } from "./views/InventoryView";
import { LoginView } from "./views/LoginView";

type Phase = "loading" | "login" | "ready";

export const App = () => {
  const [phase, setPhase] = useState<Phase>(() => (getToken() === null ? "login" : "loading"));
  const initRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    initRef.current = initRepo()
      .then(() => startEngine())
      .then(() => {
        // Session déjà présente au chargement : l'init terminée, on entre dans l'inventaire
        // (le splashscreen ne doit jamais rester bloqué ; token expiré → badge "Session expirée").
        if (getToken() !== null) setPhase("ready");
      });
  }, []);

  if (phase === "loading") {
    return (
      <div className="splash" role="status" aria-label="Chargement">
        <span className="splash-mark" aria-hidden="true">
          ||||| |\ |||
        </span>
        <p>Inventaire</p>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <main className="login-page">
        <LoginView
          onSuccess={() => {
            // On n'entre dans l'inventaire qu'une fois le dépôt local initialisé.
            void initRef.current?.then(() => setPhase("ready"));
          }}
        />
      </main>
    );
  }

  return <InventoryView />;
};
