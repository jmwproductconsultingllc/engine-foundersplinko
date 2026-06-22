# FDD Eval Harness (v1)

Runs the **real** diligence pipeline over a local corpus of FDDs, N passes each,
and reports which results flip run-to-run. It exercises the live model + the
deterministic code end to end — the "live batch testing" layer that golden tests
can't cover. It is **not** a CI gate: it hits the model and will flake on
non-determinism, so run it locally or on a schedule, never as a blocking check.

## One-time setup
1. `npm i -D tsx` in the repo root, if not already available.
2. Create `harness/corpus/` and drop FDD PDFs in. They stay **gitignored** —
   never commit franchisor source FDDs.
3. Put your **Gemini API key** in your local env — the same variable
   `lib/gemini.ts` reads in production. The harness calls the live model.

## Run
```bash
# from the repo root
npx tsx harness/batch.ts                      # 3 passes over every PDF in corpus/
PASSES=5 CONCURRENCY=4 CAPITAL=300000 npx tsx harness/batch.ts
```

## Output (`harness/runs/`)
- `run-<id>.jsonl` — one line per (file × pass): status, timing, signals, full
  report, plus model + prompt hash so runs are comparable across prompt edits.
  **Gitignored** (embeds extracted figures) — keep local.
- `run-<id>.summary.json` — status counts + flips only. Safe to commit + diff.

## Finalizing the wire-up (the tomorrow piece)
`lib/pipeline.ts` and `batch.ts` carry a few `// VERIFY:` seams — import names and
field paths reconstructed from the build-state doc, not read from source. Confirm
them against the real `route.ts` / `gemini.ts` / `types.ts` (~5 min). The second
half of the refactor — pointing `route.ts` at `runDiligence` so prod and the
harness share one code path — also needs `route.ts` in view. Both are ideal for a
Claude Code session running against the local clone.
