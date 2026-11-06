import { useCallback, useState } from "react";

/**
 * Web barcode scan via BarcodeDetector. Native ML Kit is not bundled here;
 * callers always keep a manual asset-tag or token field.
 */
export function useQrScanner() {
  const [scanning, setScanning] = useState(false);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const scan = useCallback(async () => {
    if (!supported || !navigator.mediaDevices?.getUserMedia) return "";
    setScanning(true);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const codes = await detector.detect(video);
        const raw = codes?.[0]?.rawValue;
        if (raw) return String(raw).trim();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return "";
    } catch {
      return "";
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
      setScanning(false);
    }
  }, [supported]);

  return { supported, scanning, scan };
}
