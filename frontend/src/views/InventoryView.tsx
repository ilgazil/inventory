// Vue principale : liste + recherche/filtre + toutes les modales + flux de scan.
// Toute écriture passe par recordOp (local, instantané) puis requestSyncSoon (débouncé).
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { lookupBarcode } from "../api/lookup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Fabs } from "../components/Fabs";
import { Header } from "../components/Header";
import { ItemFormDialog } from "../components/ItemFormDialog";
import type { ItemDraft } from "../components/ItemFormDialog";
import { ItemList } from "../components/ItemList";
import { MergeDialog } from "../components/MergeDialog";
import type { MergeDraft } from "../components/MergeDialog";
import { QuantityDialog } from "../components/QuantityDialog";
import { ScannerDialog } from "../components/ScannerDialog";
import { db } from "../db/db";
import { findItemByBarcode, recordOp } from "../db/repo";
import { applyOp } from "../entities/fold";
import { compareItems, matchesQuery, normalizeText } from "../entities/search";
import type { CreatePayload, Item, SettableField } from "../entities/types";
import { getSyncSnapshot, requestSync, requestSyncSoon, subscribeSync } from "../sync/engine";
import { LoginView } from "./LoginView";

type FormState =
  | { mode: "closed" }
  | { mode: "create"; prefill: { name?: string; barcode?: string; source?: string } | null }
  | { mode: "edit"; item: Item };

/** Rangée de chips de filtrage (« Tous » + une valeur par entrée existante). */
const FilterChips = ({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) => {
  if (values.length === 0) return null;
  return (
    <nav className="chips" aria-label={label}>
      <button
        type="button"
        className={`chip${selected === null ? " chip--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        Tous
      </button>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={`chip${selected === value ? " chip--active" : ""}`}
          onClick={() => onSelect(selected === value ? null : value)}
        >
          {value}
        </button>
      ))}
    </nav>
  );
};

export const InventoryView = () => {
  const items = useLiveQuery(() => db.items.toArray(), [], []).filter((item) => !item.deleted);

  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [qtyItem, setQtyItem] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [deleteCandidate, setDeleteCandidate] = useState<Item | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const sync = useSyncExternalStore(subscribeSync, getSyncSnapshot);

  const locations = useMemo(
    () =>
      [...new Set(items.map((item) => item.location).filter((value) => value !== ""))].sort(
        (a, b) => normalizeText(a).localeCompare(normalizeText(b), "fr"),
      ),
    [items],
  );
  const categories = useMemo(
    () =>
      [...new Set(items.map((item) => item.category).filter((value) => value !== ""))].sort(
        (a, b) => normalizeText(a).localeCompare(normalizeText(b), "fr"),
      ),
    [items],
  );

  const filteredItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            matchesQuery(item, query) &&
            (locationFilter === null || item.location === locationFilter) &&
            (categoryFilter === null || item.category === categoryFilter),
        )
        .sort(compareItems),
    [items, query, locationFilter, categoryFilter],
  );

  const afterWrite = useCallback(() => requestSyncSoon(), []);

  /** Produits sélectionnés en mode fusion (indépendant des filtres, ordre de la liste). */
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)).sort(compareItems),
    [items, selectedIds],
  );

  const toggleMergeMode = useCallback(() => {
    if (mergeMode) setSelectedIds(new Set());
    setMergeMode(!mergeMode);
    setMergeOpen(false);
  }, [mergeMode]);

  const toggleSelect = useCallback((item: Item) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }, []);

  /**
   * Fusion : le premier produit (ordre de la liste) est conservé, les autres supprimés.
   * Ordre des ops : suppression des absorbés (libère leurs codes-barres) → cumul des codes-barres
   * → champs édités → quantité (ajustement delta). Toutes enregistrées localement puis sync.
   */
  const handleMerge = useCallback(
    async (draft: MergeDraft) => {
      setMergeOpen(false);
      if (selectedItems.length < 2) return;
      const survivor = selectedItems[0]!;
      for (const item of selectedItems.slice(1)) {
        await recordOp({ type: "item.delete", entityId: item.id, payload: {} });
      }
      const barcodes = [...new Set(selectedItems.flatMap((item) => item.barcodes))];
      if (barcodes.join("\n") !== survivor.barcodes.join("\n")) {
        await recordOp({
          type: "item.barcodes.set",
          entityId: survivor.id,
          payload: { barcodes },
        });
      }
      const changes: Array<{ field: SettableField; value: string }> = [];
      if (draft.name !== survivor.name) changes.push({ field: "name", value: draft.name });
      if (draft.location !== survivor.location) {
        changes.push({ field: "location", value: draft.location });
      }
      if (draft.category !== survivor.category) {
        changes.push({ field: "category", value: draft.category });
      }
      for (const change of changes) {
        await recordOp({ type: "item.set", entityId: survivor.id, payload: change });
      }
      const delta = draft.qty - survivor.qty;
      if (delta !== 0) {
        await recordOp({ type: "item.adjust", entityId: survivor.id, payload: { delta } });
      }
      setMergeMode(false);
      setSelectedIds(new Set());
      afterWrite();
    },
    [selectedItems, afterWrite],
  );

  const handleAdjust = useCallback(
    async (item: Item, delta: number) => {
      await recordOp({ type: "item.adjust", entityId: item.id, payload: { delta } });
      afterWrite();
    },
    [afterWrite],
  );

  const handleValidateQuantity = useCallback(
    async (item: Item, delta: number) => {
      setQtyItem(null);
      await handleAdjust(item, delta);
    },
    [handleAdjust],
  );

  const handleSaveForm = useCallback(
    async (draft: ItemDraft) => {
      if (form.mode === "create") {
        const payload: CreatePayload = { name: draft.name };
        const barcode = form.prefill?.barcode ?? "";
        if (barcode !== "") payload.barcodes = [barcode];
        if (draft.location !== "") payload.location = draft.location;
        if (draft.category !== "") payload.category = draft.category;
        const op = await recordOp({
          type: "item.create",
          entityId: crypto.randomUUID(),
          payload,
        });
        setForm({ mode: "closed" });
        // Item fraîchement créé : appliqué localement pour enchaîner sur la modale quantité.
        const map = new Map<string, Item>();
        applyOp(map, op);
        const created = map.get(op.entityId);
        if (created) setQtyItem(created);
        afterWrite();
        return;
      }
      if (form.mode === "edit") {
        const item = form.item;
        const changes: Array<{ field: SettableField; value: string }> = [];
        if (draft.name !== item.name) changes.push({ field: "name", value: draft.name });
        if (draft.location !== item.location)
          changes.push({ field: "location", value: draft.location });
        if (draft.category !== item.category)
          changes.push({ field: "category", value: draft.category });
        for (const change of changes) {
          await recordOp({ type: "item.set", entityId: item.id, payload: change });
        }
        if (changes.length > 0) afterWrite();
        setForm({ mode: "closed" });
      }
    },
    [form, afterWrite],
  );

  const handleDelete = useCallback(
    async (item: Item) => {
      setDeleteCandidate(null);
      await recordOp({ type: "item.delete", entityId: item.id, payload: {} });
      if (qtyItem?.id === item.id) setQtyItem(null);
      afterWrite();
    },
    [qtyItem, afterWrite],
  );

  const handleScan = useCallback(async (code: string) => {
    const existing = await findItemByBarcode(code);
    if (existing) {
      setQtyItem(existing);
      return;
    }
    setScannerStatus("Recherche du produit…");
    const result = await lookupBarcode(code);
    setScannerStatus(null);
    setForm({
      mode: "create",
      prefill: {
        barcode: code,
        name: result.found ? (result.name ?? "") : "",
        source: result.source,
      },
    });
  }, []);

  const handleBadgeClick = useCallback(() => {
    if (sync.state === "auth-expired") {
      setLoginOpen(true);
      return;
    }
    requestSync();
  }, [sync.state]);

  const openCreate = useCallback(() => setForm({ mode: "create", prefill: null }), []);
  const openEdit = useCallback((item: Item) => setForm({ mode: "edit", item }), []);

  const formKey =
    form.mode === "create" ? "create" : form.mode === "edit" ? form.item.id : "closed";

  return (
    <div className="app">
      <Header
        query={query}
        onQueryChange={setQuery}
        onAdd={openCreate}
        onBadgeClick={handleBadgeClick}
      />

      {(items.length >= 2 || mergeMode) && (
        <nav className="chips" aria-label="Mode fusion">
          <button
            type="button"
            className={`chip${mergeMode ? " chip--active" : ""}`}
            aria-pressed={mergeMode}
            onClick={toggleMergeMode}
          >
            {mergeMode ? `Fusionner · ${selectedItems.length}` : "Fusionner"}
          </button>
        </nav>
      )}

      <FilterChips
        label="Filtrer par emplacement"
        values={locations}
        selected={locationFilter}
        onSelect={setLocationFilter}
      />

      <FilterChips
        label="Filtrer par catégorie"
        values={categories}
        selected={categoryFilter}
        onSelect={setCategoryFilter}
      />

      <main className="app-main">
        <ItemList
          items={filteredItems}
          filtered={query.trim() !== "" || locationFilter !== null || categoryFilter !== null}
          query={query}
          onAdjust={(item, delta) => void handleAdjust(item, delta)}
          onOpenQuantity={setQtyItem}
          onEdit={openEdit}
          onAdd={openCreate}
          mergeMode={mergeMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      </main>

      {mergeMode ? (
        <div className="merge-bar" role="toolbar" aria-label="Actions de fusion">
          <button type="button" className="btn btn--ghost" onClick={toggleMergeMode}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={selectedItems.length < 2}
            onClick={() => setMergeOpen(true)}
          >
            Fusionner ({selectedItems.length})
          </button>
        </div>
      ) : (
        <Fabs onScan={() => setScannerOpen(true)} onAdd={openCreate} />
      )}

      <QuantityDialog
        key={qtyItem?.id ?? "none"}
        item={qtyItem}
        onClose={() => setQtyItem(null)}
        onValidate={(item, delta) => void handleValidateQuantity(item, delta)}
      />

      {form.mode !== "closed" && (
        <ItemFormDialog
          key={formKey}
          open
          item={form.mode === "edit" ? form.item : null}
          prefill={form.mode === "create" ? form.prefill : null}
          locations={locations}
          categories={categories}
          onClose={() => setForm({ mode: "closed" })}
          onSave={(draft) => void handleSaveForm(draft)}
          onDelete={
            form.mode === "edit"
              ? () => {
                  setDeleteCandidate(form.item);
                  setForm({ mode: "closed" });
                }
              : undefined
          }
        />
      )}

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Supprimer le produit"
        message={`Supprimer « ${deleteCandidate?.name ?? ""} » ? Cette action est définitive.`}
        confirmLabel="Supprimer"
        danger
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() => void handleDelete(deleteCandidate!)}
      />

      {mergeOpen && selectedItems.length >= 2 && (
        <MergeDialog
          open
          items={selectedItems}
          locations={locations}
          categories={categories}
          onClose={() => setMergeOpen(false)}
          onConfirm={(draft) => void handleMerge(draft)}
        />
      )}

      <ScannerDialog
        open={scannerOpen}
        statusText={scannerStatus}
        onClose={() => {
          setScannerOpen(false);
          setScannerStatus(null);
        }}
        onScan={(code) => void handleScan(code)}
      />

      <dialog
        className="dialog dialog--form"
        ref={(element) => {
          if (element === null) return;
          if (loginOpen && !element.open) element.showModal();
          if (!loginOpen && element.open) element.close();
        }}
        aria-label="Connexion"
      >
        <LoginView
          expired={sync.state === "auth-expired"}
          onSuccess={() => {
            setLoginOpen(false);
            requestSync();
          }}
        />
      </dialog>
    </div>
  );
};
