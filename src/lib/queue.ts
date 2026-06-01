import Queue from "bull";
import { Redis } from "ioredis";

// Initialize Vercel KV Redis connection
const redisConnection = {
  host: process.env.KV_REST_API_URL?.split("https://")[1]?.split(":")[0] || "localhost",
  port: parseInt(process.env.KV_REST_API_PORT || "6379"),
  password: process.env.KV_REST_API_TOKEN,
};

// Create Bull queue for document extraction
export const extractionQueue = new Queue("document-extraction", {
  redis: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// Job type definitions
export interface ExtractionJob {
  userId: string;
  fileName: string;
  text?: string;
  imageDataUrl?: string;
  type: "text" | "image";
}

export interface JobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result?: Array<any> | any;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

// Add job to queue
export async function enqueueExtractionJob(
  userId: string,
  fileName: string,
  data: { text?: string; imageDataUrl?: string },
  type: "text" | "image"
): Promise<string> {
  const job = await extractionQueue.add(
    {
      userId,
      fileName,
      ...data,
      type,
    } as ExtractionJob,
    {
      jobId: `extract-${userId}-${Date.now()}`,
      priority: 1,
    }
  );

  console.log(`[queue] Job enqueued: ${job.id}`);
  return job.id;
}

// Get job status from KV
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  try {
    const job = await extractionQueue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress();

    const status: JobStatus = {
      jobId,
      status: state as any,
      progress: typeof progress === "number" ? progress : 0,
      createdAt: job.data ? Date.now() : 0,
    };

    if (state === "completed") {
      status.result = job.returnvalue;
      status.completedAt = Date.now();
    } else if (state === "failed") {
      status.error = job.failedReason || "Unknown error";
    }

    return status;
  } catch (e) {
    console.error(`[queue] Error getting job status for ${jobId}:`, e);
    return null;
  }
}

// Complete job with result
export async function completeExtractionJob(jobId: string, result: any): Promise<void> {
  try {
    const job = await extractionQueue.getJob(jobId);
    if (job) {
      await job.progress(100);
      job.returnvalue = result;
      await job.moveToCompleted();
      console.log(`[queue] Job completed: ${jobId}`);
    }
  } catch (e) {
    console.error(`[queue] Error completing job ${jobId}:`, e);
  }
}

// Fail job
export async function failExtractionJob(jobId: string, error: Error): Promise<void> {
  try {
    const job = await extractionQueue.getJob(jobId);
    if (job) {
      await job.moveToFailed(error);
      console.log(`[queue] Job failed: ${jobId} - ${error.message}`);
    }
  } catch (e) {
    console.error(`[queue] Error failing job ${jobId}:`, e);
  }
}

// Update job progress
export async function updateJobProgress(jobId: string, progress: number): Promise<void> {
  try {
    const job = await extractionQueue.getJob(jobId);
    if (job) {
      await job.progress(progress);
    }
  } catch (e) {
    console.error(`[queue] Error updating progress for ${jobId}:`, e);
  }
}
