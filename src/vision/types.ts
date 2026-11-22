import type { VisionContext } from "./prompt";

export type ProviderId = "demo" | "claude" | "gemini";

export interface VisionSettings {
  provider: ProviderId;
  claudeKey: string;
  claudeModel: string;
  geminiKey: string;
  geminiModel: string;
}

export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface VisionReply {
  /** Parsed JSON as returned by the model (untrusted until normalised). */
  raw: unknown;
  usage?: VisionUsage;
  /** Model that actually answered (may differ after a fallback). */
  model?: string;
}

export interface VisionImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export type VisionCall = (image: VisionImage, ctx: VisionContext) => Promise<VisionReply>;

/** One question to a model that must answer as JSON matching `schema`. Used by the reader, the coach and the positioning helper. */
export interface AskInput {
  /** Stable instructions (cached by the provider where possible). */
  system: string;
  /** What changes on each call. */
  user: string;
  images?: VisionImage[];
  schema: Record<string, unknown>;
}

export type AskJson = (input: AskInput) => Promise<VisionReply>;

/** Error with a message that is safe and useful to show the player. */
export class VisionError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate" | "network" | "refused" | "bad-output" | "config" | "api",
  ) {
    super(message);
    this.name = "VisionError";
  }
}
