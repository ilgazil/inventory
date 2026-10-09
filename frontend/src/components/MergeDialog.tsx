// Modale de fusion de produits pseudo-dupliqués (native <dialog>, validation native).
// Le premier produit de la liste est conservé (id + nom par défaut) ; les autres sont supprimés.
// Codes-barres cumulés automatiquement (multi-association), affichés en lecture seule.
import { useState } from "react";
import type { FormEvent } from "react";
import type { Item } from "../entities/types";
import { useDialog } from "./useDialog";

export interface MergeDraft {
  name: string;
  location: string;
  category: string;
  qty: number;
}

export const MergeDialog = ({
  open,
  items,
  locations,
  categories,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Produits fusionnés, ordre de la liste : le premier est conservé. */
  items: Item[];
  locations: string[];
  categories: string[];
  onClose: () => void;
  onConfirm: (draft: MergeDraft) => void;
}) => {
  const dialogRef = useDialog(open, onClose);
  // Le parent ne rend la modale qu'avec au moins 2 produits.
  const survivor = items[0]!;
  const absorbed = items.slice(1);

  const [name, setName] = useState(survivor.name);
  const [location, setLocation] = useState(survivor.location);
  const [category, setCategory] = useState(survivor.category);
  const [qty, setQty] = useState(String(items.reduce((total, item) => total + item.qty, 0)));

  const barcodes = [...new Set(items.flatMap((item) => item.barcodes))];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm({
      name: name.trim(),
      location: location.trim(),
      category: category.trim(),
      qty: Math.max(0, Math.floor(Number(qty) || 0)),
    });
  };

  return (
    <dialog ref={dialogRef} className="dialog dialog--form" aria-label="Fusionner des produits">
      <form onSubmit={handleSubmit}>
        <h2 className="dialog-title">Fusionner {items.length} produits</h2>

        <p className="merge-summary">
          « {survivor.name} » est conservé
          {absorbed.length > 0 && (
            <> et absorbe {absorbed.map((item) => `« ${item.name} »`).join(", ")}.</>
          )}
        </p>

        {barcodes.length > 0 && (
          <div className="merge-barcodes">
            <span className="field-label">Codes-barres cumulés</span>
            <ul className="merge-barcodes-list">
              {barcodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="field">
          <span className="field-label">Nom</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={256}
            autoComplete="off"
            autoFocus
            enterKeyHint="done"
          />
        </label>

        <label className="field">
          <span className="field-label">Emplacement</span>
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={64}
            list="merge-datalist-locations"
            autoComplete="off"
          />
          <datalist id="merge-datalist-locations">
            {locations.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span className="field-label">Catégorie</span>
          <input
            type="text"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={64}
            list="merge-datalist-categories"
            autoComplete="off"
          />
          <datalist id="merge-datalist-categories">
            {categories.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span className="field-label">Quantité (somme des produits fusionnés)</span>
          <input
            type="number"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            min={0}
            step={1}
            required
            inputMode="numeric"
          />
        </label>

        <div className="dialog-actions dialog-actions--split">
          <span className="dialog-actions-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn--accent">
            Fusionner
          </button>
        </div>
      </form>
    </dialog>
  );
};
