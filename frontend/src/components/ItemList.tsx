// Liste filtrée + état vide. En mode fusion : cases à cocher au lieu des contrôles de quantité.
import type { Item } from "../entities/types";
import { ItemRow } from "./ItemRow";
import { BoxIcon } from "./icons";

export const ItemList = ({
  items,
  filtered,
  query,
  onAdjust,
  onOpenQuantity,
  onEdit,
  onAdd,
  mergeMode = false,
  selectedIds,
  onToggleSelect,
}: {
  items: Item[];
  filtered: boolean;
  query: string;
  onAdjust: (item: Item, delta: number) => void;
  onOpenQuantity: (item: Item) => void;
  onEdit: (item: Item) => void;
  onAdd: () => void;
  mergeMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (item: Item) => void;
}) => {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <BoxIcon size={40} />
        {filtered ? (
          <>
            <p>
              {query.trim() !== "" ? `Aucun résultat pour « ${query.trim()} ».` : "Aucun résultat."}
            </p>
            <button type="button" className="btn btn--ghost" onClick={onAdd}>
              Créer un produit
            </button>
          </>
        ) : (
          <>
            <p>Aucun produit pour l'instant.</p>
            <p className="empty-state-hint">
              Ajoute ton premier produit, ou scanne un code-barres depuis le téléphone.
            </p>
            <button type="button" className="btn btn--accent" onClick={onAdd}>
              Ajouter un produit
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <ul className="item-list">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          onAdjust={onAdjust}
          onOpenQuantity={onOpenQuantity}
          onEdit={onEdit}
          selectable={mergeMode}
          selected={selectedIds?.has(item.id) ?? false}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </ul>
  );
};
