import { createAPIFileRoute } from "@tanstack/react-start/api";
import { db } from "../../server/db";
import { jobs } from "../../shared/schema";
import { eq } from "drizzle-orm";

export const APIRoute = createAPIFileRoute("/api/status", "GET")(async (request) => {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch job details
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
    });

    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        jobId: job.id,
        status: job.status,
        progress: job.status === "completed" ? 100 : job.status === "processing" ? 50 : 0,
        output: job.output || null,
        error: job.error || null,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Status API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
