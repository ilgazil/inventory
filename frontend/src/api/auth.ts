// Connexion (mot de passe unique, cf. backend/SPECS.md § 7).
import { apiPost, setToken } from "./client";

interface LoginResponse {
  token: string;
  expiresAt: number;
}

export const login = async (password: string): Promise<void> => {
  const data = await apiPost<LoginResponse>("/api/auth/login", { password });
  setToken(data.token);
};
