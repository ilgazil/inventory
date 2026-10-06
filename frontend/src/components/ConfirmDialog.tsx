// Modale de confirmation générique (native <dialog>).
import { useDialog } from "./useDialog";

export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const dialogRef = useDialog(open, onCancel);

  return (
    <dialog ref={dialogRef} className="dialog dialog--confirm" aria-label={title}>
      <h2 className="dialog-title">{title}</h2>
      <p className="dialog-message">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "btn btn--danger" : "btn btn--accent"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
};
