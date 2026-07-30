// lib/glassGate.test.ts — THE FAIL-CLOSED TEST.
//
// glassGate decides which page type every ad, email and partner link lands on.
// It has five exits and exactly one of them renders glass, so the property
// worth pinning is not "glass works" — the render tests cover that — it is that
// every OTHER path lands on the teaser, which is a working product, rather than
// on a half-built page or a 500.
//
// READY IS EARNED, NEVER INHERITED. The flag defaults off, and a brand the
// adapter cannot read costs us the glass page, not the page.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrandRecord } from "./brands";

/* GLASS_ENABLED is read once at module load, so the flag has to be mocked
   rather than assigned. Mocking the module also keeps this test independent of
   whatever GLASS_ENABLED happens to be set to in the shell that runs it —
   a test whose result depends on the launch flag would flip colour on deploy
   day, which is the one day nobody wants to debug the test suite. */
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("./features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./features")>()),
  get GLASS_ENABLED() {
    return flag.on;
  },
}));

const { glassDecision, parseGlassOverride } = await import("./glassGate");

const BRANDS_DIR = resolve(process.cwd(), "data/brands");

/** A real catalog record that is known to qualify, so "ok" is reachable. */
const fat: BrandRecord = (() => {
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".json"));
  expect(files.length, "no catalog to test against").toBeGreaterThan(50);
  for (const f of files.sort()) {
    const rec = JSON.parse(
      readFileSync(join(BRANDS_DIR, f), "utf8"),
    ) as BrandRecord;
    flag.on = true;
    if (glassDecision(rec).reason === "ok") return rec;
  }
  throw new Error("no brand in the catalog qualifies for glass — check the threshold");
})();

beforeEach(() => {
  flag.on = true;
});

describe("THE FAIL-CLOSED TEST", () => {
  it("serves glass for a qualifying brand with the flag on", () => {
    const d = glassDecision(fat);
    expect(d.reason).toBe("ok");
    expect(d.shell).not.toBeNull();
  });

  it("serves the teaser when the flag is off", () => {
    flag.on = false;
    const d = glassDecision(fat);
    expect(d.reason).toBe("flag-off");
    expect(d.shell).toBeNull();
  });

  it("?v=glass previews before the flag flips, ?v=teaser opts back out", () => {
    flag.on = false;
    expect(glassDecision(fat, "glass").shell).not.toBeNull();
    flag.on = true;
    expect(glassDecision(fat, "teaser").shell).toBeNull();
  });

  it("?v=glass cannot conjure a page out of a record with no report", () => {
    /* The override's job is checking prod on a real phone before launch. It is
       not a way to show a customer an empty promise, so it bypasses the launch
       switch and nothing else. */
    flag.on = false;
    const empty = { slug: "probe", brandName: "Probe", result: {} } as unknown as BrandRecord;
    const d = glassDecision(empty, "glass");
    expect(d.shell).toBeNull();
    expect(["too-thin", "adapter-threw"]).toContain(d.reason);
  });

  it("an adapter throw costs the glass page, not the page", () => {
    // A 500 on /franchise/[slug] is a 500 on the URL every ad points at.
    const junk = { slug: "junk", brandName: "Junk", result: null } as unknown as BrandRecord;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = glassDecision(junk);
    spy.mockRestore();
    expect(d.shell).toBeNull();
    expect(d.reason).toBe("adapter-threw");
  });

  it("parseGlassOverride accepts only the two known variants", () => {
    expect(parseGlassOverride("glass")).toBe("glass");
    expect(parseGlassOverride("teaser")).toBe("teaser");
    for (const junk of [undefined, "", "GLASS", "1", "true", "../etc/passwd"]) {
      expect(parseGlassOverride(junk)).toBeNull();
    }
  });
});
