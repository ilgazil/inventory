// Modale quantité (native <dialog>) : gros boutons − / +, maintien appuyé = répétition,
// validation d'un seul item.adjust du delta total (cf. SPECS.md § 6.3).
import { useEffect, useRef, useState } from "react";
import type { Item } from "../entities/types";
import { MinusIcon, PlusIcon } from "./icons";
import { useDialog } from "./useDialog";

export const QuantityDialog = ({
  item,
  onClose,
  onValidate,
}: {
  item: Item | null;
  onClose: () => void;
  onValidate: (item: Item, delta: number) => void;
}) => {
  const open = item !== null;
  const dialogRef = useDialog(open, onClose);
  const [qty, setQty] = useState(() => item?.qty ?? 0);

  // Répétition au maintien : pas d'action pendant 350 ms, puis 120 ms par pas.
  const holdRef = useRef<{ timer: number | null; didHold: boolean }>({ timer: null, didHold: false });

  const stopHold = () => {
    if (holdRef.current.timer !== null) {
      clearTimeout(holdRef.current.timer);
      holdRef.current.timer = null;
    }
  };

  useEffect(() => stopHold, []);

  useEffect(() => {
    if (!open) stopHold();
  }, [open]);

  const step = (delta: number) => setQty((value) => Math.max(0, value + delta));

  const startHold = (delta: number) => () => {
    holdRef.current.didHold = false;
    holdRef.current.timer = window.setTimeout(() => {
      holdRef.current.didHold = true;
      holdRef.current.timer = window.setInterval(() => step(delta), 120);
    }, 350);
  };

  const endHold = () => stopHold();

  const clickStep = (delta: number) => () => {
    if (!holdRef.current.didHold) step(delta);
  };

  if (item === null) {
    return (
      <dialog ref={dialogRef} className="dialog dialog--quantity">
        <div />
      </dialog>
    );
  }

  const delta = qty - item.qty;

  return (
    <dialog ref={dialogRef} className="dialog dialog--quantity" aria-label={`Quantité de ${item.name}`}>
      <h2 className="dialog-title">{item.name}</h2>

      <div className="quantity-controls" role="group" aria-label="Ajuster la quantité">
        <button
          type="button"
          className="btn-step btn-step--big"
          aria-label="Retirer un"
          disabled={qty === 0}
          onPointerDown={startHold(-1)}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onClick={clickStep(-1)}
        >
          <MinusIcon size={30} />
        </button>
        <span className="quantity-value" aria-live="polite">
          {qty}
        </span>
        <button
          type="button"
          className="btn-step btn-step--big"
          aria-label="Ajouter un"
          onPointerDown={startHold(1)}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onClick={clickStep(1)}
        >
          <PlusIcon size={30} />
        </button>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="btn btn--accent"
          onClick={() => (delta !== 0 ? onValidate(item, delta) : onClose())}
        >
          Valider{delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ""}
        </button>
      </div>
    </dialog>
  );
};
