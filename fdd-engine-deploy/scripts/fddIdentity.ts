// scripts/fddIdentity.ts
// THE CHEAP IDENTITY PASS. Reads only the cover pages and the Receipt pages of an
// FDD and returns who issued it and when — with NO model call and NO API cost.
//
//   npx tsx scripts/fddIdentity.ts <file.pdf|dir> [more...] [--json] [--dump]
//
// WHY THIS EXISTS
// ---------------
// Today identity (brandName, franchisorEntity) is a field on the ~$2 extraction
// call, which means you must BUY the answer before you can use the answer to
// avoid buying it. That ordering makes de-duplication impossible. This module
// inverts it: identity first, cheap, then decide whether to pay.
//
// It also answers the question the catalog cannot: what year is this FDD? Every
// record in data/brands/ carries sourceFddYear: null except one. Guessing "2026"
// for all of them would print a claim we never read. This measures it instead.
//
// WHAT THE LAW GIVES US (and what it does not)
// --------------------------------------------
// 16 CFR 436.3 requires the ISSUANCE DATE on the FDD cover page. 16 CFR 436.5(w)
// requires a Receipt at the back that restates the franchisor's name and the same
// issuance date. Those are two INDEPENDENT statements of the same fact, roughly
// 300 pages apart, so agreement between them is real evidence and disagreement is
// a real warning — not a coin flip we resolve by preferring one.
//
// THE THREE DECOYS. An FDD is full of dates that are not the issuance date:
//   1. The STATE EFFECTIVE DATES table — per-state, often a dozen dates, and it
//      can straddle a year boundary. Nearest-date-to-the-top would grab these.
//   2. The Item 21 audited financials — the fiscal year END, almost always the
//      PRIOR year. This is the decoy that would systematically age the catalog
//      down by one year.
//   3. Amendment dates.
// The reader strips the state table off the cover before searching, and never
// looks at a page that could carry (2) or (3).
//
// CONFIDENCE IS NOT DECORATION. A row that says "unresolved" is doing its job.
// A figure that cannot be verified gets WORDS, not a default. Nothing in here
// falls back to the current year — ever.

import fs from "node:fs";
import path from "node:path";
import { getDocumentProxy } from "unpdf";

// ── how much of the document we touch ──────────────────────────────────────────
// The cover is page 1, but a fair number of FDDs put a blank or a logo plate
// first, so we take the first 3. The Receipt is the LAST thing in the document by
// rule, but many franchisors bind two copies (one to keep, one to return) plus a
// state addendum after it, so we take the last 6.
const COVER_PAGES = 3;
const RECEIPT_PAGES = 6;

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "April 1, 2026" / "1 April 2026" / "April 2026"
const DATE_LONG = new RegExp(`${MONTH}\\s+\\d{1,2}\\s*,?\\s*(?:19|20)\\d{2}`, "gi");
const DATE_DAY_FIRST = new RegExp(`\\d{1,2}\\s+${MONTH}\\s*,?\\s*(?:19|20)\\d{2}`, "gi");
const DATE_MONTH_YEAR = new RegExp(`${MONTH}\\s*,?\\s*(?:19|20)\\d{2}`, "gi");
const DATE_NUMERIC = /\b(0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])[\/\-.]((?:19|20)\d{2})\b/g;

// The label the rule actually mandates, plus the phrasings franchisors use for it.
const STRONG_LABEL =
  /(issuance\s*date|date\s*of\s*issuance|issued\s*(?:on)?|issue\s*date)/i;
// Weaker: these are USUALLY the issuance date on a cover page, but "effective"
// is also the word the state table uses, so a hit here is medium, never high.
const WEAK_LABEL = /(effective\s*date|dated\s*(?:as\s*of)?|date\s*of\s*this\s*(?:disclosure\s*)?document)/i;

const ENTITY_SUFFIX =
  /\b(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|LP|L\.P\.|LLP|Ltd\.?|Limited|PLLC|Holdings)\b/i;

// Lines on a cover page that are boilerplate, not identity.
const COVER_NOISE =
  /^(?:franchise\s+disclosure\s+document|disclosure\s+document|item\s+\d|exhibit\s|table\s+of\s+contents|state\s+cover\s+page|the\s+franchise|no\s+governmental|this\s+disclosure|if\s+.{0,60}franchise)/i;

export interface IdentityRead {
  file: string;
  pages: number;
  /** Legal entity as printed on the cover (never a slug, never inferred). */
  franchisorEntity: string | null;
  /** Best-effort trade name. Cover text loses font size, so this is a HINT. */
  brandHint: string | null;
  /** ISO yyyy-mm-dd when a day is printed; yyyy-mm when only a month is. */
  issuanceDate: string | null;
  issuanceYear: number | null;
  confidence: "high" | "medium" | "low" | "unresolved";
  /** Why the confidence is what it is. Always populated. */
  reason: string;
  coverDate: string | null;
  receiptDate: string | null;
  receiptEntity: string | null;
  ms: number;
}

// ── text plumbing ──────────────────────────────────────────────────────────────

function squash(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

function normDate(raw: string): { iso: string; year: number; hasDay: boolean } | null {
  const s = squash(raw).replace(/,/g, " ").replace(/\s+/g, " ");

  const num = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]((?:19|20)\d{2})$/);
  if (num) {
    const [, m, d, y] = num;
    return {
      iso: `${y}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`,
      year: +y,
      hasDay: true,
    };
  }

  const mon = s.match(new RegExp(`^(${MONTH})\\s+(\\d{1,2})\\s+((?:19|20)\\d{2})$`, "i"));
  if (mon) {
    const m = MONTH_INDEX[mon[1].slice(0, 3).toLowerCase()];
    return {
      iso: `${mon[3]}-${String(m).padStart(2, "0")}-${String(+mon[2]).padStart(2, "0")}`,
      year: +mon[3],
      hasDay: true,
    };
  }

  const dayFirst = s.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+((?:19|20)\\d{2})$`, "i"));
  if (dayFirst) {
    const m = MONTH_INDEX[dayFirst[2].slice(0, 3).toLowerCase()];
    return {
      iso: `${dayFirst[3]}-${String(m).padStart(2, "0")}-${String(+dayFirst[1]).padStart(2, "0")}`,
      year: +dayFirst[3],
      hasDay: true,
    };
  }

  const my = s.match(new RegExp(`^(${MONTH})\\s+((?:19|20)\\d{2})$`, "i"));
  if (my) {
    const m = MONTH_INDEX[my[1].slice(0, 3).toLowerCase()];
    return { iso: `${my[2]}-${String(m).padStart(2, "0")}`, year: +my[2], hasDay: false };
  }
  return null;
}

const STATE_TABLE_HEADING =
  /(state\s+effective\s+dates?|effective\s+dates?\s+for\s+(?:the\s+)?(?:various\s+)?states?|the\s+following\s+states\s+have\s+approved)/gi;
/** How much text after the heading we assume the table occupies. */
const STATE_TABLE_SPAN = 2600;

/**
 * THE STATE-TABLE GUARD. The per-state effective-date table is the single most
 * dangerous thing in an FDD for this job: a dozen plausible dates in a column
 * that can straddle a year boundary, so picking from it is not merely imprecise
 * — it can be wrong by a whole year in either direction.
 *
 * It EXCISES a bounded window rather than truncating from the heading onward.
 * That distinction is not cosmetic. In Five Iron's FDD the state effective-date
 * table sits in the state addenda at page ~246 and the Receipt — the entire
 * point of reading the back of the document — follows it. Truncating threw the
 * Receipt away and silently downgraded every file to "no cross-check available."
 * A guard that eats the evidence it was written to protect is worse than no
 * guard, because it fails quietly and looks like a property of the corpus.
 *
 * The window also stops early at a RECEIPT heading or an Issuance Date label,
 * so a short table never swallows what comes after it.
 */
function stripStateTable(text: string): { text: string; stripped: boolean } {
  STATE_TABLE_HEADING.lastIndex = 0;
  const cuts: Array<[number, number]> = [];
  for (const m of text.matchAll(STATE_TABLE_HEADING)) {
    if (m.index == null) continue;
    const start = m.index;
    const windowEnd = Math.min(start + STATE_TABLE_SPAN, text.length);
    const after = text.slice(start + m[0].length, windowEnd);
    const stop = after.search(/\bRECEIPT\b|issuance\s*date|date\s*of\s*issuance/i);
    cuts.push([start, stop >= 0 ? start + m[0].length + stop : windowEnd]);
  }
  if (!cuts.length) return { text, stripped: false };
  let out = "";
  let cursor = 0;
  for (const [a, b] of cuts) {
    if (a < cursor) continue;
    out += text.slice(cursor, a);
    cursor = b;
  }
  out += text.slice(cursor);
  return { text: out, stripped: true };
}

function findDates(text: string): string[] {
  const out: string[] = [];
  for (const re of [DATE_LONG, DATE_DAY_FIRST, DATE_NUMERIC]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) out.push(m[0]);
  }
  if (out.length === 0) {
    DATE_MONTH_YEAR.lastIndex = 0;
    for (const m of text.matchAll(DATE_MONTH_YEAR)) out.push(m[0]);
  }
  return out;
}

/** A date sitting within `window` chars AFTER a label match. */
function labeledDate(text: string, label: RegExp, window = 120): string | null {
  const re = new RegExp(label.source, "gi");
  for (const m of text.matchAll(re)) {
    if (m.index == null) continue;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + window);
    const hits = findDates(tail);
    if (hits.length) return hits[0];
  }
  return null;
}

function pickDate(
  text: string,
): { raw: string; strength: "strong" | "weak" | "bare" } | null {
  const strong = labeledDate(text, STRONG_LABEL);
  if (strong) return { raw: strong, strength: "strong" };
  const weak = labeledDate(text, WEAK_LABEL);
  if (weak) return { raw: weak, strength: "weak" };
  const bare = findDates(text);
  // A bare cover date is USUALLY the issuance date — but if the page carries
  // several, we cannot tell which, and a guess here is exactly the failure mode
  // this script exists to prevent.
  const uniq = Array.from(new Set(bare.map((d) => normDate(d)?.iso).filter(Boolean)));
  if (uniq.length === 1 && bare.length) return { raw: bare[0], strength: "bare" };
  return null;
}

// ── identity ───────────────────────────────────────────────────────────────────

function coverEntity(lines: string[]): string | null {
  for (const raw of lines) {
    const line = squash(raw);
    if (line.length < 3 || line.length > 90) continue;
    if (COVER_NOISE.test(line)) continue;
    if (!ENTITY_SUFFIX.test(line)) continue;
    if (/franchise\s+disclosure/i.test(line)) continue;
    return line.replace(/^[^A-Za-z0-9]+/, "").replace(/[,;:]+$/, "");
  }
  return null;
}

/** The Receipt states it in prose: "The franchisor is X, located at ...". */
function receiptEntity(text: string): string | null {
  const m =
    text.match(/franchisor\s+is\s+([^,.\n]{3,90})/i) ??
    text.match(/franchisor,?\s+([A-Z][^,.\n]{3,80}(?:LLC|Inc\.?|Corp\.?|Company))/);
  if (!m) return null;
  const v = squash(m[1]);
  return ENTITY_SUFFIX.test(v) ? v : null;
}

/** Corporate scaffolding that is in the legal entity but never in the trade name. */
const ENTITY_SCAFFOLD =
  /\b(?:franchising|franchise\s+systems?|franchisor|franchises?|systems?|brands?|holdings?|group|international|worldwide|usa|america|spe|opco|ip|licensing|enterprises|ventures)\b/gi;

/**
 * BRAND HINT — and it is only ever a hint.
 *
 * The trade name is typographically obvious on a cover page and typographically
 * INVISIBLE in extracted text: pdf.js gives us characters, not point sizes, so
 * the 48pt logotype and the 8pt address line arrive identical. The first version
 * of this function scanned for a short title-case line and confidently returned
 * an email address and a street address. That is the failure mode to design
 * against, because a wrong brand name is worse than none — it mints a URL.
 *
 * So this derives a candidate from the legal entity by removing corporate
 * scaffolding, then REQUIRES the candidate to appear at least twice more in the
 * cover prose (every FDD cover describes the offering by trade name several
 * times: "a Five Iron Golf center franchise", "additional Five Iron Golf
 * centers"). Corroboration or nothing.
 *
 * "JTE Franchising LLC" yields the candidate "JTE", which does NOT recur in the
 * cover prose — so it returns null and the human decides. That is the correct
 * answer for that file, and it is the same conclusion the registry comment in
 * scripts/jsonl-to-brands.ts reached by hand.
 */
function brandHint(coverText: string, entity: string | null): string | null {
  if (!entity) return null;
  // Strip only the LEGAL FORM (LLC, Inc, Corp…) — never "Company", which is part
  // of the trade name in "Noodles & Company" and cutting it printed "Noodles &".
  const legal = entity
    .replace(/[,.]/g, " ")
    .replace(/\b(?:LLC|L\.L\.C\.|Inc|Incorporated|Corp|Corporation|LP|L\.P\.|LLP|Ltd|Limited|PLLC)\b/gi, " ");
  // Scaffold-stripped FIRST: "Franchising" is by definition not the trade name,
  // so the shorter corroborated form is the better answer when both survive.
  const candidates = [legal.replace(ENTITY_SCAFFOLD, " "), legal]
    .map((c) => squash(c).replace(/[\s&\-–]+$/, "").trim())
    .filter((c) => c.length >= 3);

  for (const candidate of candidates) {
    const esc = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const hits = coverText.match(new RegExp(esc, "gi"));
    if (!hits || hits.length < 3) continue; // 1 of them is the entity line itself
    return candidate
      .split(/\s+/)
      .map((w) => (w === w.toUpperCase() && w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w))
      .join(" ");
  }
  return null;
}

// ── the read ───────────────────────────────────────────────────────────────────

export async function readIdentity(file: string, dump = false): Promise<IdentityRead> {
  const t0 = Date.now();
  const buf = new Uint8Array(fs.readFileSync(file));
  const pdf = await getDocumentProxy(buf);
  const n = pdf.numPages;

  const textOf = async (i: number): Promise<string> => {
    const page = await pdf.getPage(i);
    const tc: any = await page.getTextContent();
    return tc.items
      .map((it: any) => (typeof it.str === "string" ? it.str + (it.hasEOL ? "\n" : " ") : ""))
      .join("");
  };

  const coverIdx = Array.from({ length: Math.min(COVER_PAGES, n) }, (_, i) => i + 1);
  const receiptIdx = Array.from(
    { length: Math.min(RECEIPT_PAGES, n) },
    (_, i) => n - Math.min(RECEIPT_PAGES, n) + 1 + i,
  ).filter((p) => !coverIdx.includes(p));

  const coverRaw = (await Promise.all(coverIdx.map(textOf))).join("\n");
  const receiptRaw = (await Promise.all(receiptIdx.map(textOf))).join("\n");

  if (dump) {
    console.log(`\n===== COVER (${path.basename(file)}) =====\n${coverRaw.slice(0, 3000)}`);
    console.log(`\n===== RECEIPT =====\n${receiptRaw.slice(-3000)}`);
  }

  const { text: coverClean, stripped } = stripStateTable(coverRaw);
  const coverLines = coverClean.split("\n");

  const cover = pickDate(coverClean);
  // The Receipt page repeats the issuance date. It also sits AFTER any state
  // addenda, so we strip there too.
  const receipt = pickDate(stripStateTable(receiptRaw).text);

  const cIso = cover ? normDate(cover.raw)?.iso ?? null : null;
  const rIso = receipt ? normDate(receipt.raw)?.iso ?? null : null;

  const entity = coverEntity(coverLines);
  const rEntity = receiptEntity(receiptRaw);

  let issuance: string | null = null;
  let confidence: IdentityRead["confidence"] = "unresolved";
  let reason = "";

  // A month-only read is COMPATIBLE with a full date in that month, not a
  // conflict — one of the two statements simply printed less precision.
  const compatible =
    cIso != null && rIso != null && (cIso.startsWith(rIso) || rIso.startsWith(cIso));

  if (cIso && rIso && compatible) {
    issuance = cIso.length >= rIso.length ? cIso : rIso; // keep the more precise one
    confidence = cover!.strength === "strong" || receipt!.strength === "strong" ? "high" : "medium";
    reason =
      confidence === "high"
        ? "labeled issuance date; cover and receipt agree"
        : "cover and receipt agree, but neither carries the mandated label";
  } else if (cIso && rIso) {
    const sameYear = cIso.slice(0, 4) === rIso.slice(0, 4);
    if (sameYear && cover!.strength === "strong") {
      issuance = cIso;
      confidence = "medium";
      reason = `cover ${cIso} vs receipt ${rIso} — same year, took the labeled cover date`;
    } else {
      confidence = "unresolved";
      reason = `IDENTITY-UNRESOLVED: cover says ${cIso}, receipt says ${rIso}`;
    }
  } else if (cIso) {
    issuance = cIso;
    confidence = cover!.strength === "strong" ? "medium" : "low";
    reason =
      cover!.strength === "strong"
        ? "labeled issuance date on cover; no receipt date found to cross-check"
        : `cover date found via ${cover!.strength} signal only; no receipt cross-check`;
  } else if (rIso) {
    issuance = rIso;
    confidence = receipt!.strength === "strong" ? "medium" : "low";
    reason = "receipt date only; no date recovered from the cover";
  } else {
    reason = "no date recovered from cover or receipt (likely a scanned/image cover)";
  }

  if (stripped) reason += "; state effective-date table stripped";
  if (entity && rEntity && !sameEntity(entity, rEntity)) {
    reason += `; entity mismatch (cover "${entity}" vs receipt "${rEntity}")`;
    if (confidence === "high") confidence = "medium";
  }

  const year = issuance ? Number(issuance.slice(0, 4)) : null;
  if (year != null && (year < 1990 || year > new Date().getFullYear() + 1)) {
    return {
      file,
      pages: n,
      franchisorEntity: entity,
      brandHint: brandHint(coverClean, entity),
      issuanceDate: null,
      issuanceYear: null,
      confidence: "unresolved",
      reason: `IDENTITY-UNRESOLVED: implausible year ${year}`,
      coverDate: cIso,
      receiptDate: rIso,
      receiptEntity: rEntity,
      ms: Date.now() - t0,
    };
  }

  return {
    file,
    pages: n,
    franchisorEntity: entity,
    brandHint: brandHint(coverClean, entity),
    issuanceDate: issuance,
    issuanceYear: year,
    confidence,
    reason,
    coverDate: cIso,
    receiptDate: rIso,
    receiptEntity: rEntity,
    ms: Date.now() - t0,
  };
}

function sameEntity(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|corp|corporation|company|co|lp|llp|ltd)$/g, "");
  const x = norm(a);
  const y = norm(b);
  return x.includes(y) || y.includes(x);
}

// ── cli ────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const dump = argv.includes("--dump");
  const inputs = argv.filter((a) => !a.startsWith("--"));
  if (!inputs.length) {
    console.error("usage: npx tsx scripts/fddIdentity.ts <file.pdf|dir> [--json] [--dump]");
    process.exit(1);
  }

  const files: string[] = [];
  for (const inp of inputs) {
    const st = fs.statSync(inp);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(inp)) {
        if (/\.pdf$/i.test(f)) files.push(path.join(inp, f));
      }
    } else files.push(inp);
  }

  const rows: IdentityRead[] = [];
  for (const f of files.sort()) {
    try {
      rows.push(await readIdentity(f, dump));
    } catch (err) {
      rows.push({
        file: f,
        pages: 0,
        franchisorEntity: null,
        brandHint: null,
        issuanceDate: null,
        issuanceYear: null,
        confidence: "unresolved",
        reason: `READ FAILED: ${(err as Error).message}`,
        coverDate: null,
        receiptDate: null,
        receiptEntity: null,
        ms: 0,
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const w = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(
    "\n" +
      w("FILE", 34) +
      w("ENTITY (cover)", 38) +
      w("ISSUED", 12) +
      w("YR", 6) +
      w("CONF", 12) +
      "MS",
  );
  console.log("─".repeat(112));
  for (const r of rows) {
    console.log(
      w(path.basename(r.file), 34) +
        w(r.franchisorEntity ?? "—", 38) +
        w(r.issuanceDate ?? "—", 12) +
        w(r.issuanceYear ? String(r.issuanceYear) : "—", 6) +
        w(r.confidence, 12) +
        String(r.ms),
    );
  }
  console.log("─".repeat(112));
  for (const r of rows) {
    console.log(`${path.basename(r.file)}\n    brand hint: ${r.brandHint ?? "—"}\n    ${r.reason}`);
  }
  const byConf = rows.reduce<Record<string, number>>((a, r) => {
    a[r.confidence] = (a[r.confidence] ?? 0) + 1;
    return a;
  }, {});
  const years = rows.filter((r) => r.issuanceYear).reduce<Record<number, number>>((a, r) => {
    a[r.issuanceYear!] = (a[r.issuanceYear!] ?? 0) + 1;
    return a;
  }, {});
  console.log(`\n${rows.length} file(s). confidence: ${JSON.stringify(byConf)}`);
  console.log(`measured years: ${JSON.stringify(years)}`);
  const totalMs = rows.reduce((a, r) => a + r.ms, 0);
  console.log(`total ${totalMs} ms — $0.00 in API cost.`);
}

if (process.argv[1] && process.argv[1].endsWith("fddIdentity.ts")) {
  main();
}
