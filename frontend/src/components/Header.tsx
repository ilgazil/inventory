// En-tête : titre, badge de sync, paramètres, recherche, ajout (desktop). Responsive CSS pur.
import type { FormEvent } from "react";
import { SyncBadge } from "./SyncBadge";
import { PlusIcon, SettingsIcon } from "./icons";

export const Header = ({
  query,
  onQueryChange,
  onAdd,
  onBadgeClick,
  onSettings,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  onBadgeClick: () => void;
  onSettings: () => void;
}) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault();

  return (
    <header className="app-header">
      <div className="app-header-top">
        <h1>Inventaire</h1>
        <div className="app-header-actions">
          <SyncBadge onClick={onBadgeClick} />
          <button
            type="button"
            className="header-settings"
            aria-label="Paramètres"
            title="Paramètres"
            onClick={onSettings}
          >
            <SettingsIcon size={20} />
          </button>
          <button type="button" className="btn btn--accent header-add" onClick={onAdd}>
            <PlusIcon size={18} />
            <span>Ajouter</span>
          </button>
        </div>
      </div>
      <form className="search" role="search" onSubmit={handleSubmit}>
        <input
          type="search"
          className="search-input"
          placeholder="Rechercher un produit, un emplacement, un code-barres…"
          aria-label="Rechercher dans l'inventaire"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </form>
    </header>
  );
};
