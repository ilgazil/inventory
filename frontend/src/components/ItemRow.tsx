// Ligne d'inventaire : nom + méta cliquables (→ modale quantité), contrôles +/− (≥ 768 px, CSS),
// crayon d'édition.
import type { Item } from "../entities/types";
import { MinusIcon, PencilIcon, PlusIcon } from "./icons";

export const ItemRow = ({
  item,
  onAdjust,
  onOpenQuantity,
  onEdit,
}: {
  item: Item;
  onAdjust: (item: Item, delta: number) => void;
  onOpenQuantity: (item: Item) => void;
  onEdit: (item: Item) => void;
}) => {
  const meta = [item.location, item.category].filter(Boolean).join(" · ");

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
