import type { ProviderAdapter } from "@aidrive/shared";
import { createStore, createRuntimeEvents } from "./store.js";
import type { InMemoryStore, RuntimeEvents } from "./types.js";
import { GenerationQueue } from "../queue/generation-queue.js";
import { ObjectStorageService } from "../storage/object-storage.js";
import { DiagnosticsEmitter } from "./diagnostics/emit.js";

export interface AppContext {
  store: InMemoryStore;
  runtime: RuntimeEvents;
  providers: ProviderAdapter[];
  generationQueue: GenerationQueue;
  storage: ObjectStorageService;
  diagnostics: DiagnosticsEmitter;
}

export function createContext(providers: ProviderAdapter[], diagnostics: DiagnosticsEmitter): AppContext {
  const store = createStore();
  const runtime = createRuntimeEvents();
  runtime.notifyJobSubscribers = (job, source) => {
    for (const subscriber of runtime.jobSubscribers) {
      try {
        subscriber(job);
      } catch (error) {
        const traceIdRaw = job.request.settings?.__traceId;
        const traceId = typeof traceIdRaw === "string" ? traceIdRaw.slice(0, 120) : null;
        diagnostics.emit({
          severity: "HIGH",
          category: "GENERATION",
          component: "runtime.job_subscribers",
          eventName: "generation.subscriber.error",
          message: "Generation subscriber threw during notification",
          workspaceId: job.workspaceId,
          requestId: job.id,
          traceId,
          context: {
            source,
            jobId: job.id,
            subscriberName: subscriber.name || "anonymous",
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  };
  const generationQueue = new GenerationQueue(store, providers, runtime);

  return {
    store,
    runtime,
    providers,
    generationQueue,
    storage: new ObjectStorageService(),
    diagnostics
  };
}
