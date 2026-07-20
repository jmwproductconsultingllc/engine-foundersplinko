"use client";

// components/CaptureSheet.tsx — Capture v2 S2 (hunt-triggered bottom sheet).
// Trigger (spec, all conditions): teaser_viewed has fired AND scroll ≥80% AND
// ~8s dwell after that point AND no CTA click / no capture submit yet.
// Fires ONCE per session (sessionStorage). Never on load; never full-screen
// (≤40vh — no intrusive-interstitial flag); dismissible; dismiss = never again
// this session.
//
// Coordination contract (no new global state): other components mark
// sessionStorage keys — BrandDetail sets fe_teaser_viewed=1 when teaser_viewed
// fires; any CTA click sets fe_cta_clicked=1; EmailCapture success sets
// fe_capture_done=1. The sheet reads, never writes, those three.

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import EmailCapture from "@/components/EmailCapture";

const SHOWN_KEY = "fe_sheet_shown";

export default function CaptureSheet({
  brandName,
  brandSlug,
}: {
  brandName: string;
  brandSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SHOWN_KEY)) return;

    function eligible(): boolean {
      return (
        sessionStorage.getItem("fe_teaser_viewed") === "1" &&
        !sessionStorage.getItem("fe_cta_clicked") &&
        !sessionStorage.getItem("fe_capture_done") &&
        !sessionStorage.getItem(SHOWN_KEY)
      );
    }

    function onScroll() {
      const doc = document.documentElement;
      const scrolled = (window.scrollY + window.innerHeight) / doc.scrollHeight;
      if (scrolled >= 0.8 && !armed.current && eligible()) {
        armed.current = true; // 80% reached → start the 8s dwell clock
        dwellTimer.current = setTimeout(() => {
          if (!eligible()) return;
          sessionStorage.setItem(SHOWN_KEY, "1");
          setOpen(true);
          track("capture_shown", { capture_surface: "sheet" });
        }, 8000);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[40vh] overflow-y-auto rounded-t-2xl border-t border-[#3A496A] bg-[#0E1729] p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,.45)]"
      role="dialog"
      aria-label="Email the findings"
    >
      <button
        onClick={() => {
          setOpen(false);
          track("sheet_dismissed", {});
        }}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-full bg-[#16223B] px-2.5 py-1 text-sm font-bold text-[#8194B0]"
      >
        ✕
      </button>
      <h4 className="pr-8 text-base font-extrabold text-[#F1F5F9]">
        You&apos;ve read the whole thing.
      </h4>
      <p className="mt-1 text-[13px] text-[#8194B0]">
        Want the locked findings explained? I&apos;ll email them — free.
      </p>
      <div className="mt-3">
        <EmailCapture brandName={brandName} brandSlug={brandSlug} surface="sheet" />
      </div>
    </div>
  );
}
