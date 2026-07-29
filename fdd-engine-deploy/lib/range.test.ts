import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { range, band, RANGE_SEP } from "./range";

/**
 * THE RANGE LINT.
 *
 * Ten files each wrote their own `${lo} – ${hi}`. Fixing the cash ladder's copy
 * would have fixed the cash ladder and left the Item 7 table, the compare page
 * and the lead email breaking the same way on the same phone. So the join is a
 * module and the spaced en-dash is a lint.
 *
 * The pattern below is deliberately narrow: it looks for an en-dash with
 * whitespace (or a JSX `{" "}`) on BOTH sides, which is the join, and ignores
 * "28–34%", which is a band and was never the bug. Prose in this codebase uses
 * the em-dash, so nothing legitimate trips it.
 */
const SPACED_ENDASH = /(?:\s|\{" "\})–(?:\s|\{" "\})/;

/** The module that owns the join. Nothing else is exempt. */
const OWNER = "lib/range.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("range", () => {
  it("joins with a separator that cannot break", () => {
    const r = range("$16,018", "$25,629");
    expect(r).toBe(`$16,018${RANGE_SEP}$25,629`);
    // The only spaces in the output are no-break spaces. An ordinary space here
    // is the whole bug: it is a line-break opportunity, and the phone takes it.
    expect(r).not.toMatch(/ /);
    expect(RANGE_SEP).toBe("\u00A0\u2013\u00A0");
  });

  it("collapses an equal pair to one figure", () => {
    // "Initial Franchise Fee $59,500 – $59,500" — five rows of the Item 7 table
    // rendered this shape, each costing a line to say nothing.
    expect(range("$59,500", "$59,500")).toBe("$59,500");
    expect(range("—", "—")).toBe("—");
  });

  it("compares the FORMATTED ends, not the raw numbers", () => {
    // $59,500.00 and $59,500.40 both print as $59,500. On the page they are one
    // figure; a range across them would claim precision the page does not show.
    const usd0 = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
    expect(range(usd0(59_500.0), usd0(59_500.4))).toBe("$59,500");
  });

  it("band prints tight, and collapses when the ends agree", () => {
    expect(band(28, 34)).toBe("28–34%");
    expect(band(26.4, 26.4, 1)).toBe("26.4%");
    expect(band(28, 34)).not.toMatch(/\s/);
  });

  it("SOURCE LINT — nothing else joins a low/high pair by hand", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "components", "app"]) {
      for (const file of walk(dir)) {
        if (/\.test\.tsx?$/.test(file)) continue;
        if (file === OWNER) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (SPACED_ENDASH.test(line)) offenders.push(`${file}:${i + 1} → ${line.trim().slice(0, 90)}`);
          });
      }
    }
    expect(
      offenders,
      `A low/high pair is joined by range() from lib/range.ts — an ordinary space ` +
        `around the dash is where the figure breaks in half on a phone. ` +
        `(Prose wants an em-dash, not an en-dash.)\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
