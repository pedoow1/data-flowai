import { db } from "../db";
import { jobs } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { processJob } from "../jobs/processor";

export async function startJobWorker() {
  console.log("🚀 Starting job worker...");

  setInterval(async () => {
    try {
      await processPendingJobs();
    } catch (error) {
      console.error("Job worker error:", error);
    }
  }, 5000);
}

async function processPendingJobs() {
  try {
    const pendingJobs = await db.query.jobs.findMany({
      where: eq(jobs.status, "pending"),
      limit: 5,
    });

    if (pendingJobs.length === 0) {
      return;
    }

    console.log(`📋 Found ${pendingJobs.length} pending jobs`);

    const chunks = [];
    for (let i = 0; i < pendingJobs.length; i += 3) {
      chunks.push(pendingJobs.slice(i, i + 3));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map((job) => processJob(job.id)));
    }
  } catch (error) {
    console.error("Error fetching pending jobs:", error);
  }
}

export async function getWorkerStats() {
  const pending = await db.query.jobs.findMany({
    where: eq(jobs.status, "pending"),
  });

  const processing = await db.query.jobs.findMany({
    where: eq(jobs.status, "processing"),
  });

  const completed = await db.query.jobs.findMany({
    where: eq(jobs.status, "completed"),
  });

  const failed = await db.query.jobs.findMany({
    where: eq(jobs.status, "failed"),
  });

  return {
    pending: pending.length,
    processing: processing.length,
    completed: completed.length,
    failed: failed.length,
    total: pending.length + processing.length + completed.length + failed.length,
  };
}
