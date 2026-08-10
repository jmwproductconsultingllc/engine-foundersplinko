# Franchise Edge

**An FDD diligence engine.** A Franchise Disclosure Document runs two to four hundred pages, and US federal law gives a prospective buyer fourteen days to read it before they can sign. Almost nobody finishes it. This turns that filing into the arithmetic a buyer would do with three weeks and an accountant.

Live: **[engine.foundersplinko.com](https://engine.foundersplinko.com)** · Sample report: **[/sample](https://engine.foundersplinko.com/sample)**

Built for the Build with Gemini XPRIZE, 2026.

---

## The architectural rule

**AI extracts; code decides.**

Gemini reads the PDF and returns structured facts against a strict response schema covering all 23 disclosure Items. Every piece of arithmetic and every judgement — severity, debt-service coverage, payback, churn rate, whether a pro forma may be built at all — is deterministic TypeScript over those facts.

The model does not do arithmetic and does not produce the verdict. A hallucinated digit in a coverage ratio is the exact failure this product exists to catch in someone else's numbers.

Three properties fall out of that split:

- Two buyers uploading the same document get the same verdict, auditable line by line.
- The catalog can be re-scored without re-extracting, so a corrected formula reaches reports that were already sold.
- Every figure carries a provenance label saying which side produced it.

## How Gemini is used

`gemini-3.5-flash`, called server-side at parse time through the **Gemini Files API** — inline base64 truncates on a 300-page document. The response is JSON against a versioned schema (`lib/schema.ts`), persisted as the brand record and used as the sole input to every downstream surface.

The most consequential field is a boolean. `item19.hasItem19` is the model's **explicit** determination of whether the franchisor made a financial performance representation at all — a positive assertion, never inferred from an empty result. When it comes back `false`, the report stops rendering figures and renders a legal finding instead.

The upload handle is deleted from the Files API in a cleanup block that runs whether the extraction succeeded or failed. The filing contains a franchisor's audited financials and, in Item 20, the contact details of every current and former franchisee in the system.

An Anthropic model is wired into the same pipeline in two narrow roles — an automatic failover extractor built against the identical schema and sharing the extraction prompt by import, and the failover half of a targeted recovery pass for filings whose audited statements sit outside the main page window. Neither produces a figure Gemini's schema does not define. `lib/providerInventory.test.ts` scans the repository for anything that can reach a model vendor and fails the build if it is not in the declared manifest.

## Layout

```
fdd-engine-deploy/        Next.js app — the product
  app/                    routes, API handlers
  components/             report surfaces
  lib/                    extraction, schema, financial layer, section specs
  data/brands/            parsed filings, one JSON record each
harness/                  batch evaluation over the corpus
```

Start at `lib/pipeline.ts` for the flow, `lib/gemini.ts` for the extraction call, `lib/ladder.ts` for the thirteen-rung cash ladder, and `lib/sections.ts` for what the report says and when it refuses to say it.

## Correctness

The suite runs on every commit, because a correctness check nobody waits for is a correctness check nobody runs.

Some of what it enforces: provenance labels render in their declared colours (read from the stylesheet); no brand can be described as making no earnings claim unless the model positively said so; the free teaser is structurally incapable of leaking a paid figure, verified including a print-to-PDF text-layer read; and every model call site appears in the vendor manifest.

```bash
cd fdd-engine-deploy
npm install
npm run preflight     # typecheck + full suite
npm run dev
```

Requires a `GEMINI_API_KEY`. See `.env.example` for the full list.

## A note on the sample filings

The demonstration filings in this project — *Verde Bowl Fresh Kitchen* and *Harborlight Pet Retreat* — are **fictional**, authored to exercise the engine without exposing any real franchisor or franchisee. The marker is structural: on the cover, in the footer of every page, in the addresses, the phone numbers and the filename. A marker that can be cropped out is not a marker.

## License

All rights reserved. Shared publicly for evaluation.
