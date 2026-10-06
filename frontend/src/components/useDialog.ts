// Ouverture/fermeture d'un <dialog> natif pilotée par l'état React.
// Esc (cancel) et clic sur le backdrop = annulation → onClose.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export const useDialog = (
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDialogElement | null> => {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleCancel = (event: Event) => {
      // Esc : on pilote la fermeture via l'état (open → false referme via l'effet ci-dessus).
      event.preventDefault();
      onCloseRef.current();
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target === element) onCloseRef.current();
    };
    element.addEventListener("cancel", handleCancel);
    element.addEventListener("click", handleClick);
    return () => {
      element.removeEventListener("cancel", handleCancel);
      element.removeEventListener("click", handleClick);
    };
  }, []);

  return ref;
};
