import type { Express } from "express";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { parseDbUrl } from "../src/config.ts";
import type { Config, DbConfig } from "../src/config.ts";

export const TEST_PASSWORD = "mot-de-passe-test";

const INVALID_DB: DbConfig = { host: "invalid", port: 3306, user: "", password: "", database: "" };

// Configuration de test : aucun secret réel, délai de login nul pour la rapidité.
export const makeTestConfig = (overrides: Partial<Config> = {}): Config => {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  return {
    port: 0,
    database: testDbUrl ? parseDbUrl(testDbUrl) : INVALID_DB,
    jwtSecret: "test-secret-0123456789abcdef0123456789abcdef",
    passwordHash: bcrypt.hashSync(TEST_PASSWORD, 10),
    nodeEnv: "development",
    barcodeCacheTtlDays: 7,
    lookupTimeoutMs: 1000,
    loginDelayMs: 0,
    tokenTtlDays: 90,
    ...overrides,
  };
};

export interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

// Démarre l'app sur un port éphémère ; penser à close() après le test (sinon le process node --test pendent).
export const startApp = (app: Express): Promise<RunningApp> =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Adresse invalide"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.closeAllConnections();
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
    server.on("error", reject);
  });
