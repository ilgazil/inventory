import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

declare module "express-serve-static-core" {
  interface Request {
    auth?: { sub: string; iat?: number; exp?: number };
  }
}

// Authentification unique : Bearer JWT (HS256, 90 jours). Stateless — aucun cookie ni session.
export const authMiddleware =
  (jwtSecret: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentification requise." });
      return;
    }
    try {
      const payload = jwt.verify(header.slice("Bearer ".length), jwtSecret);
      if (typeof payload === "string" || typeof payload.sub !== "string") {
        throw new Error("payload invalide");
      }
      req.auth = { sub: payload.sub, iat: payload.iat, exp: payload.exp };
      next();
    } catch {
      res.status(401).json({ error: "Session expirée, reconnecte-toi." });
    }
  };
