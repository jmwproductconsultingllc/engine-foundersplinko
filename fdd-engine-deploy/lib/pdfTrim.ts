// fdd-engine-deploy/lib/pdfTrim.ts
//
// Trim a PDF to its first `maxPages` pages so very large filings stay within a
// model's context window. Mirrors the proven trim in lib/gemini.ts (pdf-lib,
// ignoreEncryption, copy the leading pages, fall back to the original on any
// error) — extracted here so the Claude path can share it.
//
// Why first-N-pages is the right cut: an FDD's 23 numbered disclosure Items and
// the franchisor's financial statements live in the FRONT of the document. The
// back is bulk exhibits — the franchise agreement, 50-state addenda, operations
// manual — which carry no extraction signal (and the SCOPE rule already tells
// the model to ignore them). Dropping the tail keeps everything that matters and
// keeps a UPS Store-class FDD (~600 pages / ~1.5M tokens) under the 1M ceiling.

import { PDFDocument } from "pdf-lib";

export interface TrimResult {
  /** PDF bytes — trimmed if the doc exceeded the budget, original otherwise. */
  data: Uint8Array;
  /** Whether a trim actually happened. */
  trimmed: boolean;
  /** Original page count, or -1 if the PDF couldn't be parsed. */
  originalPages: number;
}

export async function trimPdfToPages(
  bytes: ArrayBuffer,
  maxPages: number,
): Promise<TrimResult> {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();

    if (pageCount <= maxPages) {
      return { data: new Uint8Array(bytes), trimmed: false, originalPages: pageCount };
    }

    const out = await PDFDocument.create();
    const indices = Array.from({ length: maxPages }, (_, i) => i);
    const copied = await out.copyPages(src, indices);
    copied.forEach((page) => out.addPage(page));
    const data = await out.save();

    return { data, trimmed: true, originalPages: pageCount };
  } catch {
    // If the trim fails for any reason, send the original bytes unchanged.
    return { data: new Uint8Array(bytes), trimmed: false, originalPages: -1 };
  }
}
