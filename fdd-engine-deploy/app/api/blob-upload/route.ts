/**
 * app/api/blob-upload/route.ts
 *
 * Issues a short-lived client token so the browser uploads the FDD straight to
 * Vercel Blob, bypassing the ~4.5MB serverless request-body limit that was
 * choking large filings (e.g. the 5MB Dunkin FDD). The PDF never transits this
 * function — only the tiny token-handshake JSON does. The parse route fetches
 * the blob and deletes it afterward.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        addRandomSuffix: true,
      }),
      // Vercel calls this after the client upload completes. The parse route
      // does the real work (fetch → extract → delete), so nothing is needed here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upload authorization failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
