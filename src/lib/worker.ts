import { extractionQueue, updateJobProgress, completeExtractionJob, failExtractionJob, ExtractionJob } from "./queue";
import { extractFromText, extractFromImage } from "./extract.functions";
import { chunkText } from "./extract.functions";

const CHUNK_SIZE = 8000;
const PARALLEL_LIMIT = 2;
const BATCH_DELAY_MS = 300;

// ── Chunking helper ────────────────────────────────────────────────────────
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

// ── GitHub Models API helper ─────────────────────────────────────────────────
async function callGitHubModels(
  token: string,
  model: string,
  messages: any[],
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  
  try {
    const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.0,
        max_tokens: 8000,
      }),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── Parse response (handles both single and array) ─────────────────────────
function parseResponse(status: number, bodyText: string): { ok: true; rows: any[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  try {
    const json = JSON.parse(bodyText);
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    if (!content) return { ok: false, error: "Empty response" };

    const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed = JSON.parse(cleaned);

    let rows = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: "Parse error" };
  }
}

// ── Retry wrapper ──────────────────────────────────────────────────────────
async function runWithRetry(token: string, model: string, messages: any[]): Promise<{ ok: true; rows: any[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGitHubModels(token, model, messages);

      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse" };
      }

      if (status === 429) {
        lastError = "Rate limited";
        await new Promise((r) => setTimeout(r, 10_000 * attempt));
        continue;
      }
      if (status === 503 || status === 502) {
        lastError = "Service unavailable";
        await new Promise((r) => setTimeout(r, 5_000 * attempt));
        continue;
      }
      return { ok: false, error: `GitHub error ${status}` };
    } catch (e: any) {
      lastError = e?.message || "Network error";
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  return { ok: false, error: lastError };
}

// ── Process single chunk ──────────────────────────────────────────────────
async function processChunk(
  token: string,
  model: string,
  chunk: string,
  fileName: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<{ ok: true; rows: any[] } | { ok: false; error: string }> {
  const MINIMAL_PROMPT = `You are an invoice data extraction engine. Extract these 6 fields:
- invoiceNumber, client, date, amount, tax, total
For each: {v: "exact value", c: confidence 0-100}
If missing: {v: "—", c: 0}
IMPORTANT: If MULTIPLE invoices, return JSON ARRAY. Else single object.
Return ONLY valid JSON.`;

  const chunkPrompt = `${MINIMAL_PROMPT}\n\nDocument: ${fileName}\nPart ${chunkIndex + 1}/${totalChunks}\n\n---\n${chunk}\n\nDo not truncate any text, numbers, or company names.`;

  return runWithRetry(token, model, [{ role: "user", content: chunkPrompt }]);
}

// ── Process extraction job ───────────────────────────────────────────────
async function processExtractionJob(job: any): Promise<any> {
  const data = job.data as ExtractionJob;
  const token = (process.env.GITHUB_TOKEN || "").trim();
  const model = "gpt-4o-mini";

  if (!token) throw new Error("Missing GITHUB_TOKEN");

  console.log(`[worker] Processing job ${job.id} for user ${data.userId}`);

  let chunks: string[] = [];
  let totalChunks = 0;

  if (data.type === "text") {
    if (!data.text) throw new Error("No text provided");
    chunks = chunkText(data.text, CHUNK_SIZE);
    totalChunks = chunks.length;
  } else if (data.type === "image") {
    if (!data.imageDataUrl) throw new Error("No image provided");
    chunks = [data.imageDataUrl]; // Single "chunk" for image
    totalChunks = 1;
  }

  const allResults: any[] = [];
  const totalBatches = Math.ceil(chunks.length / PARALLEL_LIMIT);

  // Process chunks in parallel batches
  for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_LIMIT) {
    const batchEnd = Math.min(batchStart + PARALLEL_LIMIT, chunks.length);
    const batchNumber = Math.floor(batchStart / PARALLEL_LIMIT) + 1;

    console.log(`[worker] Job ${job.id}: Processing batch ${batchNumber}/${totalBatches}`);

    // Update progress
    const progress = Math.round((batchStart / chunks.length) * 100);
    await updateJobProgress(job.id, progress);

    const batchChunks = chunks.slice(batchStart, batchEnd);

    // Process batch in parallel
    const batchPromises = batchChunks.map((chunk, batchIndex) => {
      if (data.type === "image") {
        // For image, send as-is
        const messages = [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: chunk } },
              { type: "text", text: `Extract invoice data from this image. Return JSON.` },
            ],
          },
        ];
        return runWithRetry(token, "gpt-4o", messages);
      } else {
        // For text, process as chunk
        return processChunk(token, model, chunk, data.fileName, batchStart + batchIndex, totalChunks);
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      if (result.ok) {
        allResults.push(...result.rows);
      } else {
        console.error(`[worker] Job ${job.id}: Chunk failed - ${result.error}`);
      }
    }

    // Delay between batches
    if (batchEnd < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  if (allResults.length === 0) {
    throw new Error("Failed to extract data from document");
  }

  console.log(`[worker] Job ${job.id}: Completed - extracted ${allResults.length} invoice(s)`);

  // Mark as 100% complete
  await updateJobProgress(job.id, 100);

  // Return single row or array based on count
  return allResults.length === 1 ? allResults[0] : allResults;
}

// ── Register job processor ───────────────────────────────────────────────
export async function setupWorker() {
  console.log("[worker] Setting up extraction job processor...");

  extractionQueue.process(async (job) => {
    try {
      const result = await processExtractionJob(job);
      await completeExtractionJob(job.id, result);
      return result;
    } catch (error: any) {
      console.error(`[worker] Job ${job.id} failed:`, error);
      await failExtractionJob(job.id, error);
      throw error;
    }
  });

  extractionQueue.on("completed", (job) => {
    console.log(`[worker] Job completed: ${job.id}`);
  });

  extractionQueue.on("failed", (job, err) => {
    console.error(`[worker] Job failed: ${job.id} - ${err.message}`);
  });

  console.log("[worker] Worker setup complete");
}

// ── Export for use in API routes ─────────────────────────────────────────
export { processExtractionJob };
