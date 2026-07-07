export async function extractFddFromFile(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractedFDD> {
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const uploadResult = await genAI.files.upload({
    file: new Blob([fileBytes], { type: mimeType }),
  });

  try {
    return await withRetry(async () => {
      // FIX: Access generateContent through the 'models' namespace
      const result = await genAI.models.generateContent({
        model: MODEL,
        contents: [
          {
            fileData: {
              fileUri: uploadResult.uri,
              mimeType,
            },
          },
          { text: EXTRACTION_PROMPT + FINANCIAL_CONDITION_EXTRACTION_PROMPT },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: fddResponseSchema,
        },
      });

      const text = result.text();
      return JSON.parse(text || "{}") as ExtractedFDD;
    });
  } finally {
    // Clean up file from Gemini API
    await genAI.files.delete({ name: uploadResult.name }).catch(() => {});
  }
}