// Modale scanner plein écran (native <dialog>) : caméra continue, BarcodeDetector natif (Chrome)
// ou fallback zxing lazy (Firefox). Chaque scan → onScan(code), la caméra reste active (mode continu).
import { useEffect, useRef, useState } from "react";
import {
  createDetector,
  decodeFrameWithZxing,
  loadZxingReader,
  scanFeedback,
} from "../scanner/detect";
import { CloseIcon, TorchIcon } from "./icons";
import { useDialog } from "./useDialog";

const DETECT_INTERVAL_MS = 150;
const DEDUPE_WINDOW_MS = 1500;

export const ScannerDialog = ({
  open,
  statusText,
  onClose,
  onScan,
}: {
  open: boolean;
  /** Texte d'état sous le cadre (recherche produit en cours…). */
  statusText: string | null;
  onClose: () => void;
  onScan: (code: string) => void;
}) => {
  const dialogRef = useDialog(open, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | null = null;
    let stream: MediaStream | null = null;

    const handleCode = (code: string) => {
      const trimmed = code.trim();
      if (trimmed === "") return;
      scanFeedback();
      setLastCode(trimmed);
      onScanRef.current(trimmed);
    };

    const start = async () => {
      setError(null);
      setTorchOn(false);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities = track.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined;
          setTorchSupported(Boolean(capabilities?.torch));
        }

        const detector = createDetector();
        const zxing = detector ? null : await loadZxingReader();

        const tick = async () => {
          if (cancelled) return;
          try {
            if (detector && video.readyState >= 2) {
              const results = await detector.detect(video);
              const code = results[0]?.rawValue;
              if (code) {
                handleCode(code);
                timer = window.setTimeout(tick, DEDUPE_WINDOW_MS);
                return;
              }
            } else if (zxing && video.readyState >= 2) {
              const code = await decodeFrameWithZxing(zxing, video);
              if (code) {
                handleCode(code);
                timer = window.setTimeout(tick, DEDUPE_WINDOW_MS);
                return;
              }
            }
          } catch {
            // pas de code lisible dans l'image : cas nominal
          }
          timer = window.setTimeout(tick, DETECT_INTERVAL_MS);
        };
        void tick();
      } catch {
        if (!cancelled) setError("Impossible d'accéder à la caméra. Vérifie les permissions du navigateur.");
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  const toggleTorch = async () => {
    const video = videoRef.current;
    const currentTrack = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!currentTrack) return;
    try {
      await currentTrack.applyConstraints({
        advanced: [{ torch: !torchOn }],
      } as unknown as MediaTrackConstraints);
      setTorchOn((value) => !value);
    } catch {
      // torche indisponible : silencieux
    }
  };

  return (
    <dialog ref={dialogRef} className="scanner-dialog" aria-label="Scanner un code-barres">
      <video ref={videoRef} className="scanner-video" autoPlay playsInline muted />

      <div className="scanner-frame" aria-hidden="true" />

      <div className="scanner-top">
        {torchSupported && (
          <button
            type="button"
            className={`fab-btn${torchOn ? " fab-btn--active" : ""}`}
            aria-label="Torche"
            onClick={() => void toggleTorch()}
          >
            <TorchIcon size={20} />
          </button>
        )}
        <button type="button" className="fab-btn" aria-label="Fermer le scanner" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="scanner-status" role="status">
        {error !== null ? (
          <p className="scanner-error">{error}</p>
        ) : statusText !== null ? (
          <p>{statusText}</p>
        ) : lastCode !== null ? (
          <p>
            Dernier scan&nbsp;: <code>{lastCode}</code>
          </p>
        ) : (
          <p>Place le code-barres dans le cadre.</p>
        )}
      </div>
    </dialog>
  );
};
