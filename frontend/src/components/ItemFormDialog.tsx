// Modale création/édition d'item (native <dialog>, validation de formulaire native).
// Édition → une op item.set par champ modifié (diff fait par le parent).
import { useState } from "react";
import type { FormEvent } from "react";
import type { Item } from "../entities/types";
import { TrashIcon } from "./icons";
import { useDialog } from "./useDialog";

export interface ItemDraft {
  name: string;
  location: string;
  category: string;
}

const SOURCE_LABELS: Record<string, string> = {
  openfoodfacts: "Trouvé sur Open Food Facts",
  openproductsfacts: "Trouvé sur Open Products Facts",
};

export const ItemFormDialog = ({
  open,
  item,
  prefill,
  locations,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  /** null = création ; Item = édition. */
  item: Item | null;
  prefill: { name?: string; barcode?: string; source?: string } | null;
  locations: string[];
  categories: string[];
  onClose: () => void;
  onSave: (draft: ItemDraft) => void;
  onDelete?: () => void;
}) => {
  const dialogRef = useDialog(open, onClose);
  const isCreate = item === null;
  const barcode = item?.barcode ?? prefill?.barcode ?? "";

  const [name, setName] = useState(item?.name ?? prefill?.name ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [category, setCategory] = useState(item?.category ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ name: name.trim(), location: location.trim(), category: category.trim() });
  };

  return (
    <dialog ref={dialogRef} className="dialog dialog--form" aria-label={isCreate ? "Nouveau produit" : `Modifier ${item?.name}`}>
      <form onSubmit={handleSubmit}>
        <h2 className="dialog-title">{isCreate ? "Nouveau produit" : "Modifier le produit"}</h2>

        {barcode !== "" && (
          <p className="form-barcode">
            Code-barres&nbsp;: <code>{barcode}</code>
            {prefill?.source && <span className="form-barcode-source">{SOURCE_LABELS[prefill.source] ?? ""}</span>}
          </p>
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
            placeholder="Ex. : Lessic Pur"
          />
        </label>

        <label className="field">
          <span className="field-label">Emplacement</span>
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={64}
            list="datalist-locations"
            autoComplete="off"
            placeholder="Ex. : Cave"
          />
          <datalist id="datalist-locations">
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
            list="datalist-categories"
            autoComplete="off"
            placeholder="Ex. : Ménage"
          />
          <datalist id="datalist-categories">
            {categories.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>

        <div className="dialog-actions dialog-actions--split">
          {!isCreate && onDelete && (
            <button type="button" className="btn btn--danger-ghost" onClick={onDelete}>
              <TrashIcon size={16} />
              <span>Supprimer</span>
            </button>
          )}
          <span className="dialog-actions-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn--accent">
            Enregistrer
          </button>
        </div>
      </form>
    </dialog>
  );
};
