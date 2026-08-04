// lib/captureButtons.test.ts — THE FULFILLMENT LINT.
//
// Two live defects, reported 2026-08-04 from a Resend dashboard showing three
// sends in fifteen days, all to Jason himself:
//
//   1. Playbook emails "not firing". They were not failing — they were being
//      DEDUPED. claimEmailSend's compare-and-set was `.eq("email_sent", false)`
//      with no time box, and leads upsert on (email, brand_slug), so the first
//      submit from an address on a slug claimed the fulfillment FOREVER. Every
//      submit after it lost the claim, sent nothing, and returned HTTP 200
//      { ok: true } — which the client renders as "Sent — check your inbox."
//      Ten submits, one email, ten successes reported.
//
//   2. Broker Save needing several clicks. The enrich throttle wrote its
//      timestamp BEFORE comparing, so a rejected call pushed the window forward.
//      Clicking every 1.5s never landed; the only escape was to stop clicking.
//      And the client had no else branch on the save, so a 429 changed nothing
//      on screen — the UI after a failed save was identical to before the click,
//      which leaves a reader exactly one move: click again, into the same wall.
//
// Both are the same class and it is worth naming: A FAILURE THAT REPORTS
// SUCCESS IS WORSE THAN A CRASH. A crash gets fixed the day it lands. These two
// ran for a week against the only lead magnet that has ever converted.
//
// MUTATION-PROVEN — see the header block above the last describe.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ─── fake Supabase, so claimEmailSend is exercised for real ──────────────────
type Row = { id: string; email_sent: boolean; email_sent_at: string | null };
const rows = new Map<string, Row>();

function builder(table: string) {
  let patch: Record<string, unknown> = {};
  const preds: Array<(r: Row) => boolean> = [];
  const api = {
    update(p: Record<string, unknown>) {
      patch = p;
      return api;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
      return api;
    },
    /** PostgREST `.or("a.eq.false,b.lt.X")` — AND'd against the other filters. */
    or(expr: string) {
      const clauses = expr.split(",").map((c) => {
        const [col, op, ...rest] = c.split(".");
        const val = rest.join(".");
        return (r: Row) => {
          const cur = (r as unknown as Record<string, unknown>)[col];
          if (op === "eq") return String(cur) === val;
          if (op === "lt") return cur != null && String(cur) < val;
          return false;
        };
      });
      preds.push((r) => clauses.some((c) => c(r)));
      return api;
    },
    select() {
      const hit = [...rows.values()].filter((r) => preds.every((p) => p(r)));
      hit.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    },
  };
  void table;
  return api;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (t: string) => builder(t) }),
}));

const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  rows.clear();
});
afterEach(() => vi.useRealTimers());

// ─────────────────────────────────────────────────────────────────────────────
describe("FULFILLMENT LINT — the claim expires", () => {
  it("FLOOR — the fake DB actually applies filters (an always-winning fake proves nothing)", async () => {
    const { claimEmailSend } = await import("./supabaseLeads");
    // No row at all -> nothing matches -> the claim must be LOST, not won.
    expect(await claimEmailSend(LEAD)).toBe(false);
    // A malformed id never reaches the DB.
    expect(await claimEmailSend("not-a-uuid")).toBe(false);
  });

  it("an unsent lead wins the claim and records when", async () => {
    const { claimEmailSend } = await import("./supabaseLeads");
    rows.set(LEAD, { id: LEAD, email_sent: false, email_sent_at: null });
    expect(await claimEmailSend(LEAD)).toBe(true);
    expect(rows.get(LEAD)!.email_sent).toBe(true);
    expect(
      rows.get(LEAD)!.email_sent_at,
      "email_sent_at must be written on every win, or the next claim can never expire",
    ).toBeTruthy();
  });

  it("a second submit INSIDE the window still loses — the double-submit fix is intact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    const { claimEmailSend, RESEND_WINDOW_MS } = await import("./supabaseLeads");
    rows.set(LEAD, { id: LEAD, email_sent: false, email_sent_at: null });
    expect(await claimEmailSend(LEAD)).toBe(true);
    vi.advanceTimersByTime(RESEND_WINDOW_MS - 1_000);
    expect(await claimEmailSend(LEAD)).toBe(false);
  });

  it("THE FIX — a submit OUTSIDE the window wins again, so a person who did not get the email can ask twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    const { claimEmailSend, RESEND_WINDOW_MS } = await import("./supabaseLeads");
    rows.set(LEAD, { id: LEAD, email_sent: false, email_sent_at: null });
    expect(await claimEmailSend(LEAD)).toBe(true);
    vi.advanceTimersByTime(RESEND_WINDOW_MS + 1_000);
    expect(
      await claimEmailSend(LEAD),
      "a claim older than the window must be re-winnable — this is the whole defect",
    ).toBe(true);
  });

  it("A ROW LEFT OVER FROM BEFORE THE MIGRATION (email_sent true, email_sent_at NULL) must not be locked out forever", async () => {
    const { claimEmailSend } = await import("./supabaseLeads");
    rows.set(LEAD, { id: LEAD, email_sent: true, email_sent_at: null });
    // NULL fails `lt`, so the CODE cannot save this row — the MIGRATION must.
    expect(await claimEmailSend(LEAD)).toBe(false);
    const sql = readFileSync("scripts/lead-resend-window.sql", "utf8");
    expect(sql, "the migration must add the column").toMatch(
      /ADD COLUMN IF NOT EXISTS email_sent_at/,
    );
    expect(
      sql,
      "and must BACKFILL existing sent rows, or it locks in the bug for exactly the cohort that has it",
    ).toMatch(/UPDATE public\.leads[\s\S]*SET email_sent_at[\s\S]*WHERE email_sent IS TRUE/);
  });

  it("the window is a real duration, not zero or infinity", async () => {
    const { RESEND_WINDOW_MS } = await import("./supabaseLeads");
    expect(RESEND_WINDOW_MS).toBeGreaterThan(30_000);
    expect(RESEND_WINDOW_MS).toBeLessThan(60 * 60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FULFILLMENT LINT — a builder that throws must not keep the claim", () => {
  it("/api/lead wraps the send* calls, so a throw releases instead of 500ing", () => {
    const src = readFileSync("app/api/lead/route.ts", "utf8");
    const block = src.slice(src.indexOf("const claimed = await claimEmailSend"));
    const tryAt = block.indexOf("try {");
    /* COMMENTS ARE NOT CODE. First pass anchored on the bare substring
       "sendPlaybookEmail", and the comment ABOVE the try block explains the
       defect by name — so the assertion measured against the prose and failed
       on a correct file. Anchor to the assignment, which only the call has. */
    const sendAt = block.search(/sent = await sendPlaybookEmail/);
    const relAt = block.search(/if \(!sent\) await releaseEmailSend/);
    expect(tryAt, "the fulfillment branch must open a try").toBeGreaterThan(-1);
    expect(tryAt, "the try must open BEFORE the first send call").toBeLessThan(sendAt);
    expect(block.indexOf("} catch"), "and must catch").toBeGreaterThan(sendAt);
    expect(relAt, "releaseEmailSend must run AFTER the catch, not inside the try").toBeGreaterThan(
      block.indexOf("} catch"),
    );
  });

  it("sendPlaybookEmail guards liveBrandCount — the PDF ships even when the count cannot be computed", () => {
    const src = readFileSync("lib/leadEmail.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function sendPlaybookEmail"));
    const body = fn.slice(0, fn.indexOf("\n// ── 3 ·"));
    expect(body, "the brand-count await must sit inside a try").toMatch(
      /try \{[\s\S]*await liveBrandCount\(\)[\s\S]*\} catch/,
    );
    expect(body, "and must fall back to prose, never to a bare number or an empty string").toMatch(
      /let brandCount = "the library"/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("THE THREE BUTTONS — the throttle must not reset on the reject", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const post = (body: unknown) =>
    new Request("https://engine.foundersplinko.com/api/lead/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never;

  it("FLOOR — the throttle still exists and still rejects a genuine hammer", async () => {
    vi.doMock("./supabaseLeads", () => ({ enrichLead: vi.fn(async () => true) }));
    vi.resetModules();
    const { POST } = await import("../app/api/lead/enrich/route");
    const a = await (await POST(post({ id: ID, first_name: "A" }))).json();
    const b = await (await POST(post({ id: ID, first_name: "B" }))).json();
    expect(a.ok).toBe(true);
    expect(b, "two calls in the same millisecond must throttle").toMatchObject({
      ok: false,
      error: "slow_down",
    });
    vi.doUnmock("./supabaseLeads");
  });

  it("THE FIX — name, then phone, then broker, filled at human speed, all three land", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    vi.doMock("./supabaseLeads", () => ({ enrichLead: vi.fn(async () => true) }));
    vi.resetModules();
    const { POST } = await import("../app/api/lead/enrich/route");

    const name = await (await POST(post({ id: ID, first_name: "Jason" }))).json();
    expect(name.ok).toBe(true);

    // 1.5s later — typed a phone number, hit Request walkthrough.
    vi.advanceTimersByTime(1_500);
    const phone = await (
      await POST(post({ id: ID, phone: "5555550100", phone_consent: true }))
    ).json();
    expect(phone, "the second field must not be throttled at human typing speed").toMatchObject({
      ok: true,
    });

    // 1.2s later — typed the broker, hit Save. THIS is the click Jason had to
    // repeat: under the old rolling window it was rejected, and each retry
    // pushed the window forward again.
    vi.advanceTimersByTime(1_200);
    const broker = await (await POST(post({ id: ID, broker_name: "Ross" }))).json();
    expect(broker, "broker Save must land on the FIRST click").toMatchObject({ ok: true });

    vi.doUnmock("./supabaseLeads");
  });

  it("a rejected call must NOT extend the window — otherwise clicking again is what keeps it broken", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    vi.doMock("./supabaseLeads", () => ({ enrichLead: vi.fn(async () => true) }));
    vi.resetModules();
    const { POST } = await import("../app/api/lead/enrich/route");

    /* THE TIMINGS ARE THE TEST. First draft of this advanced 1000ms after the
       reject, and 1000 is past a 400ms window measured from EITHER event — so
       the set-before-compare mutation survived it. The gap must straddle: past
       the window when measured from the SUCCESS, inside it when measured from
       the REJECT. Only then does the assertion distinguish the two. A TEST
       WHOSE NUMBERS BOTH IMPLEMENTATIONS SATISFY IS NOT A TEST. */
    expect((await (await POST(post({ id: ID, first_name: "A" }))).json()).ok).toBe(true);

    // t=300 — inside the 400ms window. Rejected, correctly.
    vi.advanceTimersByTime(300);
    expect((await (await POST(post({ id: ID, first_name: "B" }))).json()).ok).toBe(false);

    // t=450 — 450ms past the SUCCESS (outside the window) but only 150ms past
    // the REJECT (inside it). Under set-before-compare this call is throttled.
    vi.advanceTimersByTime(150);
    expect(
      (await (await POST(post({ id: ID, first_name: "C" }))).json()).ok,
      "the window is measured from the last SUCCESS, never from the last reject",
    ).toBe(true);

    vi.doUnmock("./supabaseLeads");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * THE SILENT-SAVE LINT.
 *
 * MUTATION-PROVEN. Each mutation was applied to the working tree, this file run,
 * the red count recorded, and the mutation reverted (measured 2026-08-04, on a
 * 19-test baseline):
 *
 *   drop the `.or(...)` from claimEmailSend (the original bug) ....... 2 red
 *   drop `email_sent_at` from the claim patch ....................... 2 red
 *   move `seen.set(id, now)` back above the comparison .............. 1 red
 *   THROTTLE_MS 400 -> 2000 (the original window) ................... 2 red
 *   delete the `else { setSaveFailed(kind) }` branch ................ 4 red
 *   drop `|| saving !== null` from the broker button ................ 1 red
 *   drop the try/catch around the send* calls in /api/lead .......... 1 red
 *   unguard `await liveBrandCount()` ................................ 1 red
 *   delete the backfill UPDATE from the migration ................... 1 red
 *
 * TWO HOLES THE RUN FOUND IN THIS FILE, BOTH NOW FIXED ABOVE.
 *
 * (a) The /api/lead try-placement assertion anchored on the bare substring
 *     "sendPlaybookEmail" — and the comment above the try names it, so the
 *     check measured against prose and went red on a CORRECT file. Anchored to
 *     `sent = await sendPlaybookEmail` now. COMMENTS ARE NOT CODE; this is the
 *     third time that has been literally true in this repo.
 *
 * (b) The set-before-compare mutation SURVIVED the first draft at 0 red. The
 *     reject-window test advanced 1000ms, which is outside a 400ms window
 *     measured from either the success or the reject — so both implementations
 *     satisfied it. The gap now straddles (300 / 450). A TEST WHOSE NUMBERS
 *     BOTH IMPLEMENTATIONS SATISFY IS NOT A TEST, and a mutation run is the
 *     only thing that tells you which kind you wrote.
 */
describe("THE SILENT-SAVE LINT — a failed save must look different from a successful one", () => {
  const SRC = readFileSync("components/EmailCapture.tsx", "utf8");
  const BODY = (() => {
    const i = SRC.indexOf("async function saveEnrichment");
    return SRC.slice(i, SRC.indexOf("\n  /** Shared failure line", i));
  })();

  it("FLOOR — the handler was actually located", () => {
    expect(BODY.length).toBeGreaterThan(400);
    expect(BODY).toContain("/api/lead/enrich");
  });

  it("saveEnrichment has an else branch — ok:false must change the screen", () => {
    expect(BODY, "a save that fails must set failure state, not fall through silently").toMatch(
      /\} else \{[\s\S]*setSaveFailed\(kind\)/,
    );
  });

  it("and the catch sets it too — a dropped connection is a failed save, not a no-op", () => {
    expect(BODY).toMatch(/\} catch \{[\s\S]*setSaveFailed\(kind\)[\s\S]*\} finally/);
  });

  it("the in-flight guard is on both ends: the handler returns early AND the buttons disable", () => {
    expect(BODY, "handler-side guard").toMatch(/if \(!leadId \|\| saving\) return/);
    for (const [label, re] of [
      ["name", /disabled=\{!firstName\.trim\(\) \|\| saving !== null\}/],
      ["phone", /disabled=\{!consent && false|saving !== null\}/],
      ["broker", /disabled=\{!broker\.trim\(\) \|\| saving !== null\}/],
    ] as const) {
      expect(SRC, `${label} Save must disable while a request is in flight`).toMatch(re);
    }
  });

  it("all three buttons render a pending label, so the click is visibly received", () => {
    expect(SRC).toMatch(/saving === "name" \? "Saving…"/);
    expect(SRC).toMatch(/saving === "phone" \? "Sending…"/);
    expect(SRC).toMatch(/saving === "broker" \? "Saving…"/);
  });

  it("all three render the failure line — one shared helper, so they cannot drift apart", () => {
    for (const kind of ["name", "phone", "broker"]) {
      expect(SRC, `${kind} must render saveError`).toContain(`{saveError("${kind}")}`);
    }
    expect(
      (SRC.match(/\{saveError\("/g) ?? []).length,
      "exactly three call sites — add a fourth field and you must add a fourth line",
    ).toBe(3);
  });

  it("the failure copy is amber, never red — LABEL LAW holds here too", () => {
    const fn = SRC.slice(SRC.indexOf("function saveError"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body).toContain("#FBBF24");
    expect(body).not.toMatch(/text-red-|#F87171|#EF4444/);
  });

  it("the migration ships in the repo — MIGRATION BEFORE CODE", () => {
    expect(existsSync("scripts/lead-resend-window.sql")).toBe(true);
  });
});
