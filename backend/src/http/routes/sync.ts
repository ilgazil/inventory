import { Router } from "express";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pullQuerySchema, pushBodySchema } from "../../sync/schemas.ts";

interface OpRow extends RowDataPacket {
  uuid: string;
  deviceId: string;
  hlc: string;
  type: string;
  entityId: string;
  payload: unknown;
  seq: number | string;
}

interface HeadRow extends RowDataPacket {
  last_seq: number | string;
}

// Le serveur est un store d'opérations append-only : aucune logique métier ici.
export const syncRoutes = (pool: Pool): Router => {
  const router = Router();

  router.get("/head", async (_req, res) => {
    // NB : `cursor` est un mot réservé MariaDB 10.6 — alias SQL `last_seq`.
    const [rows] = await pool.query<HeadRow[]>(
      "SELECT COALESCE(MAX(seq), 0) AS last_seq FROM ops",
    );
    res.json({ cursor: Number(rows[0]?.last_seq ?? 0) });
  });

  router.get("/pull", async (req, res) => {
    const parsed = pullQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Paramètres invalides." });
      return;
    }
    const { cursor, limit } = parsed.data;

    const [rows] = await pool.query<OpRow[]>(
      `SELECT uuid, device_id AS deviceId, hlc, type, entity_id AS entityId, payload, seq
       FROM ops WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
      [cursor, limit],
    );

    const ops = rows.map((row) => ({
      uuid: row.uuid,
      deviceId: row.deviceId,
      hlc: row.hlc,
      type: row.type,
      entityId: row.entityId,
      // mysql2 renvoie les colonnes JSON déjà parsées ; par prudence on accepte la chaîne brute.
      payload:
        typeof row.payload === "string" ? (JSON.parse(row.payload) as unknown) : row.payload,
    }));

    const lastSeq = rows.length > 0 ? Number(rows[rows.length - 1]?.seq) : cursor;
    res.json({ ops, cursor: lastSeq });
  });

  router.post("/push", async (req, res) => {
    const parsed = pushBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? ` (${String(issue.path[0] ?? "?")})` : "";
      res.status(400).json({ error: `Lot d'opérations invalide${detail}.` });
      return;
    }
    const ops = parsed.data.ops;

    // Idempotence : INSERT IGNORE sur uuid — repousser une op connue ne duplique rien.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const accepted: string[] = [];
      const duplicated: string[] = [];
      for (const op of ops) {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO ops (uuid, device_id, hlc, type, entity_id, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [op.uuid, op.deviceId, op.hlc, op.type, op.entityId, JSON.stringify(op.payload)],
        );
        (result.affectedRows === 1 ? accepted : duplicated).push(op.uuid);
      }
      await connection.commit();
      res.json({ accepted, duplicated });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  return router;
};
