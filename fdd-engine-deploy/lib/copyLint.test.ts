/**
 * FE-146 · US ENGLISH, ENFORCED — a gate on every string that reaches a report.
 *
 * The instance that prompted this was one word: `recapitalisation`, in the
 * deficit-only paragraph of lib/financialCondition.ts, shipped inside the
 * frozen XPRIZE artifact and therefore inside a buyer-facing diligence report.
 * Trivial on its own. What was not trivial: nothing in the codebase could have
 * caught it, and every string that reaches a report is hand-written prose.
 *
 * Running this scan for the first time found two more the audit had missed —
 * `labelled` in lib/reportSource.ts and lib/reportShell.fixture.ts, both in
 * copy describing the cash ladder to the buyer. Three hits from one word's
 * worth of suspicion is the argument for the gate rather than the fix.
 *
 * WHY THE COMPILER API RATHER THAN GREP: identifiers and comments are not
 * copy. A grep across source would flag a variable named `colour` and a note
 * to a future maintainer, and a lint that cries wolf gets an allowlist bolted
 * on within a month. This walks the AST and inspects string and template
 * literals only — the things that can actually render in front of a buyer.
 *
 * ADDING A WORD: put it in BRITISH_FORMS below. Two known false positives are
 * deliberately absent and must stay absent — `advertis` (advertising is US
 * English) and `dial` (matches the correct `dialed`). Suffix matching on -ise
 * is also deliberately absent: franchise, premise, exercise, merchandise,
 * enterprise and expertise all end in -ise and all are correct.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const BRITISH_FORMS = new RegExp(
  [
    // -ise / -isation verb families, listed explicitly rather than by suffix
    "\\b(?:organis|recognis|realis|specialis|capitalis|recapitalis|amortis|utilis|prioritis|" +
      "standardis|summaris|apologis|maximis|minimis|categoris|normalis|customis|optimis|" +
      "analys|paralys)(?:e|es|ed|ing|ation)\\b",
    // no US English word contains this substring
    "isation\\b",
    "isational\\b",
    // -our
    "\\b(?:colour|favour|behaviour|labour|honour|neighbour|rumour|humour|endeavour|flavour|" +
      "savour|harbour|vapour|odour|armour|valour|parlour|splendour)(?:s|ed|ing|able|ful|less)?\\b",
    // -re
    "\\b(?:centre|metre|litre|theatre|fibre|calibre|sabre|sombre|lustre|spectre)(?:s|d)?\\b",
    // -ce nouns
    "\\b(?:defence|offence|pretence|licence)(?:s|d)?\\b",
    // doubled consonant before a suffix
    "\\b(?:travell|modell|labell|fuell|cancell|marvell|signall|counsell)(?:ed|ing|er|ers)\\b",
    // the long tail
    "\\b(?:enrolment|instalment|fulfilment|skilful|wilful|judgement|programme|cheque|enquiry|" +
      "whilst|amongst|learnt|aluminium|storey|kerb|sceptic|sceptical|manoeuvre|cosy|gaol|" +
      "practise|practised|practising)\\b",
  ].join("|"),
  "i",
);

/** "21 August 2026" is the British order. US copy is "August 21, 2026". */
const BRITISH_DATE =
  /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;

const ROOTS = ["lib", "components", "app"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(f);
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(process.cwd(), r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

/** Every string and template literal in the file, with its line number. */
function literals(file: string): Array<{ line: number; text: string }> {
  const src = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({
        line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
        text: (node as ts.LiteralLikeNode).text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

function sweep(re: RegExp): string[] {
  const hits: string[] = [];
  const root = process.cwd();
  for (const file of sourceFiles()) {
    for (const { line, text } of literals(file)) {
      const m = text.match(re);
      if (m) {
        hits.push(
          `${path.relative(root, file)}:${line} «${m[0]}» — ${text.slice(0, 70).replace(/\s+/g, " ")}`,
        );
      }
    }
  }
  return hits;
}

describe("FE-146 — generated copy is US English", () => {
  it("no British spellings in any string that can reach a report", () => {
    expect(sweep(BRITISH_FORMS)).toEqual([]);
  });

  it("no British date order in copy — August 21, 2026, never 21 August 2026", () => {
    expect(sweep(BRITISH_DATE)).toEqual([]);
  });

  it("the scan actually reads a meaningful number of files", () => {
    // A lint that silently scans nothing passes forever. If a refactor moves
    // the source tree, this fails rather than going quietly green.
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it("the pattern catches what it is supposed to catch", () => {
    // The gate's own regression test. `recapitalisation` is the word that
    // shipped; the rest are the families it generalizes to.
    for (const w of [
      "recapitalisation",
      "organised",
      "colour",
      "centre",
      "defence",
      "labelled",
      "whilst",
      "analyse",
    ]) {
      expect(BRITISH_FORMS.test(w), `${w} should be flagged`).toBe(true);
    }
    // And the false positives that must never be flagged.
    for (const w of [
      "advertising",
      "dialed",
      "franchise",
      "premise",
      "exercise",
      "merchandise",
      "enterprise",
      "expertise",
      "license",
      "labeled",
      "center",
      "color",
    ]) {
      expect(BRITISH_FORMS.test(w), `${w} must NOT be flagged`).toBe(false);
    }
    expect(BRITISH_DATE.test("21 August 2026")).toBe(true);
    expect(BRITISH_DATE.test("August 21, 2026")).toBe(false);
  });
});
