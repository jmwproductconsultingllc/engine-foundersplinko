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

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import EmailCapture from "@/components/EmailCapture";
import { useCapture } from "@/components/CaptureContext";

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
  const dismissFired = useRef(false);
  const capture = useCapture();

  // Close once + fire sheet_dismissed at most once (honest lifecycle). Used by
  // both the user dismiss and the success-driven auto-close.
  const dismiss = useCallback(() => {
    setOpen(false);
    if (!dismissFired.current) {
      dismissFired.current = true;
      track("sheet_dismissed", {});
    }
  }, []);

  // Cross-surface coordination: if a capture happened on ANOTHER surface, the
  // sheet auto-closes (it was re-soliciting an already-captured visitor — the
  // double-submit bug). A capture ON the sheet keeps it open so the submitter
  // sees success + the optional name enrich.
  useEffect(() => {
    if (open && capture?.captured && capture.capturedSurface !== "sheet") {
      dismiss();
    }
  }, [open, capture?.captured, capture?.capturedSurface, dismiss]);

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
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[35dvh] overflow-y-auto rounded-t-2xl border-t border-[#3A496A] bg-[#0E1729] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_30px_rgba(0,0,0,.45)]"
      role="dialog"
      aria-label="Email the findings"
    >
      {/* Drag handle — obvious swipe-down/tap affordance to dismiss (mobile: the
          sheet must never feel like it's trapping the content the visitor came for). */}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="mx-auto mb-2 flex h-5 w-full max-w-[120px] items-center justify-center"
      >
        <span className="h-1.5 w-10 rounded-full bg-[#3A496A]" />
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#16223B] text-base font-bold text-[#CBD5E1] active:bg-[#22304C]"
      >
        ✕
      </button>
      <h4 className="pr-8 text-[15px] font-extrabold text-[#F1F5F9]">
        You&apos;ve read the whole thing.
      </h4>
      <p className="mt-1 text-[12.5px] text-[#8194B0]">
        Want the locked findings explained? I&apos;ll email them — free.
      </p>
      <div className="mt-2.5">
        <EmailCapture brandName={brandName} brandSlug={brandSlug} surface="sheet" />
      </div>
      <button
        onClick={dismiss}
        className="mt-2 w-full py-1 text-center text-[12px] font-semibold text-[#8194B0] active:text-[#CBD5E1]"
      >
        Not now
      </button>
    </div>
  );
}
