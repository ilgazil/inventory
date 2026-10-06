// jsdom n'implémente pas <dialog>.showModal/close — polyfill minimal pour les tests.
// + matchers jest-dom (toBeInTheDocument, toBeDisabled…).
import "@testing-library/jest-dom/vitest";

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}
