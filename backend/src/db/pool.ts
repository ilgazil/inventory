import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import type { Config } from "../config.ts";

// Connexion par variables discrètes (jamais d'URL) : un mot de passe contenant %, @ ou :
// passe sans aucun encodage.
export const createPool = (config: Config): Pool =>
  mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    connectionLimit: 5,
    supportBigNumbers: true,
    // Les timestamps de lecture ne sont pas critiques : valeurs par défaut mysql2.
  });
