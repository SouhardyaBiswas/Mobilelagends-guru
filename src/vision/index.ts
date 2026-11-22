import type { Observation } from "../types";
import { demoVision } from "./demo";
import type { VisionContext } from "./prompt";
import { normalizeObservation } from "./schema";
import { VisionError, type VisionCall, type VisionSettings, type VisionUsage } from "./types";

export * from "./types";
export type { VisionContext } from "./prompt";

export const DEFAULT_VISION: VisionSettings = {
  provider: "demo",
  claudeKey: "",
  claudeModel: "claude-opus-5-5",
  geminiKey: "",
  geminiModel: "gemini-3.8-flash",
};

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"] as const;

/** USD per million tokens [input, output] — for the running cost estimate only. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-2": [8, 40],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function estimateCostUsd(model: string | undefined, usage: VisionUsage | undefined): number | undefined {
  const price = model ? PRICES[model] : undefined;
  if (!price || !usage) return undefined;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
}

let cached: { key: string; call: VisionCall } | undefined;

/** Build (and memoise) the provider. SDKs are loaded on demand to keep the first load small. */
async function provider(s: VisionSettings): Promise<VisionCall> {
  const key = JSON.stringify(s);
  if (cached?.key === key) return cached.call;
  let call: VisionCall;
  if (s.provider === "claude") {
    call = (await import("./claude")).claudeVision(s.claudeKey.trim(), s.claudeModel.trim());
  } else if (s.provider === "gemini") {
    call = (await import("./gemini")).geminiVision(s.geminiKey.trim(), s.geminiModel.trim());
  } else {
    call = demoVision();
  }
  cached = { key, call };
  return call;
}

export interface Analysis {
  observation: Observation;
  usage?: VisionUsage;
  model?: string;
  ms: number;
}

export async function analyzeFrame(settings: VisionSettings, jpegBase64: string, ctx: VisionContext): Promise<Analysis> {
  const started = performance.now();
  const call = await provider(settings);
  const reply = await call(jpegBase64, ctx);
  let observation: Observation;
  try {
    observation = normalizeObservation(reply.raw);
  } catch (err) {
    throw new VisionError(`Could not read the model's answer: ${err instanceof Error ? err.message : err}`, "bad-output");
  }
  return { observation, usage: reply.usage, model: reply.model, ms: Math.round(performance.now() - started) };
}
