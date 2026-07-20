"use client";

// components/EmailCapture.tsx — Capture v2 (spec r2).
// One component, every surface: S1 inline (lead-magnet reframe), S2 sheet,
// S3 calculator, S5 playbook — the surface prop drives copy + capture_surface
// + lead_source. Includes:
//   · typo suggester (ruling #4 of spec §"quality via software") — never blocks
//   · S4 post-success enrichment (name; phone gated on capital_edited ≥ $150K,
//     consent checkbox required — TCPA; every non-email field carries a visible
//     "Optional" chip per the UI RULE)
//   · posts lead_source + capital_edited; reads { id } for the enrich PATCH
// COPY RULE (ruling #5): disclosure framing only — "our audit" is banned.

import { useState } from "react";
import { track } from "@/lib/analytics";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// small-list typo suggester (gmial→gmail etc). Suggestion only — never blocks.
const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com", "icloud.co": "icloud.com", "iclod.com": "icloud.com",
};
function suggestFix(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const fixed = DOMAIN_FIXES[domain];
  return fixed ? `${email.slice(0, at + 1)}${fixed}` : null;
}

export type CaptureSurface = "inline" | "sheet" | "calculator" | "playbook" | "ask_link";
type LeadSource = "brand_findings" | "playbook" | "capital_match";

const SOURCE_FOR: Record<CaptureSurface, LeadSource> = {
  inline: "brand_findings",
  sheet: "brand_findings",
  ask_link: "brand_findings",
  calculator: "capital_match",
  playbook: "playbook",
};

const COPY: Record<CaptureSurface, { h: string; sub: string; btn: string; fine: string }> = {
  inline: {
    h: "Get the locked findings — free, by email.",
    sub: "I'll send you a plain-English summary of what {Brand}'s own audited financials and FDD disclose, plus the 12 questions to ask a {Brand} franchisee before you sign anything.",
    btn: "Send me the findings",
    fine: "No spam. The findings + one follow-up. Unsubscribe anytime.",
  },
  ask_link: {
    h: "Get the locked findings — free, by email.",
    sub: "I'll send you a plain-English summary of what {Brand}'s own audited financials and FDD disclose, plus the 12 questions to ask a {Brand} franchisee before you sign anything.",
    btn: "Send me the findings",
    fine: "No spam. The findings + one follow-up. Unsubscribe anytime.",
  },
  sheet: {
    h: "You've read the whole thing.",
    sub: "Want the locked findings explained? I'll email them — free.",
    btn: "Email me the findings",
    fine: "No spam. Unsubscribe anytime.",
  },
  calculator: {
    h: "Brands that fit your budget",
    sub: "I'll email you the tracked brands whose disclosed Item 7 low end fits {Capital}.",
    btn: "Email me the list",
    fine: "No spam. One list + one follow-up. Unsubscribe anytime.",
  },
  playbook: {
    h: "Not sure where to start with a franchise?",
    sub: "Get our free Playbook — the 90-day checklist, cost worksheets, and location math the pros use, in plain English.",
    btn: "Get the free Playbook",
    fine: "No spam. The Playbook + one follow-up. Unsubscribe anytime.",
  },
};

export default function EmailCapture({
  brandName,
  brandSlug,
  capitalEntered,
  capitalEdited = false,
  refTag,
  surface = "inline",
}: {
  brandName: string;
  brandSlug: string;
  capitalEntered?: number | null;
  /** true only when the user touched the capital input (ruling #3 — the 250K default never enters the DB) */
  capitalEdited?: boolean;
  refTag?: string | null;
  surface?: CaptureSurface;
}) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  // S4 enrichment state
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [enriched, setEnriched] = useState<"none" | "name" | "phone" | "both">("none");

  const device =
    typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop";

  const copy = COPY[surface];
  const capStr = capitalEntered ? `$${capitalEntered.toLocaleString("en-US")}` : "your budget";
  const sub = copy.sub.replaceAll("{Brand}", brandName).replaceAll("{Capital}", capStr);
  const showPhoneOffer = capitalEdited === true && (capitalEntered ?? 0) >= 150_000;

  async function submit() {
    if (!EMAIL_RE.test(email)) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    track("lead_email_submitted", {
      brandSlug,
      capitalEntered: capitalEdited ? capitalEntered ?? null : null,
      device,
      ref: refTag ?? "none",
      capture_surface: surface,
      lead_source: SOURCE_FOR[surface],
    });
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          slug: brandSlug,
          honeypot,
          lead_source: SOURCE_FOR[surface],
          context: {
            capital_entered: capitalEdited ? capitalEntered ?? null : null,
            capital_edited: capitalEdited === true,
            device,
          },
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        if (data.sent) track("lead_email_sent", { brandSlug, device, capture_surface: surface });
        if (typeof data.id === "string") setLeadId(data.id);
        try { sessionStorage.setItem("fe_capture_done", "1"); } catch {} // suppresses the S2 sheet
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  async function saveEnrichment(kind: "name" | "phone") {
    if (!leadId) return;
    track("cta_clicked", { cta_id: kind === "name" ? "enrich_name_save" : "enrich_phone_submit", section: "capture" });
    const payload: Record<string, unknown> = { id: leadId };
    if (kind === "name") payload.first_name = firstName;
    if (kind === "phone") {
      payload.phone = phone;
      payload.phone_consent = consent;
    }
    try {
      const res = await fetch("/api/lead/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        const next = enriched === "none" ? kind : "both";
        setEnriched(next);
        track("lead_enriched", { fields: next === "both" ? "name+phone" : next });
      }
    } catch {
      /* enrichment is best-effort; the email is already banked */
    }
  }

  // ── success state + S4 enrichment ──
  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-[#34D399]/40 bg-[#34D399]/[0.06] p-5">
        <p className="text-sm font-semibold text-[#34D399]">Sent — check your inbox.</p>
        {leadId && (
          <div className="mt-3 border-t border-[#27344F] pt-3">
            <p className="text-[12.5px] font-bold text-[#CBD5E1]">
              Optional — make the follow-ups useful:
            </p>
            {enriched !== "name" && enriched !== "both" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#27344F] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">
                  Optional
                </span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  aria-label="First name (optional)"
                  className="min-w-[140px] flex-1 rounded-lg border border-[#27344F] bg-[#0B1220] px-3 py-2 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
                />
                <button
                  onClick={() => saveEnrichment("name")}
                  disabled={!firstName.trim()}
                  className="rounded-lg bg-[#27344F] px-3.5 py-2 text-sm font-bold text-[#CBD5E1] disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] text-[#8194B0]">Thanks, {firstName.trim()}.</p>
            )}
            {showPhoneOffer && enriched !== "phone" && enriched !== "both" && (
              <div className="mt-3">
                <p className="text-[12.5px] text-[#8194B0]">
                  <span className="mr-1.5 rounded bg-[#27344F] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">
                    Optional
                  </span>
                  Want a 10-minute walkthrough of the flagged finding? Leave a number and I&apos;ll
                  call or text to schedule.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 555-0100"
                    inputMode="tel"
                    aria-label="Phone number (optional)"
                    className="min-w-[150px] flex-1 rounded-lg border border-[#27344F] bg-[#0B1220] px-3 py-2 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
                  />
                  <button
                    onClick={() => saveEnrichment("phone")}
                    disabled={!consent || phone.replace(/\D/g, "").length < 10}
                    className="rounded-lg bg-[#38BDF8] px-3.5 py-2 text-sm font-bold text-[#0B1220] disabled:opacity-50"
                  >
                    Request walkthrough
                  </button>
                </div>
                <label className="mt-2 flex items-start gap-2 text-[11.5px] text-[#8194B0]">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>OK to text/call me about this analysis.</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-[#3A496A] bg-[#16223B] p-5">
      <h3 className="text-base font-extrabold text-[#F1F5F9]">{copy.h}</h3>
      <p className="mt-1 text-[13px] text-[#8194B0]">{sub}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSuggestion(suggestFix(e.target.value));
            if (status === "error") setStatus("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="you@email.com"
          aria-label="Your email address"
          className="min-w-[200px] flex-1 rounded-lg border border-[#27344F] bg-[#0B1220] px-3.5 py-3 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
        />
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
          {status === "sending" ? "Sending…" : copy.btn}
        </button>
      </div>
      {suggestion && (
        <p className="mt-2 text-[12.5px] text-[#8194B0]">
          Did you mean{" "}
          <button
            onClick={() => {
              setEmail(suggestion);
              setSuggestion(null);
            }}
            className="font-bold text-[#38BDF8] underline"
          >
            {suggestion}
          </button>
          ?
        </p>
      )}
      {status === "error" && (
        <p className="mt-2 text-[13px] text-red-400">
          That didn&apos;t go through — check the address and try again.
        </p>
      )}
      <p className="mt-2 text-[11px] text-[#586A88]">{copy.fine}</p>
    </div>
  );
}
