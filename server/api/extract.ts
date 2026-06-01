import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "../../server/db";
import { jobs, uploads } from "../../shared/schema";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import * as path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Ensure uploads directory exists
async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error("Error creating upload directory:", error);
  }
}

export const APIRoute = createAPIFileRoute("/api/extract", "POST")(
  async (request) => {
    try {
      await ensureUploadDir();

      const formData = await request.formData();
      const file = formData.get("file") as File;
      const userId = formData.get("userId") as string;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file provided" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!userId) {
        return new Response(
          JSON.stringify({ error: "No userId provided" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const MAX_FILE_SIZE = parseInt(
        process.env.MAX_FILE_SIZE || "52428800"
      ); // 50MB default
      if (file.size > MAX_FILE_SIZE) {
        return new Response(
          JSON.stringify({
            error: `File size exceeds limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          }),
          {
            status: 413,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Save file temporarily
      const uploadId = uuidv4();
      const fileExt = path.extname(file.name);
      const filePath = path.join(UPLOAD_DIR, `${uploadId}${fileExt}`);

      const buffer = await file.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(buffer));

      // Create upload record
      const uploadRecord = await db
        .insert(uploads)
        .values({
          id: uploadId,
          userId,
          fileName: file.name,
          filePath,
          fileSize: file.size,
          mimeType: file.type,
          status: "pending",
        })
        .returning();

      // Create extraction job
      const job = await db
        .insert(jobs)
        .values({
          userId,
          uploadId: uploadId,
          type: "extraction",
          status: "pending",
          input: {
            uploadId,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          },
        })
        .returning();

      console.log(`📤 File uploaded: ${file.name} (Job ID: ${job[0].id})`);

      return new Response(
        JSON.stringify({
          success: true,
          jobId: job[0].id,
          uploadId: uploadId,
          message: "File uploaded successfully. Processing started.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("Extract API error:", error);
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Upload failed",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
);