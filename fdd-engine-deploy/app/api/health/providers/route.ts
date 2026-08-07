/**
 * GET /api/health/providers
 *
 * Read-only. Answers one question without a deploy log or a shell: which vendor
 * does this running deployment call FIRST? The provider order lived only in a
 * console.warn that fires on failure, so the healthy case was unobservable.
 * No secrets are returned — only whether a key is present, never its value.
 */
import { NextResponse } from "next/server";
import { resolvePrimary, resolveSecondary, DEFAULT_PRIMARY } from "@/lib/providerOrder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    primary: resolvePrimary(),
    secondary: resolveSecondary(),
    shippedDefault: DEFAULT_PRIMARY,
    extractionPrimaryEnvSet: Boolean(process.env.EXTRACTION_PRIMARY),
    geminiKey: Boolean(process.env.GEMINI_API_KEY),
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    maxFddPages: Number(process.env.MAX_FDD_PAGES) || 300,
    claudeMaxPdfPages: Number(process.env.CLAUDE_MAX_PDF_PAGES) || 100,
    geminiRetryPageFraction: Number(process.env.GEMINI_RETRY_PAGE_FRACTION) || 0.6,
    geminiRetryFloorPages: Number(process.env.GEMINI_RETRY_FLOOR_PAGES) || 60,
  });
}
