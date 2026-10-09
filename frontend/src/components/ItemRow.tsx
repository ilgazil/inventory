// Ligne d'inventaire : nom + méta cliquables (→ modale quantité), contrôles +/− (≥ 768 px, CSS),
// crayon d'édition. En mode fusion : case à cocher, le tap sélectionne.
import type { Item } from "../entities/types";
import { MinusIcon, PencilIcon, PlusIcon } from "./icons";

export const ItemRow = ({
  item,
  onAdjust,
  onOpenQuantity,
  onEdit,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  item: Item;
  onAdjust: (item: Item, delta: number) => void;
  onOpenQuantity: (item: Item) => void;
  onEdit: (item: Item) => void;
  /** Mode fusion : remplace quantité/édition par une case à cocher de sélection. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: Item) => void;
}) => {
  const meta = [item.location, item.category].filter(Boolean).join(" · ");

  if (selectable) {
    return (
      <li
        className={`item-row item-row--select${selected ? " item-row--selected" : ""}`}
        onClick={() => onToggleSelect?.(item)}
      >
        <input
          type="checkbox"
          className="item-check"
          checked={selected}
          onChange={() => onToggleSelect?.(item)}
          // La checkbox gère son propre toggle (onChange) : on évite le double déclenchement
          // par le clic porté par la ligne.
          onClick={(event) => event.stopPropagation()}
          aria-label={`Sélectionner ${item.name}`}
        />
        <span className="item-main">
          <span className="item-name">{item.name}</span>
          {meta !== "" && <span className="item-meta">{meta}</span>}
        </span>
      </li>
    );
  }

  return (
    <li className="item-row">
      <button type="button" className="item-main" onClick={() => onOpenQuantity(item)}>
        <span className="item-name">{item.name}</span>
        {meta !== "" && <span className="item-meta">{meta}</span>}
      </button>

      <span className="item-qty" role="group" aria-label={`Quantité de ${item.name}`}>
        <button
          type="button"
          className="btn-step btn-step--dec"
          aria-label={`Retirer un ${item.name}`}
          disabled={item.qty === 0}
          onClick={() => onAdjust(item, -1)}
        >
          <MinusIcon size={16} />
        </button>
        <span className="item-qty-value" aria-live="polite">
          {item.qty}
        </span>
        <button
          type="button"
          className="btn-step btn-step--inc"
          aria-label={`Ajouter un ${item.name}`}
          onClick={() => onAdjust(item, 1)}
        >
          <PlusIcon size={16} />
        </button>
      </span>

      <button
        type="button"
        className="item-edit"
        aria-label={`Modifier ${item.name}`}
        title="Modifier"
        onClick={() => onEdit(item)}
      >
        <PencilIcon size={16} />
      </button>
    </li>
  );
};
