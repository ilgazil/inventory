import { loadConfig } from "./config.ts";
import { createPool } from "./db/pool.ts";
import { runMigrations } from "./db/migrate.ts";
import { createApp } from "./app.ts";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const pool = createPool(config);

  // Migrations automatiques au démarrage (idempotent) — pratique sur l'hébergement Example,
  // où le site est redémarré depuis le Manager après chaque déploiement.
  const applied = await runMigrations(config.database);
  if (applied.length > 0) {
    console.log(`[inventory] migrations appliquées : ${applied.join(", ")}`);
  }

  const app = createApp(config, pool);
  app.listen(config.port, () => {
    console.log(`[inventory] API démarrée sur le port ${config.port} (${config.nodeEnv})`);
  });
};

main().catch((error) => {
  console.error("[inventory] échec du démarrage :", error);
  process.exit(1);
});
