import type { ProviderAdapter } from "@aidrive/shared";
import { createStore, createRuntimeEvents } from "./store.js";
import type { InMemoryStore, RuntimeEvents } from "./types.js";
import { GenerationQueue } from "../queue/generation-queue.js";
import { ObjectStorageService } from "../storage/object-storage.js";

export interface AppContext {
  store: InMemoryStore;
  runtime: RuntimeEvents;
  providers: ProviderAdapter[];
  generationQueue: GenerationQueue;
  storage: ObjectStorageService;
}

export function createContext(providers: ProviderAdapter[]): AppContext {
  const store = createStore();
  const runtime = createRuntimeEvents();
  const generationQueue = new GenerationQueue(store, providers, runtime);

  return {
    store,
    runtime,
    providers,
    generationQueue,
    storage: new ObjectStorageService()
  };
}
