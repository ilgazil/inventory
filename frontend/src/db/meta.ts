// Accès aux métadonnées locales (deviceId, curseur de sync, horloge HLC restaurée).
import { db } from "./db";

export const getMeta = async <T>(key: string): Promise<T | undefined> => {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
};

export const setMeta = (key: string, value: unknown): Promise<unknown> =>
  db.meta.put({ key, value });

export const getOrCreateDeviceId = async (): Promise<string> => {
  const existing = await getMeta<string>("deviceId");
  if (existing) return existing;
  const deviceId = crypto.randomUUID();
  await setMeta("deviceId", deviceId);
  return deviceId;
};
