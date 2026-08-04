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
import { track, identify } from "@/lib/analytics";
import { withArticle } from "@/lib/brandName";
import { useCapture } from "@/components/CaptureContext";

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

/**
 * `glass_playbook` is its own surface, not a reuse of `playbook`, and that is
 * deliberate. capture_surface is the only dimension separating the two page
 * types in PostHog; reuse the same value on both and the before/after read that
 * glass mode exists to produce collapses into a single bucket the day the flag
 * flips. It carries the same MAGNET as `playbook` and the same LEAD_SOURCE as
 * `playbook` — it differs only in where we asked, which is the one thing
 * capture_surface is for.
 *
 * `glass` was removed 2026-08-03 and replaced by `glass_playbook`. It shipped
 * 2026-07-30 with the twelve-questions magnet and, by side effect, wrote
 * lead_source "brand_findings" — so from 07-30 to 08-03 every glass-page
 * capture was silently split off from the only cohort that has ever converted,
 * and was fulfilled with the findings summary instead of the PDF. Nobody
 * decided that; a rendering refactor did. The questions magnet may well be the
 * better one, but it does not get to replace the instrument with a track record
 * as a side effect. If we test it, we test it on purpose, from a known baseline.
 *
 * `glass` is GONE rather than left in the union unmounted, for the same reason
 * `ask_link` was removed 2026-07-30: a surface that sits here with full copy
 * defined and is mounted by nothing is dead code that still reads as a live
 * promise, which is exactly how a retired line comes back. The copy is one
 * `git show` away if we want the A/B.
 */
export type CaptureSurface =
  | "inline"
  | "sheet"
  | "calculator"
  | "playbook"
  | "glass_playbook";
type LeadSource = "brand_findings" | "playbook" | "capital_match";

/* lead_source, NOT capture_surface, is what /api/lead persists and what
   lib/leadEmail.ts branches on. Two surfaces map to "playbook" on purpose:
   where we asked is a client + analytics fact, what we send is a fulfillment
   fact, and collapsing them is what produced the 07-30 regression. Adding a
   surface here is a client + analytics change only — the API validates
   lead_source and has never seen this union.

   Exported for THE CONVERSION SURFACE LINT, which asserts that each surface
   the glass page mounts still resolves to the lead_source its cohort was
   recorded under. Exported rather than regex-scraped on purpose: a lint that
   reads this map as text goes green the moment the map is reformatted, and the
   thing being protected — that the glass ask still means `playbook` — is worth
   an assertion that cannot drift. Read-only by contract; nothing writes it. */
export const SOURCE_FOR: Record<CaptureSurface, LeadSource> = {
  inline: "brand_findings",
  sheet: "brand_findings",
  calculator: "capital_match",
  playbook: "playbook",
  glass_playbook: "playbook",
};

/**
 * THE PROMISE RULE (2026-07-30). Every headline here must describe something
 * this component can actually cause to arrive in an inbox.
 *
 * "Get the locked findings — free, by email" broke that. sendFindingsEmail()
 * is gated to category and severity language and never sends a dollar figure,
 * so "the locked findings, free" promised the paid product and delivered a
 * summary — fishy on the teaser, and outright incoherent on glass, where the
 * ask would sit inches from a $199 button on a page where every number is an
 * empty span. It also converted at approximately nothing, so there is no
 * traffic to protect.
 *
 * What the email demonstrably DOES carry is TWELVE_QUESTIONS verbatim plus the
 * who-to-ask tease — its own preheader is "The 12 questions to ask before you
 * sign — and who to ask." So the copy now sells the questions. That is both
 * the honest promise and the one that does not compete with the report.
 */
const COPY: Record<CaptureSurface, { h: string; sub: string; btn: string; fine: string }> = {
  inline: {
    h: "Not ready to buy? Take the questions with you.",
    // {Brand} = the real name, article and all — the possessive reads correctly
    // as "what The UPS Store's own audited financials ... disclose".
    // {AnBrand} = the article-consuming slot. NEVER write "a {Brand}" here: that
    // renders "a The UPS Store franchisee" and "a Anytime Fitness franchisee".
    sub: "I'll email you the 12 questions to ask {AnBrand} franchisee before you sign — and which {Brand} FDD Items carry the answers. Free.",
    btn: "Email me the questions",
    fine: "No spam. The questions + one follow-up. Unsubscribe anytime.",
  },
  sheet: {
    h: "You've read the whole thing.",
    sub: "Take the 12 questions with you — I'll email them free, plus which {Brand} FDD Items carry the answers.",
    btn: "Email me the questions",
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
    /* #65. "one follow-up" was a COUNT, and no code in this repo honours it.
       lib/leadEmail.ts labels sendPlaybookEmail "nurture email #1" and there is
       no #2 — so the line has been under-delivering since it shipped, and the
       moment a #2 exists it starts over-promising instead. A number that is
       wrong in both directions is not a number worth keeping.

       Names the SHAPE of the relationship rather than its cardinality, which is
       the only honest thing this component can say about mail it does not send.
       Standing rule, same family as "name the output, never the cutoff": do not
       promise a quantity a downstream system decides. */
    fine: "No spam. The Playbook, then occasional notes as you go. Unsubscribe anytime.",
  },
  /* Restored to the glass page 2026-08-03. h / sub / btn are the `playbook`
     block above VERBATIM, and that is the requirement, not a coincidence: this
     is a restore, not a rewrite. The four leads this cohort is meant to extend
     were captured by these exact words, and a magnet whose copy drifts is a
     different magnet wearing the same lead_source. If you improve this line,
     improve the one above it in the same commit, or the comparison dies.

     `fine` is the ONE line that differs, and it differs twice over:

       1. the corrected #65 promise (see the note above) — a count nothing in
          this repo honours, replaced by the shape of the relationship;
       2. plus the glass-only disambiguator that shipped on this page 07-30 and
          survives the magnet swap.

     (2) is load-bearing, not throat-clearing. Every figure on a glass page is
     an empty span, so a free offer here is read against the $199 button six
     inches above it — and the failure mode got WORSE with this change, not
     better: "the Playbook" is a generic PDF, and a reader who half-skims it as
     "the report, free" churns on open and never comes back. Declining the
     promise out loud is what keeps the free ask from cannibalising the paid
     one. Do not trim it. */
  glass_playbook: {
    h: "Not sure where to start with a franchise?",
    sub: "Get our free Playbook — the 90-day checklist, cost worksheets, and location math the pros use, in plain English.",
    btn: "Get the free Playbook",
    fine: "No spam. The Playbook, then occasional notes as you go. Unsubscribe anytime. This email is not the report.",
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
  // S4 broker capture (Ross's warm-handoff loop) — optional, free-form.
  const [broker, setBroker] = useState("");
  const [brokerSaved, setBrokerSaved] = useState(false);
  // typed-intent telemetry: fire once per surface instance on first focus
  const [focusFired, setFocusFired] = useState(false);
  // shared cross-surface capture state (null if rendered without a provider)
  const capture = useCapture();

  const device =
    typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop";

  const copy = COPY[surface];
  const capStr = capitalEntered ? `$${capitalEntered.toLocaleString("en-US")}` : "your budget";
  // {AnBrand} first — it is the more specific token. ("{AnBrand}" does not
  // contain the literal "{Brand}", but ordering it first makes that safe by
  // construction rather than by accident if either token is ever renamed.)
  const sub = copy.sub
    .replaceAll("{AnBrand}", withArticle(brandName))
    .replaceAll("{Brand}", brandName)
    .replaceAll("{Capital}", capStr);
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
        // lead_email_sent fires only when the server actually dispatched — a
        // server-deduped duplicate returns sent:false, so it fires at most once.
        if (data.sent) track("lead_email_sent", { brandSlug, device, capture_surface: surface });
        if (typeof data.id === "string") {
          setLeadId(data.id);
          // Identify the anonymous PostHog session by the Supabase lead UUID
          // (NEVER the raw email) so pre-capture behavior joins to the lead.
          // Idempotent: a deduped re-submit returns the same id.
          identify(data.id);
        }
        try { sessionStorage.setItem("fe_capture_done", "1"); } catch {} // mount-time sheet gate
        // Broadcast to every other surface on the page: they collapse to "You're
        // in ✓" and the sheet auto-closes. This is the fix for the double-submit.
        capture?.markCaptured(email, surface);
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  async function saveEnrichment(kind: "name" | "phone" | "broker") {
    if (!leadId) return;
    const ctaId =
      kind === "name" ? "enrich_name_save" : kind === "phone" ? "enrich_phone_submit" : "enrich_broker_save";
    track("cta_clicked", { cta_id: ctaId, section: "capture" });
    const payload: Record<string, unknown> = { id: leadId };
    if (kind === "name") payload.first_name = firstName;
    if (kind === "phone") {
      payload.phone = phone;
      payload.phone_consent = consent;
    }
    if (kind === "broker") payload.broker_name = broker;
    try {
      const res = await fetch("/api/lead/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        if (kind === "broker") {
          setBrokerSaved(true);
          // Ross's warm-handoff loop + qualification signal (has-broker = real
          // process). Capture ONLY — buyer data is never sent to a named broker.
          track("broker_captured", { has_broker: broker.trim().length > 0 });
        } else {
          const next = enriched === "none" ? kind : "both";
          setEnriched(next);
          track("lead_enriched", { fields: next === "both" ? "name+phone" : next });
        }
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
            {/* S4 broker capture — optional, free-form. Capture ONLY: we never
                transmit buyer data to a named broker without clear awareness. */}
            {!brokerSaved ? (
              <div className="mt-3">
                <p className="text-[12.5px] text-[#8194B0]">
                  <span className="mr-1.5 rounded bg-[#27344F] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">
                    Optional
                  </span>
                  Working with a franchise consultant or broker? Tell us who, so we can coordinate.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={broker}
                    onChange={(e) => setBroker(e.target.value)}
                    placeholder="Broker or consultant name"
                    aria-label="Franchise consultant or broker (optional)"
                    className="min-w-[160px] flex-1 rounded-lg border border-[#27344F] bg-[#0B1220] px-3 py-2 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
                  />
                  <button
                    onClick={() => saveEnrichment("broker")}
                    disabled={!broker.trim()}
                    className="rounded-lg bg-[#27344F] px-3.5 py-2 text-sm font-bold text-[#CBD5E1] disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-[#8194B0]">Thanks — we&apos;ll coordinate.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // A sibling surface already captured (this one didn't submit) → stop
  // soliciting. Collapse to a compact confirmation instead of another form.
  if (capture?.captured) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[#34D399]/30 bg-[#34D399]/[0.06] px-4 py-3 text-[13px] font-semibold text-[#8FE3C0]">
        <span aria-hidden>✓</span>
        <span>You&apos;re in — check your inbox for the findings.</span>
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
          onFocus={() => {
            if (!focusFired) {
              setFocusFired(true);
              track("email_field_focused", { capture_surface: surface });
            }
          }}
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
