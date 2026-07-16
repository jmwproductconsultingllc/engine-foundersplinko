"use client";

// components/EmailCapture.tsx — the "Send me my analysis" capture (spec §2, §5, §6).
// Delivery-framed, NOT a wall: it renders below the teaser and never gates it.
// Replaces the old client-only "snapshot" facade (spec §9 — carry over only the
// DOM slot). Posts to /api/lead, which persists + sends the real report email.
//
// Junk filter, zero-friction (spec §5): client-side regex, a hidden honeypot,
// and the server flags disposable domains. No captcha, no upfront verification.

import { useState } from "react";
import { track } from "@/lib/analytics";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// First-touch attribution — read the SAME cookie middleware set (fe_utm), so a
// lead's utm/gclid match its eventual purchase attribution (spec §4: "not a
// fresh URL read at submit time"). Left null if the cookie isn't present.
function readFirstTouch(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|;\s*)fe_utm=([^;]+)/);
  if (!m) return {};
  try {
    return JSON.parse(decodeURIComponent(m[1])) as Record<string, string>;
  } catch {
    return {};
  }
}

export default function EmailCapture({
  brandName,
  brandSlug,
  capitalEntered,
  refTag,
}: {
  brandName: string;
  brandSlug: string;
  capitalEntered?: number | null;
  refTag?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState(""); // §5.4 — humans never touch this
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
    });
    try {
      const ft = readFirstTouch();
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: brandSlug,
          email,
          honeypot,
          context: {
            brandName,
            capital_entered: capitalEntered ?? null,
            device,
            utm_source: ft.utm_source ?? null,
            utm_medium: ft.utm_medium ?? null,
            utm_campaign: ft.utm_campaign ?? null,
            utm_content: ft.utm_content ?? null,
            gclid: ft.gclid ?? null,
          },
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        if (data.sent) track("lead_email_sent", { brandSlug, device });
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
        Not ready to decide? Email yourself this analysis.
      </h3>
      <p className="mt-1 text-[13px] text-[#8194B0]">
        Franchise decisions take time — sleep on it, or send it to your partner. We&apos;ll email you
        this {brandName} analysis with a link to pick up where you left off.
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
        {/* honeypot: off-screen, not tabbable, not autocompleted — bots fill it */}
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
