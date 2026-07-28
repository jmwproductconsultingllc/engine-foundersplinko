// lib/reasonCopy.test.ts — the THRESHOLD LINT.
//
// Standing copy rule: NAME THE OUTPUT, NEVER THE CUTOFF.
//
// riskReasons are the only free-text strings the engine generates that a buyer
// reads verbatim — they render on the paid report and they are baked into every
// stored report JSON, so a bad one is not a page edit, it is corpus-wide and
// retroactive. Two failure modes, both mechanical, both linted here:
//
//  1. PUBLISHING THE RUBRIC. `(below ${RUBRIC.dscrStress})` tells the reader our
//     internal cutoff. That is not a disclosure about the franchise, it is a
//     disclosure about us — it invites "why 1.25?", it dates instantly the day
//     the rubric is retuned, and every historical stored report then contradicts
//     the current one. Say what the number IS; never say what bar it missed.
//
//  2. UNSOURCED MARKET CLAIMS. "Above-market royalty at 8.25%" asserts a fact
//     about the franchise market that we cannot cite. The FDD discloses the
//     royalty; it does not disclose the market. State the disclosed figure and
//     let it carry the weight.
//
// The lint runs against BOTH the generator source (so a new reasons.push can't
// reintroduce either class) and the shipped corpus (so anything already baked
// into data/brands is caught, not just future writes).

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const SCORING = path.join(process.cwd(), "lib", "scoring.ts");
const BRANDS_DIR = path.join(process.cwd(), "data", "brands");

/** Words that assert a market-wide comparison we have no source for. */
const UNSOURCED_MARKET_CLAIMS = [
  "above-market",
  "below-market",
  "above market",
  "below market",
  "industry standard",
  "industry average",
  "market rate",
  "typical for the industry",
];

/** Pull the argument text of every reasons.push(...) in the generator source. */
function reasonPushArgs(src: string): string[] {
  const out: string[] = [];
  const needle = "reasons.push(";
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    const start = j + 1;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, j));
    i = src.indexOf(needle, j);
  }
  return out;
}

/** Every riskReasons array anywhere in a brand file, at any nesting depth. */
function collectReasons(node: unknown, sink: string[]): void {
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "riskReasons" && Array.isArray(v)) sink.push(...v.map(String));
    else collectReasons(v, sink);
  }
}

async function corpusReasons(): Promise<Array<{ file: string; text: string }>> {
  const files = (await fs.readdir(BRANDS_DIR)).filter((f) => f.endsWith(".json"));
  const out: Array<{ file: string; text: string }> = [];
  for (const f of files) {
    const sink: string[] = [];
    collectReasons(JSON.parse(await fs.readFile(path.join(BRANDS_DIR, f), "utf8")), sink);
    for (const text of sink) out.push({ file: f, text });
  }
  return out;
}

describe("reason copy — name the output, never the cutoff", () => {
  it("no generated reason string interpolates a RUBRIC threshold", async () => {
    const args = reasonPushArgs(await fs.readFile(SCORING, "utf8"));
    expect(args.length).toBeGreaterThan(5); // the parser actually found them
    const offenders = args.filter((a) => /RUBRIC\./.test(a)).map((a) => a.trim().slice(0, 140));
    expect(offenders, `reasons.push interpolating RUBRIC:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no generated reason string makes an unsourced market claim", async () => {
    const args = reasonPushArgs(await fs.readFile(SCORING, "utf8"));
    const offenders = args
      .filter((a) => UNSOURCED_MARKET_CLAIMS.some((w) => a.toLowerCase().includes(w)))
      .map((a) => a.trim().slice(0, 140));
    expect(offenders, `unsourced market claim in reasons.push:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no reason already baked into the corpus makes an unsourced market claim", async () => {
    const offenders = (await corpusReasons())
      .filter((r) => UNSOURCED_MARKET_CLAIMS.some((w) => r.text.toLowerCase().includes(w)))
      .map((r) => `${r.file}: ${r.text}`);
    expect(offenders, `stored reasons with an unsourced market claim:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no reason already baked into the corpus publishes a cutoff", async () => {
    // The shape a cutoff takes in prose: a parenthetical comparison.
    // "(below 1.25)", "(above 25%)", "(under 2.5x)".
    const CUTOFF = /\((?:below|above|under|over|at least|no more than)\s+[$]?[0-9]/i;
    const offenders = (await corpusReasons())
      .filter((r) => CUTOFF.test(r.text))
      .map((r) => `${r.file}: ${r.text}`);
    expect(offenders, `stored reasons publishing a cutoff:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no reason renders an implausible computed value", async () => {
    // A ratio built on a near-zero denominator produces copy like "Long payback:
    // ~801.1 years", which is not a finding — it is a division artifact, printed
    // with a decimal point for false precision. The generator now degrades these
    // to an honest statement, so any survivor means new bad input data.
    const offenders: string[] = [];
    for (const r of await corpusReasons()) {
      let m: RegExpMatchArray | null;
      if ((m = r.text.match(/payback: ~([0-9.]+) years/i)) && parseFloat(m[1]) > 40)
        offenders.push(`${r.file}: ${r.text}`);
      if ((m = r.text.match(/~([0-9]+)% of mid-cohort revenue/)) && parseInt(m[1], 10) > 100)
        offenders.push(`${r.file}: ${r.text}`);
    }
    expect(offenders, `implausible computed values:\n${offenders.join("\n")}`).toEqual([]);
  });
});
