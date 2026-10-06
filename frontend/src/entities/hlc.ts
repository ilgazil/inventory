// Horloge hybride (HLC) : temps mural + compteur + deviceId.
// Encodage : wall paddé sur 15 chiffres, compteur sur 6, deviceId → ordre total = ordre lexicographique.

export interface HlcClock {
  /** Génère un HLC strictement supérieur à tous les HLC émis/reçus. */
  now: () => string;
  /** Intègre un HLC distant (monotonie garantie, même en cas de dérive d'horloge). */
  receive: (hlc: string) => void;
}

export const encodeHlc = (wall: number, counter: number, deviceId: string): string =>
  `${String(wall).padStart(15, "0")}:${String(counter).padStart(6, "0")}:${deviceId}`;

export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const createHlcClock = (deviceId: string): HlcClock => {
  let lastWall = 0;
  let counter = 0;

  const now = (): string => {
    const wall = Math.max(Date.now(), lastWall);
    counter = wall === lastWall ? counter + 1 : 0;
    lastWall = wall;
    return encodeHlc(wall, counter, deviceId);
  };

  const receive = (hlc: string): void => {
    const [wallRaw, counterRaw] = hlc.split(":");
    const wall = Number(wallRaw);
    if (!Number.isFinite(wall)) return;
    const opCounter = Number.isFinite(Number(counterRaw)) ? Number(counterRaw) : 0;
    if (wall > lastWall) {
      // Horloge distante en avance : on la réintègre AVEC son compteur (sinon notre
      // prochain now() pourrait repartir sous le HLC distant reçu).
      lastWall = wall;
      counter = opCounter;
      return;
    }
    if (wall === lastWall) {
      counter = Math.max(counter, opCounter) + 1;
    }
  };

  return { now, receive };
};
