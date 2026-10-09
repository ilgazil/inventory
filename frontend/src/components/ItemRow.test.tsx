import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemRow } from "./ItemRow";
import type { Item } from "../entities/types";

const makeItem = (qty: number): Item => ({
  id: "id-1",
  name: "Lessic Pur",
  barcodes: ["3017620422003"],
  location: "Cave",
  category: "Ménage",
  qty,
  deleted: false,
  createdAt: "000000000000000001:000000:dev",
  fieldHlc: { name: "", barcode: "", location: "", category: "" },
});

afterEach(cleanup);

describe("ItemRow", () => {
  it("affiche nom, méta et quantité", () => {
    render(
      <ItemRow
        item={makeItem(7)}
        onAdjust={() => {}}
        onOpenQuantity={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("Lessic Pur")).toBeInTheDocument();
    expect(screen.getByText("Cave · Ménage")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("+ et − émettent un ajustement de ±1", () => {
    const onAdjust = vi.fn();
    render(
      <ItemRow
        item={makeItem(3)}
        onAdjust={onAdjust}
        onOpenQuantity={() => {}}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un Lessic Pur" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer un Lessic Pur" }));
    expect(onAdjust).toHaveBeenNthCalledWith(1, makeItem(3), 1);
    expect(onAdjust).toHaveBeenNthCalledWith(2, makeItem(3), -1);
  });

  it("− est désactivé à zéro", () => {
    render(
      <ItemRow
        item={makeItem(0)}
        onAdjust={() => {}}
        onOpenQuantity={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Retirer un Lessic Pur" })).toBeDisabled();
  });

  it("tap sur la ligne → ouverture de la modale quantité", () => {
    const onOpenQuantity = vi.fn();
    render(
      <ItemRow
        item={makeItem(1)}
        onAdjust={() => {}}
        onOpenQuantity={onOpenQuantity}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Lessic Pur"));
    expect(onOpenQuantity).toHaveBeenCalledExactlyOnceWith(makeItem(1));
  });

  it("crayon → édition", () => {
    const onEdit = vi.fn();
    render(
      <ItemRow item={makeItem(1)} onAdjust={() => {}} onOpenQuantity={() => {}} onEdit={onEdit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Modifier Lessic Pur" }));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(makeItem(1));
  });

  it("mode fusion : la case à cocher et le tap sélectionnent, pas de contrôles quantité", () => {
    const onToggleSelect = vi.fn();
    const { rerender, container } = render(
      <ItemRow
        item={makeItem(3)}
        onAdjust={() => {}}
        onOpenQuantity={() => {}}
        onEdit={() => {}}
        selectable
        onToggleSelect={onToggleSelect}
      />,
    );
    expect(screen.queryByRole("button", { name: "Ajouter un Lessic Pur" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sélectionner Lessic Pur" })).not.toBeChecked();
    fireEvent.click(screen.getByText("Lessic Pur"));
    fireEvent.click(container.querySelector(".item-row")!);
    expect(onToggleSelect).toHaveBeenCalledTimes(2);

    rerender(
      <ItemRow
        item={makeItem(3)}
        onAdjust={() => {}}
        onOpenQuantity={() => {}}
        onEdit={() => {}}
        selectable
        selected
        onToggleSelect={onToggleSelect}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Sélectionner Lessic Pur" })).toBeChecked();
  });
});
