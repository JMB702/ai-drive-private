import type { GenerationJob, ProviderAdapter } from "@aidrive/shared";
import type { RuntimeEvents, InMemoryStore } from "../lib/types.js";
import { executeGeneration } from "../lib/services.js";

export class GenerationQueue {
  private running = false;
  private queue: GenerationJob[] = [];

  constructor(
    private readonly store: InMemoryStore,
    private readonly adapters: ProviderAdapter[],
    private readonly runtime: RuntimeEvents
  ) {}

  push(job: GenerationJob): void {
    this.queue.push(job);
    this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) {
        continue;
      }
      await executeGeneration(this.store, this.adapters, job);
      this.runtime.jobSubscribers.forEach((subscriber) => subscriber(job));
    }
    this.running = false;
  }
}
