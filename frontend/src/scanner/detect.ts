// Détection de codes-barres : API native BarcodeDetector (Chrome) en priorité,
// fallback @zxing/library lazy-loadé (Firefox ne supporte pas BarcodeDetector).
import type { BrowserMultiFormatReader } from "@zxing/library";

export const SCANNER_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
] as const;

export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: readonly string[];
}) => BarcodeDetectorLike;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export const hasNativeDetector = (): boolean =>
  typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

export const createDetector = (): BarcodeDetectorLike | null => {
  if (!hasNativeDetector()) return null;
  return new window.BarcodeDetector!({ formats: SCANNER_FORMATS });
};

let zxingReader: BrowserMultiFormatReader | null = null;

/** Lazy import : le chunk zxing n'est jamais chargé sur Chrome. */
export const loadZxingReader = async (): Promise<BrowserMultiFormatReader> => {
  if (!zxingReader) {
    const { BrowserMultiFormatReader } = await import("@zxing/library");
    zxingReader = new BrowserMultiFormatReader();
  }
  return zxingReader;
};

/** Décodage zxing d'une frame vidéo (createBinaryBitmap + decodeBitmap). */
export const decodeFrameWithZxing = async (
  reader: BrowserMultiFormatReader,
  video: HTMLVideoElement,
): Promise<string | null> => {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;
  try {
    const bitmap = reader.createBinaryBitmap(video);
    const result = reader.decodeBitmap(bitmap);
    return result.getText() || null;
  } catch {
    // NotFoundException : pas de code dans l'image — cas nominal.
    return null;
  }
};

/** Bip court généré en WebAudio (aucun asset) + vibration. */
export const scanFeedback = (): void => {
  try {
    navigator.vibrate?.(40);
  } catch {
    // vibration non supportée : silencieux
  }
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1200;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => void context.close();
  } catch {
    // audio non disponible : silencieux
  }
};
