# FDD Format Spec — Item 19 & Rent

The parser was first tuned to one FDD (Back Nine). Validating against Five Iron,
Golf Envy, and Ultimate Longevity Center (ULC) showed that the **structure inside
each Item is not standardized** — only the Item *numbering* is. This spec records
the structural cases we've seen and how the engine must handle each, so the parser
stops being shaped to a single document.

Guiding principle (unchanged): **AI extracts what's disclosed; code does the
arithmetic and the judgment.** The model should never divide, average, or pick a
"representative" cell — it captures raw figures + their units + their provenance,
and `lib/gemini.ts` normalizes deterministically.

---

## The four Item 19 structures observed

### 1. Performance tiers, monthly  — *Back Nine*
Top 10% / Middle 60% / Bottom 30%, each with a Jan–Dec monthly breakdown.
- Cohorts: `ownership: "franchised"`, `revenueType: "gross_sales"`, `monthlyValues: [...]`.
- Normalization: `avgMonthlyRevenue = mean(monthlyValues)` (also defeats the
  "grabbed December instead of the annual average" misread).

### 2. Company vs. franchised, annual, Avg/Median/Low/High  — *Five Iron*
Headline is **company-owned** ($3.0M avg); **franchised** averages **$1.5M** off
only **2 locations**, plus a full EBITDA waterfall.
- Cohorts: separate rows per ownership AND per statistic, e.g.
  `{label:"Company - Average", ownership:"company", revenueType:"gross_sales", annualRevenue:3020897}`
  and `{label:"Franchised - Average", ownership:"franchised", sampleSize:2, annualRevenue:1533704}`.
- Normalization: `avgMonthlyRevenue = annualRevenue / 12` when no monthlies exist.
- **Danger:** presenting the $3.0M company figure as franchisee earnings overstates
  by ~2x. The judgment layer MUST lead with the franchised cohort.

### 3. Affiliate-owned (combined), monthly, + pre-sale  — *Golf Envy*
Two **affiliate-owned** clubs reported as one monthly statement; the two actual
**franchised** clubs disclose only **pre-sale** revenue (memberships sold before
opening — not operations); rent disclosed as **$/sqft** in Item 19.
- Cohorts: `{ownership:"affiliate", revenueType:"gross_sales", monthlyValues:[...]}` and
  `{ownership:"franchised", revenueType:"pre_sale_only", ...}`.
- **Danger:** reading pre-sale revenue as ongoing revenue; treating affiliate
  performance as franchisee performance.

### 4. No financial performance representation  — *ULC*
Item 19 carries the boilerplate "we do not make any representations…" and stops.
Common among emerging/trend-led brands (longevity, wellness).
- Extraction: `hasItem19=false`, `cohorts=[]`, reason in `notes`. **Never fabricate
  a revenue number.**
- Judgment layer (pending): pivot to a **required-revenue / break-even** read from
  Item 7 + fees ("you'd need ~$Y/mo just to cover debt + costs"), and route the
  buyer to Item 20 franchisee contacts to validate independently. Absence is a
  *finding*, not an error.

---

## Rent — never a single number

Rent shows up in at least three forms, sometimes more than one per FDD:
- `$/sqft/year` (Five Iron $20–50; Golf Envy $26.11) — needs square footage to convert.
- `$/month` or `$/year` outright.
- An Item 7 line like **"Lease Deposit and Rent – 3 Months"** ($20–30K) — this is a
  deposit-plus-a-few-months **cash outlay, NOT monthly rent.** Must never be read as
  a monthly figure.

`rentDetail = { rawValue, unit, squareFootage, source }` captures it raw; code
normalizes to `averageRentMonthly` (e.g. $26.11 × 2,700 ÷ 12 = **$5,875/mo**).

---

## What this turn changed (extraction layer)
- `Item19Cohort`: added `ownership`, `sampleSize`, `revenueType`, `annualRevenue`.
- `RentDisclosure` + `rentDetail`: structured rent with code-side normalization.
- Prompt: capture ownership/sampleSize/revenueType, annual vs monthly, the no-FPR
  case, and structured rent (with the "3-month line ≠ rent" warning).
- `gemini.ts`: normalize cohort revenue (monthlies → mean; else annual ÷ 12) and
  rent (any unit → monthly).

## What's still pending (judgment layer — next pass)
1. **Lead with the franchised cohort** in scoring + report; label company/affiliate
   figures as such; surface `sampleSize` as a confidence flag ("n=2 — thin").
2. **No-FPR path:** required-revenue / break-even reframe + Item 20 routing.
3. **Report rendering:** show ownership, sample size, revenue type, and rent basis
   so the buyer sees the engine's work.
4. Extend the golden-test suite with a fixture per structure (Five Iron, Golf Envy,
   ULC) once the judgment layer lands.
