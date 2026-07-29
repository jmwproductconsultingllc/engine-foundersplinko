/**
 * lib/basis.ts
 * ONE PROVENANCE PALETTE. The single place a basis becomes a label, a colour,
 * and a definition.
 *
 * This module exists because the report shipped two of them. components/
 * CashLadder.tsx painted BENCHMARK violet; components/DiligenceReport.tsx
 * painted Benchmark amber, on the same page, ten inches apart. Amber is the
 * warning colour everywhere else in this product, so in Insights a benchmark
 * read as a caution and in the ladder it read as neutral provenance — the same
 * word making two different claims about the same kind of number.
 *
 * That is the three-EBITDA bug wearing different clothes: two hardcoded
 * literals where there should be one module. Correcting the literal fixes
 * today's page and does nothing about the third surface. So the palette is a
 * module and the literals are a lint (see basis.test.ts): a raw provenance hex
 * in components/ fails the build.
 *
 * THE LADDER'S PALETTE IS CANONICAL. It is the newer, deliberate one, it is the
 * surface carrying the most chips, and it already had the one entry Insights
 * lacks (BUYER — a figure the reader typed, which is never relabelled as a
 * disclosure).
 *
 * LABEL LAW applies here. Colour is provenance reinforcement only. Amber and
 * red are spoken for by warnings and must never be spent on a basis.
 */

import type { Basis } from "./ladder";

export interface BasisStyle {
  /** the chip, as rendered in the ladder */
  label: string;
  /** the sentence-case word, as rendered in the Insights legend */
  word: string;
  color: string;
  /** the legend definition — the reader's answer to "what does that mean?" */
  definition: string;
}

export const BASIS_STYLE: Record<Basis, BasisStyle> = {
  disclosed: {
    label: "DISCLOSED",
    word: "Disclosed",
    color: "#34D399",
    definition: "stated in this FDD",
  },
  buyer: {
    label: "YOUR FIGURE",
    word: "Your figure",
    color: "#F5B847",
    definition: "a number you entered, not a disclosure",
  },
  derived: {
    label: "DERIVED",
    word: "Derived",
    color: "#38BDF8",
    definition: "our calculation from disclosed figures",
  },
  benchmark: {
    label: "BENCHMARK",
    word: "Benchmark",
    color: "#A78BFA",
    definition: "our industry range, because the FDD does not disclose it",
  },
  inferred: {
    label: "INFERRED",
    word: "Inferred",
    color: "#8194B0",
    definition: "AI classification",
  },
};

/**
 * The order a legend reads in: what the franchisor said, what you said, what we
 * computed, what we supplied, what we guessed. Weakest claim last, deliberately.
 *
 * BUYER is omitted — it only has meaning on a surface with an input control, and
 * a legend entry for a chip the reader will never see is noise. Surfaces that
 * take buyer figures should pass their own order.
 */
export const LEGEND_ORDER: Basis[] = ["disclosed", "derived", "benchmark", "inferred"];

export const basisColor = (b: Basis): string => BASIS_STYLE[b].color;
