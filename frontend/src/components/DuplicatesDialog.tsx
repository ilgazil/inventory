// Modale de détection de doublons : groupes d'articles similaires (composantes connexes du
// graphe de similarité, cf. § 9) — calculés en mémoire à partir des vecteurs en cache, rien
// n'est modifié sans action explicite.
import type { Item } from "../entities/types";
import type { DuplicateGroup } from "../suggest/score";
import { useDialog } from "./useDialog";

const sideMeta = (item: Item): string =>
  [
    item.location || "sans emplacement",
    item.category || "sans catégorie",
    `${item.qty} en stock`,
  ].join(" · ");

const DuplicateSide = ({ item }: { item: Item }) => (
  <div className="duplicate-side">
    <span className="duplicate-name">{item.name}</span>
    <span className="duplicate-meta">{sideMeta(item)}</span>
  </div>
);

export const DuplicatesDialog = ({
  open,
  groups,
  onClose,
  onMergeGroup,
}: {
  open: boolean;
  groups: DuplicateGroup[];
  onClose: () => void;
  onMergeGroup: (group: DuplicateGroup) => void;
}) => {
  const dialogRef = useDialog(open, onClose);

  return (
    <dialog ref={dialogRef} className="dialog dialog--form" aria-label="Doublons potentiels">
      <h2 className="dialog-title">Doublons potentiels</h2>

      {groups.length === 0 ? (
        <p className="merge-summary">
          Aucun doublon détecté pour l'instant. Les suggestions s'affinent avec les nouveaux
          produits.
        </p>
      ) : (
        <ul className="duplicates-list">
          {groups.map((group) => (
            <li
              key={group.items.map((item) => item.id).join(":")}
              className="duplicate-pair"
            >
              {group.items.map((item) => (
                <DuplicateSide key={item.id} item={item} />
              ))}
              <div className="duplicate-footer">
                <span className="duplicate-score">
                  {group.items.length} articles · similarité {Math.round(group.score * 100)} %
                </span>
                <button
                  type="button"
                  className="btn btn--accent"
                  onClick={() => onMergeGroup(group)}
                >
                  Fusionner ({group.items.length})
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    </dialog>
  );
};
