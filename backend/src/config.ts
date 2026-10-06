// Parsing/validation des variables d'environnement.
// Aucune valeur en dur : tout vient de l'environnement (fichier .env en dev, Manager Example en prod).

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
};

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface Config {
  port: number;
  database: DbConfig;
  jwtSecret: string;
  passwordHash: string;
  nodeEnv: "development" | "production";
  /** Durée de validité du cache DB des lookups (jours). */
  barcodeCacheTtlDays: number;
  /** Timeout (ms) par source de lookup. */
  lookupTimeoutMs: number;
  /** Délai forcé avant une réponse de login échouée (ms) — limitation de force brute. */
  loginDelayMs: number;
  /** Durée de vie des tokens JWT (jours). */
  tokenTtlDays: number;
}

// Décodage tolérant : un caractère % non-encodé dans un mot de passe ne doit pas faire planter le boot.
const decodeUriComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Parsing maison d'une URL mysql:// — mysql2 appelle decodeURIComponent sans tolérance et meurt
 * sur un mot de passe contenant un % brut. Règles : dernier @ sépare identifiants et hôte
 * (le mot de passe peut contenir des @), premier : sépare user et mot de passe.
 */
export const parseDbUrl = (url: string): DbConfig => {
  const withoutScheme = url.replace(/^mysql:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  const userinfo = at === -1 ? "" : withoutScheme.slice(0, at);
  const hostPart = at === -1 ? withoutScheme : withoutScheme.slice(at + 1);

  const colon = userinfo.indexOf(":");
  const user = decodeUriComponent(colon === -1 ? userinfo : userinfo.slice(0, colon));
  const password = colon === -1 ? "" : decodeUriComponent(userinfo.slice(colon + 1));

  const slash = hostPart.indexOf("/");
  const hostPort = slash === -1 ? hostPart : hostPart.slice(0, slash);
  const pathPart = slash === -1 ? "" : hostPart.slice(slash + 1);
  const portColon = hostPort.lastIndexOf(":");
  const host = portColon === -1 ? hostPort : hostPort.slice(0, portColon);
  const port = portColon === -1 ? 3306 : Number(hostPort.slice(portColon + 1));
  const database = decodeUriComponent(pathPart.split("?")[0] ?? "");

  return { host, port: Number.isFinite(port) ? port : 3306, user, password, database };
};

// Priorité : DB_HOST/DB_USER/DB_PASSWORD/DB_NAME (pas d'encodage à gérer), sinon DATABASE_URL.
const dbFromEnv = (): DbConfig => {
  const host = process.env.DB_HOST;
  if (host) {
    return {
      host,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER ?? "",
      password: process.env.DB_PASSWORD ?? "",
      database: process.env.DB_NAME ?? "",
    };
  }
  if (process.env.DATABASE_URL) {
    return parseDbUrl(process.env.DATABASE_URL);
  }
  throw new Error(
    "Connexion DB manquante : définis DB_HOST/DB_USER/DB_PASSWORD/DB_NAME (ou DATABASE_URL).",
  );
};

export const loadConfig = (): Config => {
  const nodeEnv = process.env.NODE_ENV === "production" ? "production" : "development";
  return {
    port: Number(process.env.PORT ?? 3000),
    database: dbFromEnv(),
    jwtSecret: required("JWT_SECRET"),
    passwordHash: required("AUTH_PASSWORD_HASH"),
    nodeEnv,
    barcodeCacheTtlDays: Number(process.env.BARCODE_CACHE_TTL_DAYS ?? 7),
    lookupTimeoutMs: Number(process.env.LOOKUP_TIMEOUT_MS ?? 6000),
    loginDelayMs: Number(process.env.LOGIN_DELAY_MS ?? 400),
    tokenTtlDays: 90,
  };
};
