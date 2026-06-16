# Franchise Edge — FDD Parsing Engine

Turns a Franchise Disclosure Document into a structured, **scored** diligence read,
then underwrites it against the buyer's own balance sheet.

## The architecture that matters

The core design choice — and the difference from a "document reader" — is the
**separation of extraction from judgment**:

```
Upload FDD ──▶ Gemini (Files API)  ──▶  EXTRACT facts only (strict JSON + provenance)
                                          │
                                          ▼
                                    scoring.ts  ──▶ deterministic Low/Med/High + reasons
                                          │
                                          ▼
                                  underwriting.ts ──▶ buyer-fit gap analysis
                                          │
                                          ▼
                                    DiligenceReport (UI)
```

- **Gemini only extracts.** It is explicitly told *not* to score or editorialize, and to
  cite every figure to its Item # and page. (See `lib/gemini.ts` + `lib/schema.ts`.)
- **Your code scores.** `lib/scoring.ts` computes unit economics and a risk level from an
  explicit, tunable rubric (DSCR, rent share, payback, bottom-cohort survival). Same input →
  same output, every time, with defensible reasons.
- **Your code underwrites.** `lib/underwriting.ts` joins the buyer's liquid capital / net
  worth to the FDD's reality (capital gap, SBA-required, viability). The assessment text is
  assembled from the computed numbers, so it can't hallucinate about someone's money.

Why this matters: consistent scores, explainable verdicts, lower legal exposure, and clean
structured data you can later persist into your proprietary index (the moat).

## File map

```
app/
  api/parse-fdd/route.ts   # pipeline: extract → score → underwrite
  page.tsx                 # intake → conditional FDD upload → report
components/
  IntakeForm.tsx           # buyer context (matches the live form)
  FDDUpload.tsx            # conditional upload, inherits intake data
  DiligenceReport.tsx      # extracted facts + score + underwriting + interactive pro forma
lib/
  schema.ts                # extraction types + Gemini JSON schema (provenance)
  gemini.ts                # Files API upload + structured extraction
  scoring.ts               # deterministic risk rubric  ← tune RUBRIC here
  underwriting.ts          # buyer-fit gap analysis
  types.ts                 # shared API result type
```

## Setup

```bash
npm install
cp .env.local.example .env.local   # then add your GEMINI_API_KEY
npm run dev
```

Requires Next.js 16 + React 19 + Tailwind v4 (your existing stack). The components use
brand-matched arbitrary color values (dark slate / emerald / cyan) so they work without a
custom Tailwind theme.

## Deploy (Vercel)

1. Push to GitHub, import to Vercel.
2. Set `GEMINI_API_KEY` in Project → Settings → Environment Variables.
3. The API route already declares `runtime = "nodejs"` and `maxDuration = 60` (FDD parsing
   is slow; the 60s ceiling needs a Pro plan).

## ⚠️ Known constraints to handle before heavy testing

- **I could not run this end-to-end** (no network in the authoring environment). Before you
  rely on it: `npm install @google/genai@latest`, and verify the model string and
  `files.upload` signature against current docs
  (https://ai.google.dev/gemini-api/docs/files and `/models`). The *architecture* is the
  durable part; SDK call shapes can drift.
- **Vercel request-body limit (~4.5MB).** Many text FDDs fit; large or scanned PDFs won't.
  Upgrade path: have the client upload directly to **Vercel Blob** (or S3), then pass the
  blob URL to the API and read it server-side before handing bytes to the Files API. Wire
  this in once you hit the limit on a real doc.
- **Scanned / image-only FDDs.** `documentCheck.appearsScanned` flags these; Gemini's vision
  can still read many, but accuracy drops — surface the warning to the user (the UI does).
- **Truncation.** `documentCheck.appearsComplete` + `itemsFound` catch the "only got the back
  half" problem you already hit. The report shows a banner when core Items are missing.

## Tuning the score

All thresholds live in `RUBRIC` at the top of `lib/scoring.ts`
(`dscrStress`, `rentPctStress`, `paybackYearsStress`, financing assumptions). Adjust as you
calibrate against real deals — that calibration *is* part of the moat.

## Legal hygiene

The engine's output is factual and cited; the score is framed as model output from disclosed
assumptions, not a verdict on the franchisor. Keep it that way, keep the disclaimer in the
report, and stand up basic ToS/privacy before you store any buyer financials.
