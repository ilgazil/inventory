import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { DbConfig } from "../config.ts";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applique les migrations SQL du dossier `migrations/` (une seule fois chacune).
 * Idempotent et concurrent-safe : CREATE TABLE IF NOT EXISTS + enregistrement par version.
 * Retourne la liste des versions nouvellement appliquées.
 *
 * Connexion dédiée avec `multipleStatements: true` (les migrations sont du DDL de confiance,
 * sans paramètres) — fermée à la fin, le pool applicatif reste inchangé.
 */
export const runMigrations = async (database: DbConfig): Promise<string[]> => {
  const connection = await mysql.createConnection({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(64) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => String(row["version"])));

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const appliedNow: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      appliedNow.push(file);
    }

    return appliedNow;
  } finally {
    await connection.end();
  }
};


// Exécution en CLI : `node src/db/migrate.ts` (cible `make db-migrate`).
const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const { loadConfig } = await import("../config.ts");
  const config = loadConfig();
  const applied = await runMigrations(config.database);
  if (applied.length === 0) {
    console.log("Aucune migration à appliquer.");
  } else {
    console.log(`Migrations appliquées : ${applied.join(", ")}`);
  }
}
