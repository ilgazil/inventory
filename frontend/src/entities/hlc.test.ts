import { describe, expect, it } from "vitest";
import { compareHlc, createHlcClock, encodeHlc } from "./hlc";

const DEVICE = "aaaaaaaa-0000-4000-8000-000000000001";
const DEVICE_B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("HLC — encodage", () => {
  it("encode wall sur 15 chiffres, compteur sur 6", () => {
    expect(encodeHlc(1_700_000_000_000, 3, DEVICE)).toBe(
      "001700000000000:000003:" + DEVICE,
    );
  });

  it("compareHlc suit l'ordre lexicographique", () => {
    const a = encodeHlc(1, 0, DEVICE);
    const b = encodeHlc(2, 0, DEVICE);
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
    expect(compareHlc(a, a)).toBe(0);
  });

  it("même wall : le compteur départage", () => {
    const a = encodeHlc(1_700_000_000_000, 5, DEVICE);
    const b = encodeHlc(1_700_000_000_000, 7, DEVICE);
    expect(compareHlc(a, b)).toBe(-1);
  });
});

describe("HLC — émission", () => {
  it("est strictement croissante, même appelé dans la même ms", () => {
    const clock = createHlcClock(DEVICE);
    const first = clock.now();
    const second = clock.now();
    const third = clock.now();
    expect(compareHlc(first, second)).toBe(-1);
    expect(compareHlc(second, third)).toBe(-1);
  });

  it("réintègre un HLC distant du futur", () => {
    const clock = createHlcClock(DEVICE);
    clock.now();
    const distant = encodeHlc(Date.now() + 60_000, 2, DEVICE_B);
    clock.receive(distant);
    expect(compareHlc(distant, clock.now())).toBe(-1);
  });

  it("départage un HLC distant de même wall (monotonie)", () => {
    const clock = createHlcClock(DEVICE);
    const local = clock.now();
    // Même wall que local, compteur distant supérieur.
    const [wall] = local.split(":");
    const remote = `${wall}:000042:${DEVICE_B}`;
    clock.receive(remote);
    expect(compareHlc(remote, clock.now())).toBe(-1);
  });

  it("ignore un HLC malformé sans casser l'horloge", () => {
    const clock = createHlcClock(DEVICE);
    const before = clock.now();
    clock.receive("n'importe quoi");
    expect(compareHlc(before, clock.now())).toBe(-1);
  });
});
