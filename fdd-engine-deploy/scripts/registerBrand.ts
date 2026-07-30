// scripts/registerBrand.ts
// ONE TAXONOMY CHOICE, NOT TEN MINUTES OF HAND-EDITING.
//
//   npx tsx scripts/registerBrand.ts <file.pdf> \
//     --vertical "Home & Property Services" \
//     --category "Gutter installation" \
//     [--slug my-brand] [--stem corpus-filename] [--write] [--json]
//
// WHAT THIS DOES AND WHAT IT DELIBERATELY DOES NOT DO
// ---------------------------------------------------
// Adding a brand to the catalog means adding one line to REGISTRY in
// scripts/jsonl-to-brands.ts: stem → { slug, category, vertical, sourceFddYear }.
// Four fields. Three of them are MEASURABLE — the stem is the corpus filename,
// the slug follows from the brand name printed on the FDD cover, and the FDD
// year is printed on the cover and restated on the Receipt. Only category and
// vertical are judgment.
//
// So this script measures the three and asks you for the two. It reads the PDF
// with scripts/fddIdentity.ts (no model call, no API cost), derives the stem and
// slug, validates the taxonomy against lib/brands.ts, checks for collisions
// against BOTH the live REGISTRY and data/brands/, and prints a paste-ready
// line.
//
// It stops there by default, and --write only edits the source file on your
// machine. THE REGISTRY GATE IS THE POINT. A slug is a permanent public URL; a
// wrong one either 404s later or ranks for the wrong brand forever. The human
// review of that diff is the gate, and a script that committed for you would be
// the bot-writes-the-repo design we deliberately did not build.
//
// SOURCE FDD YEAR IS MEASURED OR IT IS NULL.
// -----------------------------------------
// The reader returns a confidence, and a low/unresolved read means the cover and
// the Receipt did not corroborate each other. In that case this emits
// sourceFddYear: null and says so loudly, because a figure that cannot be
// verified gets WORDS, not a default. It never falls back to the current year.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIdentity, type IdentityRead } from "./fddIdentity";
import { REGISTRY } from "./jsonl-to-brands";
import { CATEGORY_ORDER, KIDS_VERTICAL, VERTICAL_ORDER } from "../lib/brands";

const CONVERTER = path.join(process.cwd(), "scripts", "jsonl-to-brands.ts");
const BRANDS_DIR = path.join(process.cwd(), "data", "brands");

// The slug shape every existing catalog URL already has.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * ONE RULE REPRODUCES EVERY EXISTING SLUG. Any run of non-alphanumerics becomes
 * a single hyphen — which is why "Sharkey's Cuts For Kids" is
 * sharkey-s-cuts-for-kids (the apostrophe SPLITS, it is not deleted) and
 * "Pigtails & Crewcuts" is pigtails-crewcuts (" & " is one run). Do not
 * "improve" this into stripping apostrophes: that would mint sharkeys-cuts-for-
 * kids and orphan a live URL.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Object-literal key: bare when it's a valid identifier, quoted otherwise. */
function keyLiteral(stem: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(stem) ? stem : JSON.stringify(stem);
}

function entryLine(
  stem: string,
  slug: string,
  category: string,
  vertical: string,
  sourceFddYear: number | null,
): string {
  return (
    `  ${keyLiteral(stem)}: { slug: ${JSON.stringify(slug)}, ` +
    `category: ${JSON.stringify(category)}, ` +
    `vertical: ${JSON.stringify(vertical)}, ` +
    `sourceFddYear: ${sourceFddYear ?? "null"} },`
  );
}

// ── args ───────────────────────────────────────────────────────────────────────

interface Args {
  file: string | null;
  vertical: string | null;
  category: string | null;
  slug: string | null;
  stem: string | null;
  write: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    file: null,
    vertical: null,
    category: null,
    slug: null,
    stem: null,
    write: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--write") a.write = true;
    else if (t === "--json") a.json = true;
    else if (t === "--vertical") a.vertical = argv[++i] ?? null;
    else if (t === "--category") a.category = argv[++i] ?? null;
    else if (t === "--slug") a.slug = argv[++i] ?? null;
    else if (t === "--stem") a.stem = argv[++i] ?? null;
    else if (t.startsWith("--")) die(`unknown flag ${t}`);
    else if (!a.file) a.file = t;
    else die(`unexpected argument "${t}" (one PDF at a time)`);
  }
  return a;
}

function die(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function usage(): never {
  console.error(
    [
      "",
      "  usage: npx tsx scripts/registerBrand.ts <file.pdf> --vertical <V> --category <C>",
      "                                          [--slug <s>] [--stem <s>] [--write] [--json]",
      "",
      "  --vertical  one of (lib/brands.ts VERTICAL_ORDER):",
      ...VERTICAL_ORDER.map((v) => `                ${v}`),
      "",
      `  --category  free-form for every vertical EXCEPT "${KIDS_VERTICAL}", which must use:`,
      ...CATEGORY_ORDER.map((c) => `                ${c}`),
      "",
      "  --slug      override the slug derived from the FDD cover brand name",
      "  --stem      override the corpus filename stem (defaults to the file's own name)",
      "  --write     insert the entry into scripts/jsonl-to-brands.ts (review the diff, then commit)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// ── the checks ─────────────────────────────────────────────────────────────────

interface Resolved {
  stem: string;
  slug: string;
  category: string;
  vertical: string;
  sourceFddYear: number | null;
  identity: IdentityRead;
  warnings: string[];
}

function resolve(a: Args, id: IdentityRead): Resolved {
  const warnings: string[] = [];

  // ── stem ────────────────────────────────────────────────────────────────────
  // The stem is how the CONVERTER finds this entry: it lowercases the batch
  // row's filename and looks it up. So the stem must equal the corpus filename,
  // not the slug — get this wrong and the brand is silently SKIPPED at
  // conversion time with no error on this side.
  const stem = (a.stem ?? path.basename(a.file!).replace(/\.pdf$/i, "")).toLowerCase();
  if (!stem) die("empty stem");
  if (stem === "document") {
    warnings.push(
      'STEM IS "document" — registry downloads all land with that filename, and it can ' +
        "only ever map to ONE brand. Rename the corpus file (and pass --stem) before running the batch.",
    );
  }

  // ── slug ────────────────────────────────────────────────────────────────────
  let slug: string;
  if (a.slug) {
    slug = a.slug.toLowerCase();
  } else if (id.brandHint) {
    slug = slugify(id.brandHint);
    warnings.push(
      `slug derived from the cover brand name "${id.brandHint}" — confirm it against Item 1 ` +
        "before this mints a public URL.",
    );
  } else {
    die(
      "no brand name recovered from the cover, so there is nothing to derive a slug from.\n" +
        `    franchisor entity on cover: ${id.franchisorEntity ?? "(none found)"}\n` +
        `    receipt entity:             ${id.receiptEntity ?? "(none found)"}\n` +
        `    reader says:                ${id.reason}\n` +
        "    Pass the public brand name from Item 1 explicitly: --slug <brand-name>",
    );
  }
  if (!SLUG_RE.test(slug)) {
    die(
      `slug "${slug}" is not a legal URL slug (lowercase alphanumerics joined by single hyphens).`,
    );
  }

  // ── taxonomy ────────────────────────────────────────────────────────────────
  // Hard-validated against lib/brands.ts because an unrecognized vertical does
  // not error anywhere — the brand simply never appears in a row on /brands.
  // Silent invisibility is the failure mode this catches.
  if (!a.vertical) die("--vertical is required (see --help list above)");
  const vertical = VERTICAL_ORDER.find((v) => v.toLowerCase() === a.vertical!.toLowerCase());
  if (!vertical) {
    die(
      `vertical "${a.vertical}" is not in VERTICAL_ORDER, so the brand would never render ` +
        `on /brands.\n    Valid: ${VERTICAL_ORDER.join(" | ")}`,
    );
  }

  if (!a.category) die("--category is required");
  let category = a.category;
  if (vertical === KIDS_VERTICAL) {
    const hit = CATEGORY_ORDER.find((c) => c.toLowerCase() === category.toLowerCase());
    if (!hit) {
      die(
        `"${KIDS_VERTICAL}" uses a CLOSED subcategory list and "${category}" is not on it, ` +
          `so the tile would not render.\n    Valid: ${CATEGORY_ORDER.join(" | ")}`,
      );
    }
    category = hit; // canonical casing
  }

  // ── the measured year ───────────────────────────────────────────────────────
  // MEASURED OR NULL. high/medium means the cover and the Receipt corroborated
  // each other (or a labeled issuance date carried it alone). low/unresolved
  // means they did not, and we write null rather than print a year we never read.
  let sourceFddYear: number | null = null;
  if ((id.confidence === "high" || id.confidence === "medium") && id.issuanceYear != null) {
    sourceFddYear = id.issuanceYear;
  } else {
    warnings.push(
      `sourceFddYear: null — the reader could not corroborate an issuance date ` +
        `(confidence ${id.confidence}: ${id.reason}). The catalog will say the FDD year is ` +
        "unknown, which is true. Do NOT hand-type a year you have not read on the cover.",
    );
  }

  return { stem, slug, category, vertical, sourceFddYear, identity: id, warnings };
}

/** Collisions against BOTH the registry and the files on disk. */
function collisions(r: Resolved): string[] {
  const errs: string[] = [];

  const existing = REGISTRY[r.stem];
  if (existing) {
    errs.push(
      `stem "${r.stem}" is ALREADY in REGISTRY → ${existing.slug} ` +
        `(${existing.vertical ?? KIDS_VERTICAL} / ${existing.category}). ` +
        (existing.slug === r.slug
          ? "Nothing to add; re-run the converter instead."
          : "Two brands cannot share a corpus filename — rename the PDF and pass --stem."),
    );
  }

  for (const [stem, e] of Object.entries(REGISTRY)) {
    if (e.slug === r.slug && stem !== r.stem) {
      errs.push(`slug "${r.slug}" is already claimed by stem "${stem}".`);
    }
  }

  // A file on disk with no registry entry is a real state: records laid down by
  // earlier tooling. Overwriting one silently re-points a live URL.
  const onDisk = path.join(BRANDS_DIR, `${r.slug}.json`);
  if (fs.existsSync(onDisk) && !REGISTRY[r.stem]) {
    errs.push(
      `data/brands/${r.slug}.json already exists but no registry stem points at it. ` +
        "Registering this stem would overwrite a live record on the next batch run.",
    );
  }

  return errs;
}

// ── the write ──────────────────────────────────────────────────────────────────

/**
 * Anchored insert before REGISTRY's closing brace. Anchored, not appended: the
 * file has other object literals, and a regex that grabbed "the last };" would
 * put the entry outside the registry — valid TypeScript that compiles, passes
 * tsc, and silently registers nothing.
 */
function insertEntry(line: string): string {
  const before = fs.readFileSync(CONVERTER, "utf8");
  const lines = before.split("\n");
  const start = lines.findIndex((l) => l.includes("export const REGISTRY"));
  if (start < 0) die(`could not find "export const REGISTRY" in ${CONVERTER}`);
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === "};");
  if (end < 0) die("could not find REGISTRY's closing brace");
  lines.splice(end, 0, line);
  fs.writeFileSync(CONVERTER, lines.join("\n"));
  return before; // the caller restores this if the read-back disagrees
}

/**
 * VERIFY IN A FRESH PROCESS, NEVER BY TRUSTING THE WRITE.
 *
 * A textual insert that lands in the wrong scope, or inside a comment, leaves a
 * file that still compiles and a registry that still skips the brand — the
 * failure is silent and shows up a batch run later. So we read it back.
 *
 * It has to be a CHILD PROCESS. The obvious move — await import() with a
 * ?v= cache-buster — does not work here: tsx transpiles these scripts to CJS,
 * where a dynamic import degrades to a require() that caches by resolved
 * filename and ignores the query string. The first version of this function did
 * exactly that and reported "the registry does not see it" on a write that was
 * in fact perfect. A verifier that always fails is worse than none, because you
 * learn to ignore it.
 *
 * A child process also verifies more than the text: that the edited file still
 * parses, still type-resolves, and still imports WITHOUT SIDE EFFECTS. If the
 * converter's direct-execution guard ever regresses, this spawn exits non-zero
 * with the converter's own usage message instead of quietly succeeding.
 */
function verifyWrite(r: Resolved, restore: string): void {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "registerBrand-"));
  const probe = path.join(probeDir, "probe.ts");
  // The import specifier is an absolute literal, so the child resolves the file
  // we just edited and nothing else.
  fs.writeFileSync(
    probe,
    `import { REGISTRY } from ${JSON.stringify(CONVERTER.replace(/\.ts$/, ""))};\n` +
      `console.log(JSON.stringify(REGISTRY[${JSON.stringify(r.stem)}] ?? null));\n`,
  );

  const revert = (why: string): never => {
    fs.writeFileSync(CONVERTER, restore);
    fs.rmSync(probeDir, { recursive: true, force: true });
    return die(`${why}\n    scripts/jsonl-to-brands.ts has been RESTORED to its previous contents.`);
  };

  let out: string;
  try {
    out = execFileSync("npx", ["tsx", probe], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    return revert(
      `the edited converter could not be imported in a fresh process:\n    ${String(e?.stderr || e?.message).trim().slice(0, 400)}`,
    );
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  const got = JSON.parse(out || "null");
  if (!got) return revert(`wrote the line but a fresh import does not see stem "${r.stem}".`);
  const mismatch =
    got.slug !== r.slug ||
    got.category !== r.category ||
    got.vertical !== r.vertical ||
    (got.sourceFddYear ?? null) !== r.sourceFddYear;
  if (mismatch) {
    return revert(`a fresh import returned a DIFFERENT entry for "${r.stem}": ${JSON.stringify(got)}.`);
  }
}

// ── cli ────────────────────────────────────────────────────────────────────────

const fmt = (v: unknown) => (v == null ? "—" : String(v));

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.file) usage();
  if (!fs.existsSync(a.file)) die(`no such file: ${a.file}`);

  const id = await readIdentity(a.file);
  const r = resolve(a, id);
  const errs = collisions(r);
  const line = entryLine(r.stem, r.slug, r.category, r.vertical, r.sourceFddYear);

  if (a.json) {
    console.log(JSON.stringify({ ...r, identity: undefined, read: id, errors: errs, line }, null, 2));
    if (errs.length) process.exit(1);
    return;
  }

  console.log(`
  READ  ${path.basename(a.file)}  (${id.pages} pages, ${id.ms}ms, no API cost)
    franchisor entity   ${fmt(id.franchisorEntity)}
    brand on cover      ${fmt(id.brandHint)}
    issuance date       ${fmt(id.issuanceDate)}   [cover ${fmt(id.coverDate)} · receipt ${fmt(id.receiptDate)}]
    confidence          ${id.confidence} — ${id.reason}

  RESOLVES TO
    stem                ${r.stem}
    slug                ${r.slug}          → /brands/${r.slug}
    vertical            ${r.vertical}
    category            ${r.category}
    sourceFddYear       ${fmt(r.sourceFddYear)}`);

  for (const w of r.warnings) console.log(`\n  ! ${w}`);

  if (errs.length) {
    console.error("\n  ✗ NOT REGISTERED:");
    for (const e of errs) console.error(`      ${e}`);
    console.error("");
    process.exit(1);
  }

  if (a.write) {
    const restore = insertEntry(line);
    verifyWrite(r, restore);
    console.log(`
  ✓ inserted into scripts/jsonl-to-brands.ts and confirmed by re-import:

${line}

  Review the diff and commit it yourself — the registry gate is the human gate.`);
  } else {
    console.log(`
  PASTE INTO REGISTRY in scripts/jsonl-to-brands.ts (or re-run with --write):

${line}
`);
  }
}

if (process.argv[1] && /registerBrand\.[cm]?[jt]sx?$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
