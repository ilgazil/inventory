// FABs mobile : scan (visible < 768 px uniquement, media query CSS) + ajout.
import { BarcodeIcon, PlusIcon } from "./icons";

export const Fabs = ({ onScan, onAdd }: { onScan: () => void; onAdd: () => void }) => (
  <div className="fabs">
    <button
      type="button"
      className="fab fab--scan"
      aria-label="Scanner un code-barres"
      title="Scanner un code-barres"
      onClick={onScan}
    >
      <BarcodeIcon size={26} />
    </button>
    <button type="button" className="fab fab--add" aria-label="Ajouter un produit" onClick={onAdd}>
      <PlusIcon size={26} />
    </button>
  </div>
);
