import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "../../server/db";
import { jobs, uploads } from "../../shared/schema";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service key مش anon key
);

export const APIRoute = createAPIFileRoute("/api/extract", "POST")(
  async (request) => {
    try {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      const userId = formData.get("userId") as string;

      if (!file || !userId) {
        return new Response(
          JSON.stringify({ error: "File and userId required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "52428800");
      if (file.size > MAX_FILE_SIZE) {
        return new Response(
          JSON.stringify({ error: "File too large" }),
          { status: 413, headers: { "Content-Type": "application/json" } }
        );
      }

      // ✅ رفع الملف لـ Supabase Storage بدل filesystem
      const uploadId = uuidv4();
      const fileExt = file.name.split(".").pop();
      const storagePath = `uploads/${userId}/${uploadId}.${fileExt}`;

      const buffer = await file.arrayBuffer();
      const { error: storageError } = await supabase.storage
        .from("files") // اسم الـ bucket
        .upload(storagePath, buffer, {
          contentType: file.type,
        });

      if (storageError) throw new Error(storageError.message);

      // ✅ تسجيل الـ upload في DB
      await db.insert(uploads).values({
        id: uploadId,
        userId,
        fileName: file.name,
        filePath: storagePath, // مسار Supabase Storage
        fileSize: file.size,
        mimeType: file.type,
        status: "pending",
      });

      // ✅ إنشاء الـ job في DB
      const job = await db.insert(jobs).values({
        userId,
        uploadId,
        type: "extraction",
        status: "pending",
        input: {
          uploadId,
          storagePath, // المسار في Supabase Storage
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        },
      }).returning();

      // ✅ Trigger الـ Edge Function في الخلفية (fire & forget)
      fetch(`${process.env.SUPABASE_URL}/functions/v1/process-job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ jobId: job[0].id }),
      }).catch(console.error); // fire & forget - مش بننتظر الرد

      return new Response(
        JSON.stringify({
          success: true,
          jobId: job[0].id,
          uploadId,
          message: "File uploaded. Processing in background.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Extract API error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Upload failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
);
