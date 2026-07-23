"use client";

// components/CaptureContext.tsx — one shared capture state per page (Capture v2
// coordination fix, Jul 23). A brand page can show up to FOUR email-capture
// surfaces (inline, calculator, playbook, slide-up sheet). Before this, each held
// independent local state: a submit on one did NOT tell the others, so the sheet
// kept re-soliciting after a successful capture → the first real paid lead
// double-submitted and was double-emailed (session 019f8fb5…).
//
// Now every surface subscribes here. On the first successful capture we record
// { captured, capturedEmail, capturedSurface }; the submitting surface shows its
// success + optional enrich, and every OTHER surface collapses to a compact
// "You're in ✓" and stops soliciting. The sheet auto-closes. useCapture() is
// null-safe so a surface rendered outside a provider (e.g. the report teaser)
// still works standalone.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface CaptureState {
  captured: boolean;
  capturedEmail: string | null;
  /** which surface won the capture — the submitter shows success; others collapse */
  capturedSurface: string | null;
  markCaptured: (email: string, surface: string) => void;
}

const CaptureCtx = createContext<CaptureState | null>(null);

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [captured, setCaptured] = useState(false);
  const [capturedEmail, setCapturedEmail] = useState<string | null>(null);
  const [capturedSurface, setCapturedSurface] = useState<string | null>(null);

  const markCaptured = useCallback((email: string, surface: string) => {
    setCaptured(true);
    setCapturedEmail((prev) => prev ?? email);
    // First capture wins the "submitter" tag — a later duplicate submit on
    // another surface never steals it (and is deduped server-side anyway).
    setCapturedSurface((prev) => prev ?? surface);
  }, []);

  return (
    <CaptureCtx.Provider value={{ captured, capturedEmail, capturedSurface, markCaptured }}>
      {children}
    </CaptureCtx.Provider>
  );
}

/** null when used outside a provider — callers must guard (surfaces stay standalone). */
export function useCapture(): CaptureState | null {
  return useContext(CaptureCtx);
}
