import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuantityDialog } from "./QuantityDialog";
import type { Item } from "../entities/types";

const makeItem = (qty: number): Item => ({
  id: "id-1",
  name: "Lessic Pur",
  barcodes: [],
  location: "Cave",
  category: "Ménage",
  qty,
  deleted: false,
  createdAt: "000000000000000001:000000:dev",
  fieldHlc: { name: "", barcode: "", location: "", category: "" },
});

afterEach(cleanup);

describe("QuantityDialog", () => {
  it("affiche la quantité initiale", () => {
    render(<QuantityDialog item={makeItem(5)} onClose={() => {}} onValidate={() => {}} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("incrémente et décrémente", () => {
    render(<QuantityDialog item={makeItem(5)} onClose={() => {}} onValidate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un" }));
    expect(screen.getByText("6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retirer un" }));
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("plafonne à 0 (bouton − désactivé)", () => {
    render(<QuantityDialog item={makeItem(0)} onClose={() => {}} onValidate={() => {}} />);
    expect(screen.getByRole("button", { name: "Retirer un" })).toBeDisabled();
  });

  it("Valider émet le delta total en un seul ajustement", () => {
    const onValidate = vi.fn();
    render(<QuantityDialog item={makeItem(5)} onClose={() => {}} onValidate={onValidate} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un" }));
    expect(screen.getByRole("button", { name: /Valider/ })).toHaveTextContent("Valider (+3)");
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));
    expect(onValidate).toHaveBeenCalledExactlyOnceWith(makeItem(5), 3);
  });

  it("delta nul → Valider ferme sans émettre", () => {
    const onValidate = vi.fn();
    const onClose = vi.fn();
    render(<QuantityDialog item={makeItem(5)} onClose={onClose} onValidate={onValidate} />);
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));
    expect(onValidate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
