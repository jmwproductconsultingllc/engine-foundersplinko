// lib/riskReframeDrift.test.ts — THE drift audit (Risk Reframe acceptance).
// Sibling to the brand-facts audit: fails the build if the four surfaces could
// render a different "N things to verify" for the same brand, or if the shared
// component reintroduces red / a banned noun. This is the structural guarantee
// behind the single-source requirement — one component, one derivation.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { toCard } from "./brands";
import { toTeaserCard } from "./teaserProps";
import { resolveBrandFacts } from "./brandFacts";
import { computeVerify, verifyPhrase, VERIFY_LABELS } from "./verify";
import type { BrandRecord } from "./brands";

/**
 * Blank line and block comments, preserving every offset so reported line
 * numbers stay true. Strings are SKIPPED rather than blanked: the phrase this
 * lint measures lives in string literals, so blanking them would erase the
 * thing under test. That branch exists only to stop a "//" inside a literal —
 * "https://…" — from being read as the start of a comment.
 *
 * Same character walk as lib/glassSeam.test.ts and components/captureCopy.test.ts.
 * Three copies is one too many; if a fourth lint needs it, hoist it.
 */
function stripComments(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) out[k] = src[k] === "\n" ? "\n" : " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== "`" && src[j] === "\n") break; // unterminated; bail at EOL
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
  return out;
}

describe("Risk Reframe drift audit — all surfaces agree", () => {
  it("library card, detail teaser, resolver, and paid-report path render the SAME count + items", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      const facts = resolveBrandFacts(b); // surfaces #1/#2/#3 read these fields
      const card = toCard(b); // library grid (Surface #1)
      const teaser = toTeaserCard(b); // detail card (Surface #2)
      // Paid report (Surface #4) + free snapshot (Surface #3) compute directly
      // from scoring.riskReasons via the SAME helper — this is the divergence risk.
      const reportPath = computeVerify((b as any)?.result?.scoring?.riskReasons);

      const counts = [facts.verifyCount, card.verifyCount, teaser.verifyCount, reportPath.verifyCount];
      expect(new Set(counts).size, `${facts.slug}: verifyCount drift ${JSON.stringify(counts)}`).toBe(1);

      const items = [facts.verifyItems, card.verifyItems, teaser.verifyItems, reportPath.verifyItems];
      const serialized = items.map((x) => JSON.stringify(x));
      expect(new Set(serialized).size, `${facts.slug}: verifyItems drift ${JSON.stringify(items)}`).toBe(1);

      for (const label of facts.verifyItems) expect(VERIFY_LABELS).toContain(label as (typeof VERIFY_LABELS)[number]);
    }
  });

  it("verifyPhrase obeys the label law — names the noun, singular at 1, plural above", () => {
    expect(verifyPhrase(1)).toBe("1 thing to verify");
    expect(verifyPhrase(2)).toBe("2 things to verify");
    expect(verifyPhrase(6)).toBe("6 things to verify");
    expect(verifyPhrase(0)).toBe("1 thing to verify"); // floored — never "0 things"
    // never a naked number: the noun is always present
    for (const n of [1, 2, 3, 5]) expect(verifyPhrase(n)).toMatch(/thing/);
  });

  it("no source file re-types the phrase instead of calling verifyPhrase()", async () => {
    /* THE CALL-SITE GAP.
     *
     * Every assertion above this one tests verifyPhrase() itself, and every one
     * of them was green on the day lib/reportSource.ts shipped
     *
     *     out.push({ label: `${v.verifyCount} things to verify`, ... })
     *
     * — a hardcoded plural that rendered "1 things to verify" in the badge
     * strip of the glass page, and was caught by a human looking at a
     * screenshot. A single source of truth that nothing is required to call is
     * not a single source of truth; it is a suggestion with good docs.
     *
     * So the unit of enforcement moves from the function to the call sites: no
     * file may build this phrase out of a template literal. lib/verify.ts is
     * exempt because it is where the phrase is allowed to be spelled out;
     * .test and .fixture files are exempt because asserting on — or standing
     * in for — the literal output is their whole job (this file does it four
     * lines up, and lib/reportShell.fixture.ts hardcodes a badge strip).
     *
     * THE COMMENT-BLIND LINT, learned twice already in this repo and once more
     * here: the first run of this scan reported five offenders and all five
     * were prose. One of them was the comment three lines above the FIX, which
     * quotes the bug in order to explain it. A lint that reads documentation as
     * a violation punishes the file that took the trouble to explain itself,
     * and the change a hurried reader makes is deleting the explanation. So
     * comments are blanked before the scan, and the strip has its own
     * bidirectional control below — over-strip is the silent failure.
     */
    const roots = ["lib", "app", "components", "scripts"];
    const files: string[] = [];
    const walk = async (dir: string) => {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
        const p = path.join(dir, e);
        const st = await fs.stat(p);
        if (st.isDirectory()) await walk(p);
        else if (/\.tsx?$/.test(e) && !/\.(test|fixture)\.tsx?$/.test(e)) files.push(p);
      }
    };
    for (const r of roots) await walk(path.join(process.cwd(), r));

    // The lint's own failure mode is scanning nothing and reporting green.
    expect(files.length, "the call-site scan found no source files").toBeGreaterThan(100);

    // Both directions, because over-strip is the silent failure: blank a shade
    // too much and every file scans clean and this lint is green forever.
    const control = [
      'const bad = `${n} things to verify`;',
      '// we used to write "3 things to verify" by hand',
      '/* the bug was `${v.verifyCount} things to verify` */',
    ].join("\n");
    const stripped = stripComments(control);
    expect(stripped).toContain("${n} things to verify"); // over-strip guard
    expect((stripped.match(/things to verify/g) ?? []).length).toBe(1); // under-strip guard

    // "N thing(s) to verify" assembled from anything other than verifyPhrase:
    // an interpolation, a concatenation, or a bare hardcoded count.
    const HANDBUILT =
      /(?:\$\{[^}]*\}|["'`]\s*\+\s*[\w.$()[\]]+\s*\+\s*["'`]|\b\d+)\s*things?\s+to\s+verify/g;
    const EXEMPT = new Set([path.join("lib", "verify.ts")]);

    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(process.cwd(), f);
      if (EXEMPT.has(rel)) continue;
      const src = stripComments(await fs.readFile(f, "utf8"));
      for (const m of src.matchAll(HANDBUILT)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${rel}:${line} — ${m[0].trim()}`);
      }
    }

    expect(
      offenders,
      "A surface is building the verify phrase by hand instead of calling " +
        "verifyPhrase(count) from lib/verify.ts. That is how \"1 things to " +
        "verify\" reached a page we were about to buy traffic for. Import the " +
        "helper.\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("the call-site scan is real — it fires on the line that shipped", () => {
    // A mutation test, inline. Without it, a typo in HANDBUILT leaves the scan
    // above green forever and nobody finds out until the next screenshot.
    const HANDBUILT =
      /(?:\$\{[^}]*\}|["'`]\s*\+\s*[\w.$()[\]]+\s*\+\s*["'`]|\b\d+)\s*things?\s+to\s+verify/;
    const relapse =
      'out.push({ label: `${v.verifyCount} things to verify`, severity: "medium" });';
    expect(
      HANDBUILT.test(relapse),
      "the pattern no longer matches the bug it was written for",
    ).toBe(true);
    // ...and it must NOT fire on the correct call, or the fix is unshippable.
    expect(HANDBUILT.test("out.push({ label: verifyPhrase(v.verifyCount) });")).toBe(false);
  });
});

describe("shared component holds the visual law", () => {
  it("DiligenceToVerify uses NO red Tailwind classes or red hexes (red is reserved for earned findings)", async () => {
    const src = await fs.readFile(
      path.join(process.cwd(), "components", "DiligenceToVerify.tsx"),
      "utf8",
    );
    // Tailwind red utilities (text-red-*, bg-red-*, border-red-*) + common red hexes.
    expect(src).not.toMatch(/\b(?:text|bg|border)-red-\d/);
    expect(src.toLowerCase()).not.toMatch(/#ef4444|#f87171|#dc2626|#fca5a5/);
  });
});
