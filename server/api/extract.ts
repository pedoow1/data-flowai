import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "../../server/db";
import { jobs, uploads } from "../../shared/schema";
import { eq } from "drizzle-orm";

export const APIRoute = createAPIFileRoute("/api/extract", "POST")(async (request) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;

    // Validate inputs
    if (!file || !userId) {
      return new Response(JSON.stringify({ error: "Missing file or userId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50MB limit
      return new Response(JSON.stringify({ error: "File too large" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create upload record
    const upload = await db
      .insert(uploads)
      .values({
        userId,
        fileName: file.name,
        status: "processing",
      })
      .returning();

    // Create job for processing
    const buffer = await file.arrayBuffer();
    const job = await db
      .insert(jobs)
      .values({
        userId,
        uploadId: upload[0].id,
        type: "extract",
        status: "pending",
        input: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          base64Data: Buffer.from(buffer).toString("base64"),
        },
      })
      .returning();

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job[0].id,
        uploadId: upload[0].id,
        message: "File uploaded and job queued",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Extract API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
