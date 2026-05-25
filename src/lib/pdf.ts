// Browser-side PDF utilities using pdfjs-dist.
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined") {
  (pdfjsLib as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerSrc;
}

/** Extract all text from a PDF file. */
export async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items
      .map((it) => ("str" in it && typeof it.str === "string" ? it.str : ""))
      .join(" ") + "\n";
  }
  return { text: text.trim(), pages: pdf.numPages };
}

/**
 * Render a single PDF page to a JPEG data URL for vision-model extraction.
 * Scales the page so neither dimension exceeds `maxDim` (default 1536px).
 */
export async function pdfPageToImageDataUrl(
  file: File,
  pageNum = 1,
  maxDim  = 1536,
): Promise<string> {
  const buf      = await file.arrayBuffer();
  const pdf      = await pdfjsLib.getDocument({ data: buf }).promise;
  const page     = await pdf.getPage(Math.min(pageNum, pdf.numPages));
  const viewport = page.getViewport({ scale: 1 });
  const scale    = Math.min(maxDim / viewport.width, maxDim / viewport.height, 2.5);
  const scaled   = page.getViewport({ scale });

  const canvas   = document.createElement("canvas");
  canvas.width   = Math.round(scaled.width);
  canvas.height  = Math.round(scaled.height);
  const ctx      = canvas.getContext("2d")!;
  ctx.fillStyle  = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, canvas, viewport: scaled } as any).promise;
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** Read an image file (PNG/JPG/WEBP) as a base64 data URL. */
export function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
