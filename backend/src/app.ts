import express from "express";
import type { Pool } from "mysql2/promise";
import type { Config } from "./config.ts";
import { authMiddleware } from "./http/auth.ts";
import { authRoutes } from "./http/routes/auth.ts";
import { syncRoutes } from "./http/routes/sync.ts";
import { lookupRoutes } from "./http/routes/lookup.ts";
import { staticMiddleware } from "./static.ts";

export const createApp = (config: Config, pool: Pool): express.Express => {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes(config));
  app.use("/api/sync", authMiddleware(config.jwtSecret), syncRoutes(pool));
  app.use("/api/lookup", authMiddleware(config.jwtSecret), lookupRoutes(pool, config));

  // 404 JSON pour les routes /api inconnues (avant le fallback SPA).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Route inconnue." });
  });

  app.use(staticMiddleware());

  // Gestionnaire d'erreurs global.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof SyntaxError && "body" in (error as object)) {
        res.status(400).json({ error: "JSON invalide." });
        return;
      }
      if (typeof error === "object" && error !== null && "type" in error) {
        const type = String((error as { type?: unknown })["type"]);
        if (type === "entity.too.large") {
          res.status(413).json({ error: "Corps de requête trop volumineux." });
          return;
        }
      }
      console.error("[erreur]", error);
      res.status(500).json({ error: "Erreur interne." });
    },
  );

  return app;
};
