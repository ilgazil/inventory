import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Config } from "../../config.ts";

const loginSchema = z
  .object({ password: z.string().min(1).max(256) })
  .strict();

// Plafond naïf de tentatives de login par IP (en mémoire, réinitialisé au redémarrage).
const RATE_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

const attempts = new Map<string, { count: number; resetAt: number }>();

const isRateLimited = (ip: string): boolean => {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const authRoutes = (config: Config): Router => {
  const router = Router();

  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Requête invalide." });
      return;
    }
    const { password } = parsed.data;

    if (isRateLimited(req.ip ?? "unknown")) {
      res.status(429).json({ error: "Trop de tentatives, réessaie dans un instant." });
      return;
    }

    let ok = false;
    try {
      ok = await bcrypt.compare(password, config.passwordHash);
    } catch {
      res.status(500).json({ error: "Configuration du serveur invalide (AUTH_PASSWORD_HASH)." });
      return;
    }

    if (!ok) {
      if (config.loginDelayMs > 0) await sleep(config.loginDelayMs);
      res.status(401).json({ error: "Mot de passe incorrect." });
      return;
    }

    const expiresInSeconds = config.tokenTtlDays * 24 * 3600;
    const token = jwt.sign({ sub: "owner" }, config.jwtSecret, { expiresIn: expiresInSeconds });
    res.json({ token, expiresAt: Date.now() + expiresInSeconds * 1000 });
  });

  return router;
};
