# Rank test + corrected fee load — build handoff

Built Jul 31 2026. `tsc --noEmit --strict` clean. `vitest run` 25/25 green.

Every file drops under `fdd-engine-deploy/`. Nothing at repo root — the Vercel
project's root directory is that subfolder and files above it are ignored.

| file | destination | state |
|---|---|---|
| `data/bands.v1.json` | `fdd-engine-deploy/data/` | new — the versioned band table that was owed |
| `lib/feeLoad.ts` | `fdd-engine-deploy/lib/` | done |
| `lib/rankTest.ts` | `fdd-engine-deploy/lib/` | done |
| `lib/rankTest.fixture.ts` | `fdd-engine-deploy/lib/` | done — reference brand transcribed |
| `lib/rankTest.test.ts` | `fdd-engine-deploy/lib/` | done, 25/25 |
| `scripts/rankAudit.ts` | `fdd-engine-deploy/scripts/` | done, runs; readers need binding |

No React, no client components, no changes to `BrandDetail.tsx` or anything glass
mode touches. This lands beside that work, not on top of it.

---

## What it does

```
requiredRevenue(dscr) = (annualDebtService * dscr + fixedFeesAnnual)
                        / (1 - feeLoad - operatingBand)
```

then places that number inside the franchisor's own Item 19 distribution and
states the rank. No forecast anywhere in the module.

## Two decisions encoded in the code — do not "simplify" either

**1. Severity is triggered from the favourable case.** `atBarLow` uses the LOW
end of the fee load and the LOW end of the operating band — the franchisor's
best reading of its own document. A HIGH therefore means *even under the most
generous defensible assumptions, this deal needs more than the best disclosed
unit.* The figures shown to the buyer use midpoints. Merging these would make
the severity indefensible the first time a franchisor's counsel reads it.

**2. Transaction processing never enters the fee load.** It is disclosed as a
percentage of sales, so the obvious implementation sweeps it in — and
double-counts it, because the operating cost band already contains payment
processing. `EXCLUDED_PATTERNS` is tested before `LOAD_PATTERNS` for exactly
this reason. Same for percentage rent, insurance and delivery-aggregator fees.

## The refusal paths are the product, not error handling

`computeRankTest` returns `status: "unavailable"` with a written reason, and
`figures: null`, when:

- Item 19 discloses no figures. **It never substitutes a comparable brand.**
  That would manufacture a financial performance representation for a franchisor
  legally barred from making one.
- The fee table contains a recurring charge the classifier cannot place.
  Publishing a required-revenue figure against an incomplete load understates
  what the location must produce.
- Fees plus the operating band leave no margin. That result is itself a finding
  and is reported as one rather than dividing by zero.

## Free vs paid

- `freeCopy.headline` / `freeCopy.note` — the conclusion. **Contains no digits,
  no currency symbol, no percent sign**, enforced by test group 2. Ships unlocked.
- `honesty[]` — free prose. Also digit-free, also enforced.
- `coverageCopy` — may contain the two disclosed unit counts and their
  difference, and nothing else. Counts are free under the standing rule; the
  test asserts every integer in the string is one of those three.
- `figures` — **paid**. Never pass this to a client component in a locked state.

The strongest unlocked line the module produces:

> *"To cover debt at the level lenders require, this location needs revenue
> above the best unit this franchisor disclosed."*

A conclusion with no figure in it, checkable by the buyer against their own copy
of the FDD. Route it to glass mode as a candidate hero teaser.

## The four test guards

1. **SEAM** — with the load forced back to 10% and the band flat at 71.5%,
   breakeven must reproduce **$1,062,479**, the figure the headroom work already
   reconciled against the live cash ladder to the dollar. Also asserts the
   annuity factor is 0.161922 and that debt service ÷ 12 equals the $15,660
   monthly payment printed on the live report. If this drifts, the rank test and
   the ladder have diverged and one of them is lying to a customer.
2. **LEAK** — no digits or currency in any free string, across both fixtures.
3. **DOUBLE** — processing, card fees and percentage rent classify as
   `operating`; one-time fees never reach the load or the fixed total; an
   unrecognised percentage fee is refused rather than dropped.
4. **REFUSAL** — every unavailable path returns `figures: null` and a reason.

Plus: a test asserting the correction makes the reference brand **strictly
worse, never better**. A fee correction that improved a brand would be a sign
the sign convention had been inverted somewhere.

## Verified results

| | before correction | after |
|---|---|---|
| reference brand fee load | 10.0% | **11.0% – 12.0%** |
| reference brand, required at the 1.25 bar (favourable case) | — | **$1,187,991** |
| vs disclosed median $1,093,068 / average $1,139,160 | — | above both → **MEDIUM** |
| emerging brand, required at the 1.25 bar (favourable case) | — | **$457,397** |
| vs disclosed high $430,000 | — | above it → **HIGH** |
| emerging brand at midpoints | — | **$526,006** |

The reference brand moves from clearing at breakeven to MEDIUM at the lender
bar once the co-op is counted. The test discriminates, which is the point — a
screen that flags everything is worth nothing.

## Running the audit

```
npx tsx scripts/rankAudit.ts          # from fdd-engine-deploy/
npx tsx scripts/rankAudit.ts --json
```

Six sections. Section 2 lists every fee label the classifier could not place —
**each distinct label is an extraction ticket, not a code ticket.** Section 5
counts brands whose severity changes once the co-op class is included; that is
the size of the current defect stated in brands. Section 6 separately lists fund
lines the old `royalty|brand fund` matcher would have missed by NAME rather than
by class — a different defect that must not be added to section 5's number.

## Binding required before the counts mean anything

The readers in `scripts/rankAudit.ts` and `rawFeesFromComputed` in
`lib/feeLoad.ts` are **guesses** at the computed-record shape, same as the
headroom script. They are permissive and they report what they could not find,
so a wrong guess shows up as `no-fee-table` rather than as a silent zero.

A zero load and a missing load are not the same thing and the code never
collapses them. Bind these before quoting any number from the audit.

Fields the record must carry for the rank test to run at full strength:

- Item 6 recurring fees with `ratePctLow` / `ratePctHigh`, `flatAmount` +
  `flatPeriod`, and a `oneTime` flag
- Item 19 `unitsDescribed`, and Item 20 `totalUnits` for coverage
- Item 19 `multiYearSameUnit` — rare, and a quality marker in the buyer's favour
- Item 19 `basis` (gross sales vs something narrower)

## Order of work

1. Bind the readers. Run the audit. **Read section 2 first** — if most brands
   land in `unclassified`, this is an extraction ticket and the rest waits.
2. Read section 5. That number is how many live reports are currently optimistic.
3. Fix `royaltyLoad` in `headroomAudit.ts` to call `computeFeeLoad`, re-run the
   headroom audit, and expect the whole library to get more conservative.
4. Re-run the seam. It reconciles at a 10% load today; it must still reconcile
   at whatever the corrected load is, or the ladder and the screen have parted.
5. Only then render the section.

## Not in scope here

No React component, no placement decision, no severity thresholds tuned to the
library — `SMALL_SET_THRESHOLD` is 12 and is a **guess**, to be replaced from
the real distribution the same way `minFiguresForGlass` is. No comparison of one
brand's disclosed set to another's, ever.
