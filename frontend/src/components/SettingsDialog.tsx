// Modale de paramètres : état du moteur de suggestions sémantiques (activé = poids du modèle
// en cache, disponible hors ligne), activation avec progression du téléchargement, désactivation
// avec purge du cache.
import { useSyncExternalStore } from "react";
import { activateSuggest, deactivateSuggest, getSuggestState, subscribeSuggest } from "../suggest/engine";
import { useDialog } from "./useDialog";

export const SettingsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const dialogRef = useDialog(open, onClose);
  const suggest = useSyncExternalStore(subscribeSuggest, getSuggestState);

  return (
    <dialog ref={dialogRef} className="dialog dialog--form" aria-label="Paramètres">
      <h2 className="dialog-title">Paramètres</h2>

      <section className="settings-section">
        <h3 className="settings-subtitle">Suggestions intelligentes</h3>
        <p className="settings-hint">
          Compare les produits par similarité sémantique : suggestions d'articles similaires à la
          création et détection de doublons. Le modèle (118 Mo) se télécharge une fois, puis
          fonctionne hors ligne.
        </p>

        {suggest.status === "inactive" && (
          <>
            <p className="settings-status">Désactivé.</p>
            <button type="button" className="btn btn--accent" onClick={() => void activateSuggest()}>
              Activer
            </button>
          </>
        )}

        {suggest.status === "loading" && (
          <>
            <p className="settings-status" role="status">
              Téléchargement du modèle… {suggest.progress}&nbsp;%
            </p>
            <div
              className="progress-bar"
              role="progressbar"
              aria-valuenow={suggest.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="progress-fill" style={{ width: `${suggest.progress}%` }} />
            </div>
          </>
        )}

        {suggest.status === "ready" && (
          <>
            <p className="settings-status settings-status--ok">
              Activé — le modèle est en cache et disponible hors ligne.
            </p>
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={() => void deactivateSuggest()}
            >
              Désactiver (supprimer le modèle)
            </button>
          </>
        )}

        {suggest.status === "error" && (
          <>
            <p className="settings-status settings-status--error">{suggest.message}</p>
            <button type="button" className="btn btn--accent" onClick={() => void activateSuggest()}>
              Réessayer
            </button>
          </>
        )}
      </section>

      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    </dialog>
  );
};
