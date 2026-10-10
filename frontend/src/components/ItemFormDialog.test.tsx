import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../entities/types";
import { ItemFormDialog } from "./ItemFormDialog";

const makeItem = (overrides: Partial<Item> = {}): Item => ({
  id: "existing-1",
  name: "Liquide vaisselle",
  barcodes: ["2222222222222"],
  location: "Cuisine",
  category: "Ménage",
  qty: 4,
  deleted: false,
  createdAt: "000000000000000001:000000:dev",
  fieldHlc: { name: "", barcode: "", location: "", category: "" },
  ...overrides,
});

afterEach(cleanup);

describe("ItemFormDialog — suggestions de doublons", () => {
  it("affiche les suggestions après debounce, déplie le détail et fusionne à la volée", async () => {
    vi.useFakeTimers();
    const existing = makeItem();
    const findSuggestions = vi.fn().mockResolvedValue([{ item: existing, score: 0.93 }]);
    const onMergeWith = vi.fn();
    render(
      <ItemFormDialog
        open
        item={null}
        prefill={{ barcode: "1111111111111", name: "" }}
        locations={[]}
        categories={[]}
        findSuggestions={findSuggestions}
        onMergeWith={onMergeWith}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Liquide vaisselle" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(findSuggestions).toHaveBeenCalledWith("Liquide vaisselle");
    expect(screen.getByText("Articles similaires")).toBeInTheDocument();
    expect(screen.getByText("93 %")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Liquide vaisselle"));
    expect(screen.getByText(/Cuisine · Ménage · 4 en stock/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ajouter à cet article"));
    expect(onMergeWith).toHaveBeenCalledWith(existing, "1111111111111");
    vi.useRealTimers();
  });

  it("ne consulte pas le moteur sous 3 caractères", async () => {
    vi.useFakeTimers();
    const findSuggestions = vi.fn().mockResolvedValue([]);
    render(
      <ItemFormDialog
        open
        item={null}
        prefill={null}
        locations={[]}
        categories={[]}
        findSuggestions={findSuggestions}
        onMergeWith={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Le" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(findSuggestions).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
