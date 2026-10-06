// Formulaire de connexion (mot de passe unique). Utilisé en page (première connexion)
// ou en modale (session expirée) — le parent fournit le conteneur.
import { useState } from "react";
import type { FormEvent } from "react";
import { login } from "../api/auth";
import { ApiError } from "../api/client";

export const LoginView = ({
  expired = false,
  onSuccess,
}: {
  expired?: boolean;
  onSuccess: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Connexion impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-card">
      <h1 className="login-title">Inventaire</h1>
      <p className="login-subtitle">
        {expired
          ? "Ta session a expiré — reconnecte-toi pour resynchroniser."
          : "Inventaire personnel, hors-ligne et synchronisé."}
      </p>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span className="field-label">Mot de passe</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
            autoComplete="current-password"
            enterKeyHint="go"
          />
        </label>
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--accent btn--block" disabled={submitting}>
          {submitting ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
};
