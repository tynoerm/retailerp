"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";

export default function PrintToolbar({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (autoPrint) window.print();
  }, [autoPrint]);

  return (
    <div className="mb-6 flex justify-center gap-3 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#178686]"
      >
        <Printer size={17} />
        Print / Save as PDF
      </button>
      <button
        type="button"
        onClick={() => window.close()}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        <X size={17} />
        Close
      </button>
    </div>
  );
}
