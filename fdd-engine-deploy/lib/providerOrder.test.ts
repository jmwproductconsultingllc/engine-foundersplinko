// fdd-engine-deploy/lib/providerOrder.test.ts
//
// The product claim "Gemini primary, Claude failover" is asserted here, in CI,
// rather than in a paragraph of a document. A sentence in a doc cannot fail a
// build; this can.
//
// A CLAIM THAT NO TEST CAN FAIL IS MARKETING, NOT ARCHITECTURE.

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_PRIMARY,
  resolvePrimary,
  resolveSecondary,
  providerOrder,
} from "./providerOrder";

// Every case passes an explicit env object rather than mutating process.env, so
// the suite cannot leak state into a sibling test and cannot accidentally pass
// because the machine running it happens to have EXTRACTION_PRIMARY set.
const env = (v?: string) => (v === undefined ? {} : { EXTRACTION_PRIMARY: v }) as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider order — the shipped default", () => {
  it("is Gemini when EXTRACTION_PRIMARY is unset", () => {
    expect(resolvePrimary(env())).toBe("gemini");
  });

  it("is Gemini when EXTRACTION_PRIMARY is empty string (an unset Vercel var reads as '')", () => {
    expect(resolvePrimary(env(""))).toBe("gemini");
  });

  it("names Claude as the failover, not the primary", () => {
    expect(resolveSecondary(env())).toBe("claude");
  });

  it("orders [gemini, claude] by default", () => {
    expect(providerOrder(env())).toEqual(["gemini", "claude"]);
  });

  // This is the line that encodes the product decision. If someone flips it,
  // they have changed what the company says about itself, and they should have
  // to delete this assertion on purpose.
  it("declares gemini as DEFAULT_PRIMARY", () => {
    expect(DEFAULT_PRIMARY).toBe("gemini");
  });
});

describe("provider order — the operational override", () => {
  it("honours an explicit claude override (vendor-outage lever)", () => {
    expect(resolvePrimary(env("claude"))).toBe("claude");
    expect(resolveSecondary(env("claude"))).toBe("gemini");
    expect(providerOrder(env("claude"))).toEqual(["claude", "gemini"]);
  });

  it("honours an explicit gemini value", () => {
    expect(resolvePrimary(env("gemini"))).toBe("gemini");
  });

  // The old ternary treated "Claude", "CLAUDE", "anthropic" and "clade" as
  // identical to unset — silently Gemini, no signal. That is exactly how a
  // deploy comes to disagree with its own documentation.
  it.each(["Claude", "CLAUDE", "anthropic", "clade", "gemini ", "openai"])(
    "falls back to the default AND warns on unrecognised value %o",
    (bad) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolvePrimary(env(bad))).toBe(DEFAULT_PRIMARY);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("EXTRACTION_PRIMARY");
    },
  );

  it("does not warn on the happy paths", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolvePrimary(env());
    resolvePrimary(env("gemini"));
    resolvePrimary(env("claude"));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("provider order — totality", () => {
  it("primary and secondary are always different and always cover both vendors", () => {
    for (const v of [undefined, "", "gemini", "claude", "garbage"]) {
      const order = providerOrder(env(v));
      expect(order).toHaveLength(2);
      expect(new Set(order).size).toBe(2);
      expect([...order].sort()).toEqual(["claude", "gemini"]);
    }
  });
});
