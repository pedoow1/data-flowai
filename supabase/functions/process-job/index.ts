import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const { jobId } = await req.json();
  
  // شغّل المعالجة في الخلفية بدون انتظار
  processJob(jobId).catch(console.error);

  // ارجع فوراً (مش بنخلي Vercel ينتظر)
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function processJob(jobId: string) {
  try {
    // جيب الـ job من DB
    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) throw new Error("Job not found");

    // غيّر status لـ processing
    await supabase.from("jobs").update({
      status: "processing",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    const input = job.input as any;

    // جيب الملف من Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("files")
      .download(input.storagePath);

    if (downloadError) throw new Error(downloadError.message);

    // استخرج البيانات
    const content = await fileData.text();
    const result = await extractData(content, input.mimeType, input.fileName);

    // حدّث الـ job بالنتيجة
    await supabase.from("jobs").update({
      status: "completed",
      output: result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    // حذف الملف بعد المعالجة
    await supabase.storage.from("files").remove([input.storagePath]);

  } catch (error) {
    await supabase.from("jobs").update({
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

async function extractData(content: string, mimeType: string, fileName: string) {
  // نفس منطق الاستخراج الموجود عندك
  // ...ضع هنا كود الاستخراج
  return { invoices: [], totalAmount: 0, invoiceCount: 0 };
}
