// Modale création/édition d'item (native <dialog>, validation de formulaire native).
// Édition → une op item.set par champ modifié (diff fait par le parent).
// En création : suggestions d'articles existants similaires (moteur sémantique, § 9) avec
// fusion à la volée — l'article existant absorbe le code-barres scanné, puis modale quantité.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Item } from "../entities/types";
import type { Suggestion } from "../suggest/score";
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

const SUGGESTION_DEBOUNCE_MS = 400;
const SUGGESTION_MIN_LENGTH = 3;

export const ItemFormDialog = ({
  open,
  item,
  prefill,
  locations,
  categories,
  findSuggestions,
  onMergeWith,
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
  /** Suggestions d'articles existants (moteur activé uniquement — absent sinon). */
  findSuggestions?: (name: string) => Promise<Suggestion[]>;
  /** Choix d'une suggestion : l'existant absorbe le code-barres, puis modale quantité. */
  onMergeWith?: (existing: Item, barcode: string) => void;
  onClose: () => void;
  onSave: (draft: ItemDraft) => void;
  onDelete?: () => void;
}) => {
  const dialogRef = useDialog(open, onClose);
  const isCreate = item === null;
  const barcodes = item?.barcodes ?? (prefill?.barcode !== undefined ? [prefill.barcode] : []);

  const [name, setName] = useState(item?.name ?? prefill?.name ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreate || !findSuggestions) return undefined;
    if (name.trim().length < SUGGESTION_MIN_LENGTH) {
      setSuggestions([]);
      setExpandedId(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      findSuggestions(name)
        .then((results) => {
          setSuggestions(results);
          setExpandedId(null);
        })
        .catch(() => setSuggestions([]));
    }, SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [name, isCreate, findSuggestions]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ name: name.trim(), location: location.trim(), category: category.trim() });
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--form"
      aria-label={isCreate ? "Nouveau produit" : `Modifier ${item?.name}`}
    >
      <form onSubmit={handleSubmit}>
        <h2 className="dialog-title">{isCreate ? "Nouveau produit" : "Modifier le produit"}</h2>

        {barcodes.length > 0 && (
          <p className="form-barcode">
            {barcodes.length > 1 ? "Codes-barres\u00a0: " : "Code-barres\u00a0: "}
            {barcodes.map((code) => (
              <code key={code}>{code}</code>
            ))}
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

        {suggestions.length > 0 && (
          <div className="suggestions" aria-label="Articles similaires">
            <span className="suggestions-title">Articles similaires</span>
            {suggestions.map(({ item: existing, score }) =>
              expandedId === existing.id ? (
                <div key={existing.id} className="suggestion-detail">
                  <span className="suggestion-name">{existing.name}</span>
                  <span className="suggestion-meta">
                    {[
                      existing.location,
                      existing.category,
                      `${existing.qty} en stock`,
                      `similarité ${Math.round(score * 100)} %`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {existing.barcodes.length > 0 && (
                    <span className="suggestion-meta">Codes : {existing.barcodes.join(", ")}</span>
                  )}
                  <div className="suggestion-actions">
                    <button
                      type="button"
                      className="btn btn--accent"
                      onClick={() => onMergeWith?.(existing, prefill?.barcode ?? "")}
                    >
                      Ajouter à cet article
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setExpandedId(null)}
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  key={existing.id}
                  type="button"
                  className="suggestion"
                  onClick={() => setExpandedId(existing.id)}
                >
                  <span className="suggestion-name">{existing.name}</span>
                  <span className="suggestion-meta">
                    {[existing.location, existing.category, `${existing.qty} en stock`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="suggestion-score">{Math.round(score * 100)} %</span>
                </button>
              ),
            )}
          </div>
        )}

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
