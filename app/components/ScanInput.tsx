"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanBarcode, X } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-14 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10";

/**
 * Scan field for keyboard-wedge (USB/Bluetooth) scanners — they type the code and press Enter — with a camera
 * button for phones/tablets. Calls `onScan` with the trimmed code and clears itself.
 */
export default function ScanInput({
  onScan,
  placeholder = "Scan or type a barcode…",
  label,
  autoFocus = false,
  disabled = false,
  keepValue = false,
}: {
  onScan: (code: string) => void | Promise<void>;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  keepValue?: boolean;
}) {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (!keepValue) setValue("");
    await onScan(trimmed);
    input.current?.focus();
  };

  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      <div className="relative">
        <ScanBarcode size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={input}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit(value);
          }}
          placeholder={placeholder}
          className={`${inputClass} disabled:opacity-60`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCamera(true)}
          title="Scan with camera"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-[#1C9A9A] disabled:opacity-50"
        >
          <Camera size={18} />
        </button>
      </div>

      {camera && (
        <CameraScanner
          onClose={() => setCamera(false)}
          onDetected={(code) => {
            setCamera(false);
            if (keepValue) setValue(code);
            void submit(code);
          }}
        />
      )}
    </label>
  );
}

function CameraScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const detected = useRef(onDetected);

  useEffect(() => {
    detected.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let controls: { stop: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access needs a secure connection (HTTPS or localhost) and a browser with camera support.");
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video.current ?? undefined,
          (result) => {
            if (!result || cancelled) return;
            cancelled = true;
            controls?.stop();
            detected.current(result.getText());
          }
        );
        if (cancelled) controls.stop();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the camera");
      } finally {
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4" onClick={(event) => event.stopPropagation()}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-bold text-[#0F2A3B]">Scan with camera</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-slate-900">
          <video ref={video} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
              <Loader2 size={18} className="animate-spin" /> Starting camera…
            </div>
          )}
        </div>

        <p className={`px-5 py-4 text-sm ${error ? "text-red-600" : "text-slate-500"}`}>
          {error || "Point the camera at a barcode or QR code. It will be read automatically."}
        </p>
      </div>
    </div>
  );
}
