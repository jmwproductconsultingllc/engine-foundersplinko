"use client";

// components/EmailCapture.tsx — P0 patch (2026-07-18).
// Changes vs v1:
//   1. `surface` prop → capture_surface on the lead_email_submitted event
//      ("inline" | "sheet" | "ask_link"), so we can read which surface produces leads.
//   2. BUGFIX: context now sends snake_case `capital_entered` / `device` — the
//      shipped /api/lead route reads ctx.capital_entered; the old camelCase
//      `capitalEntered` silently landed NULL in Supabase.
//   3. Posts { email, slug, honeypot, context } matching the shipped route
//      (no reportId — D1: nothing is minted in the nurture path).

import { useState } from "react";
import { track } from "@/lib/analytics";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailCapture({
  brandName,
  brandSlug,
  capitalEntered,
  refTag,
  surface = "inline",
}: {
  brandName: string;
  brandSlug: string;
  capitalEntered?: number | null;
  refTag?: string | null;
  surface?: "inline" | "sheet" | "ask_link";
}) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const device =
    typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop";

  async function submit() {
    if (!EMAIL_RE.test(email)) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    track("lead_email_submitted", {
      brandSlug,
      capitalEntered: capitalEntered ?? null,
      device,
      ref: refTag ?? "none",
      capture_surface: surface,
    });
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          slug: brandSlug,
          honeypot,
          context: {
            capital_entered: capitalEntered ?? null,
            device,
          },
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        if (data.sent) track("lead_email_sent", { brandSlug, device, capture_surface: surface });
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-[#34D399]/40 bg-[#34D399]/[0.06] p-5">
        <p className="text-sm font-semibold text-[#34D399]">
          Sent — check your inbox for your {brandName} analysis.
        </p>
        <p className="mt-1 text-[13px] text-[#8194B0]">
          The email has a link back to this analysis so you can review it later or forward it to a
          partner.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-[#3A496A] bg-[#16223B] p-5">
      <h3 className="text-base font-extrabold text-[#F1F5F9]">
        Not ready? Email yourself this analysis.
      </h3>
      <p className="mt-1 text-[13px] text-[#8194B0]">
        Sleep on it, or send it to your partner — pick up right where you left off.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="you@email.com"
          aria-label="Your email address"
          className="min-w-[200px] flex-1 rounded-lg border border-[#27344F] bg-[#0B1220] px-3.5 py-3 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
        />
        {/* honeypot: off-screen, not tabbable — bots fill it */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />
        <button
          onClick={submit}
          disabled={status === "sending"}
          className="rounded-lg bg-[#38BDF8] px-4 py-3 text-sm font-bold text-[#0B1220] disabled:opacity-60"
        >
          {status === "sending" ? "Sending…" : "Send my analysis"}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-[13px] text-red-400">
          That didn&apos;t go through — check the address and try again.
        </p>
      )}
      <p className="mt-2 text-[11px] text-[#586A88]">
        No spam. Your analysis plus one follow-up. Unsubscribe anytime.
      </p>
    </div>
  );
}
