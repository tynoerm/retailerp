"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Code 128 barcode rendered as SVG (scannable by USB/Bluetooth scanners and the camera scanner). */
export default function Barcode({ value, height = 48, width = 1.6, showText = true }: { value: string; height?: number; width?: number; showText?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height, width, displayValue: showText, fontSize: 13, margin: 4 });
    } catch {
      ref.current.innerHTML = "";
    }
  }, [value, height, width, showText]);

  return <svg ref={ref} role="img" aria-label={value} />;
}
