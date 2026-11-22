/**
 * Where rooms are kept between requests.
 *
 * On Vercel one deployment runs as several copies of the function, each with its
 * own memory, and a request can land on any of them. Kept in a plain variable, a
 * screenshot read by one copy is invisible to the copy the dashboard polls. So
 * on Vercel rooms live in the Runtime Cache, which every copy in the region
 * shares. Anywhere else (tests, a laptop) a Map in memory does the same job.
 *
 * The cache is not a database: an entry can be evicted early. That is fine here —
 * the dashboard hands its copy of the match back when the server has none.
 */
import { getCache } from "@vercel/functions";

export interface KeyValue {
  kind: "shared" | "memory";
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
  delete(key: string): Promise<void>;
}

const local = new Map<string, { value: unknown; until: number }>();

const memory: KeyValue = {
  kind: "memory",
  async get(key) {
    const hit = local.get(key);
    if (!hit) return undefined;
    if (hit.until < Date.now()) {
      local.delete(key);
      return undefined;
    }
    return hit.value;
  },
  async set(key, value, ttlSec) {
    // Stored as it would come back from the shared cache: a plain JSON copy.
    local.set(key, { value: JSON.parse(JSON.stringify(value)), until: Date.now() + ttlSec * 1000 });
  },
  async delete(key) {
    local.delete(key);
  },
};

/** True when this request runs where Vercel provides its shared cache. */
function sharedCacheAvailable(): boolean {
  const holder = (globalThis as unknown as Record<symbol, { get?: () => { cache?: unknown } | undefined } | undefined>)[Symbol.for("@vercel/request-context")];
  return !!holder?.get?.()?.cache;
}

/** The store to use for the request being handled right now. */
export function storeForRequest(): KeyValue {
  if (!sharedCacheAvailable()) return memory;
  const cache = getCache({ namespace: "mlbb-guru" });
  return {
    kind: "shared",
    async get(key) {
      return (await cache.get(key)) ?? undefined;
    },
    async set(key, value, ttlSec) {
      await cache.set(key, value, { ttl: ttlSec });
    },
    async delete(key) {
      await cache.delete(key);
    },
  };
}
