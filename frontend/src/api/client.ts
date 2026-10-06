// Client HTTP minimal : JSON + Bearer, erreurs typées. Same-origin en prod, proxy Vite en dev.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class AuthError extends ApiError {
  constructor() {
    super(401, "Session expirée, reconnecte-toi.");
    this.name = "AuthError";
  }
}

const TOKEN_KEY = "inventory.token";

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export const apiFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError(0, `Réseau indisponible (${error.message}).`);
    }
    throw new ApiError(0, "Réseau indisponible.");
  }

  if (response.status === 401) throw new AuthError();

  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? `Erreur ${response.status}.`);
  }
  return data as T;
};

export const apiGet = <T>(path: string): Promise<T> => apiFetch<T>(path);

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
