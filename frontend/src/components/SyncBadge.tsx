// Badge de synchronisation (cf. SPECS.md § 5.3) : état moteur + compteur d'ops en attente (Dexie live).
import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db } from "../db/db";
import { getSyncSnapshot, subscribeSync } from "../sync/engine";
import { AlertIcon, SyncIcon } from "./icons";

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const SyncBadge = ({ onClick }: { onClick: () => void }) => {
  const snapshot = useSyncExternalStore(subscribeSync, getSyncSnapshot);
  const pending = useLiveQuery(() => db.ops.where("synced").equals(0).count(), [], 0) ?? 0;

  const { state, lastSyncAt } = snapshot;
  const effectiveState =
    state === "synced" && pending > 0 ? "pending" : state === "idle" && !lastSyncAt ? "idle" : state;

  const label = (() => {
    switch (effectiveState) {
      case "syncing":
        return "Synchronisation…";
      case "pending":
        return `${pending} à synchroniser`;
      case "offline":
        return "Hors ligne";
      case "error":
        return "Échec de synchronisation";
      case "auth-expired":
        return "Session expirée";
      case "synced":
        return `Synchronisé ${lastSyncAt ? formatTime(lastSyncAt) : ""}`.trim();
      default:
        return "Prêt";
    }
  })();

  const tooltip = (() => {
    switch (effectiveState) {
      case "auth-expired":
        return "Reconnecte-toi pour synchroniser (l'inventaire local reste utilisable).";
      case "offline":
        return "Pas de connexion — tout est enregistré localement, la sync reprendra automatiquement.";
      case "error":
        return "Le serveur n'a pas répondu. Nouvelle tentative au prochain déclencheur (ou clic).";
      default:
        return "Cliquer pour synchroniser maintenant.";
    }
  })();

  return (
    <button
      type="button"
      className={`sync-badge sync-badge--${effectiveState}`}
      onClick={onClick}
      title={tooltip}
    >
      {effectiveState === "auth-expired" || effectiveState === "error" ? (
        <AlertIcon size={16} />
      ) : (
        <SyncIcon size={16} className={effectiveState === "syncing" ? "spin" : undefined} />
      )}
      <span>{label}</span>
    </button>
  );
};
