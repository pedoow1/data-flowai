import { startJobWorker } from "../server/workers/job-processor";

if (process.env.NODE_ENV !== "development" || process.env.RUN_WORKER === "true") {
  startJobWorker().catch(console.error);
}

export { createStartHandler } from "@tanstack/react-start/start";
