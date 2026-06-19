const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

type Cell = "yes" | "no" | "partial";

interface Row {
  label: string;
  sub?: string;
  typical: Cell;
  moat?: boolean;
}

// Top three are table stakes (signal we're legit). The bolded block is the
// moat — the operator/economic read the legal-first tools don't do.
const ROWS: Row[] = [
  { label: "Reads all 23 items, in plain English", typical: "yes" },
  { label: "Red flags and a risk score", typical: "yes" },
  { label: "Every figure cited to its Item and page", typical: "yes" },
  {
    label: "Scored against your capital",
    sub: "Your gap and your loan need — not a generic document score",
    typical: "no",
    moat: true,
  },
  {
    label: "Real unit economics",
    sub: "True operating margin, not just what the FDD chose to disclose",
    typical: "no",
    moat: true,
  },
  {
    label: "Item 19, apples-to-apples",
    sub: "Isolates franchised units from company- and affiliate-owned",
    typical: "no",
    moat: true,
  },
  {
    label: "Franchisor financial health",
    sub: "Going-concern, deficit, runway — severity-graded",
    typical: "partial",
    moat: true,
  },
  {
    label: "Disclosed vs. estimated",
    sub: "Every number tagged, so you know fact from model",
    typical: "no",
    moat: true,
  },
];

function Mark({ kind, edge = false }: { kind: Cell; edge?: boolean }) {
  if (kind === "yes") {
    return (
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold ${
          edge ? "bg-[#34D399] text-[#0B1220]" : "bg-[#34D399]/15 text-[#34D399]"
        }`}
        aria-label="included"
      >
        ✓
      </span>
    );
  }
  if (kind === "partial") {
    return <span className="text-xs font-medium text-[#F5B847]/80">partial</span>;
  }
  return <span className="text-[#3A496A]" aria-label="not included">—</span>;
}

export default function FeatureMatrix() {
  return (
    <section id="what-you-get" className="mt-14">
      <p className="text-xs font-bold tracking-[0.2em] uppercase text-[#38BDF8] mb-2">
        What you get
      </p>
      <h2
        className="text-2xl md:text-3xl font-bold text-[#F1F5F9]"
        style={{ fontFamily: DISPLAY }}
      >
        Not just what&apos;s in the document — whether the deal works for you.
      </h2>
      <p className="mt-2 mb-6 text-[#8194B0] max-w-2xl">
        Most FDD tools answer the lawyer&apos;s question: what&apos;s buried in the legal language.
        This one answers the operator&apos;s: can you afford it, and will the unit make money.
      </p>

      <div className="overflow-hidden rounded-2xl border border-[#27344F] bg-[#111B30]">
        {/* header */}
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] items-end gap-2 border-b border-[#27344F] px-4 py-3 md:px-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#5A6B88]">
            Capability
          </span>
          <span className="text-center text-[11px] font-semibold leading-tight text-[#8194B0]">
            Typical tools
          </span>
          <span className="rounded-t-lg bg-[#34D399]/10 py-1.5 text-center text-[11px] font-bold leading-tight text-[#34D399]">
            Franchise Edge
          </span>
        </div>

        {/* rows */}
        {ROWS.map((r, i) => (
          <div
            key={r.label}
            className={`grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] items-center gap-2 px-4 py-3 md:px-5 ${
              i !== ROWS.length - 1 ? "border-b border-[#1B2942]" : ""
            } ${r.moat ? "border-l-2 border-l-[#F5B847]/50 bg-[#F5B847]/[0.03]" : ""}`}
          >
            <div className="min-w-0">
              <p
                className={`text-sm ${
                  r.moat ? "font-semibold text-[#F1F5F9]" : "text-[#CBD5E1]"
                }`}
              >
                {r.label}
              </p>
              {r.sub && <p className="mt-0.5 text-xs text-[#8194B0]">{r.sub}</p>}
            </div>
            <div className="flex justify-center">
              <Mark kind={r.typical} />
            </div>
            <div className="flex justify-center bg-[#34D399]/[0.06] py-3 -my-3 h-[calc(100%+1.5rem)] items-center">
              <Mark kind="yes" edge />
            </div>
          </div>
        ))}
      </div>

      {/* credibility — the thing no competitor can copy */}
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#F5B847]/25 bg-[#F5B847]/[0.04] px-5 py-4">
        <span className="mt-0.5 text-lg" aria-hidden>
          ◆
        </span>
        <p className="text-sm text-[#CBD5E1]">
          <span className="font-semibold text-[#F1F5F9]">Built by someone who&apos;s done both sides</span>{" "}
          — a franchise operator who runs a unit, and a private-equity diligence pro who&apos;s
          underwritten the deals. The read you get is the one they&apos;d run on their own money.
        </p>
      </div>
    </section>
  );
}
