// Browser-side PDF → text using pdfjs-dist. Used to feed Qwen for extraction.
import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker URL import.
// @ts-expect-error - vite ?url import
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined") {
  // @ts-expect-error - set on global GlobalWorkerOptions
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}

export async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return { text: text.trim(), pages: pdf.numPages };
}
