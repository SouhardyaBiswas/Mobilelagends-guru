import { ApiError, GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { extractJson, VISION_SCHEMA } from "./schema";
import { VisionError, type VisionCall, type VisionReply } from "./types";

function toVisionError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return new VisionError("Gemini rejected the API key. Check that the whole key was pasted, with no spaces.", "auth");
    if (err.status === 401 || err.status === 403) return new VisionError("Gemini rejected the API key. Check that the whole key was pasted, with no spaces.", "auth");
    if (err.status === 404) return new VisionError("Gemini model not found for this key.", "config");
    if (err.status === 429) return new VisionError("Gemini rate limit or quota hit — slowing down.", "rate");
    return new VisionError(`Gemini API error ${err.status}: ${err.message.slice(0, 160)}`, "api");
  }
  if (err instanceof TypeError) return new VisionError("Could not reach Gemini. Check your connection.", "network");
  return new VisionError(err instanceof Error ? err.message : String(err), "api");
}

/** Tried in order when the chosen model does not exist for this key. */
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];

export function geminiVision(apiKey: string, model: string): VisionCall {
  if (!apiKey) throw new VisionError("Add your Gemini API key in Settings.", "config");
  // The key stays in this browser; requests go straight to Google.
  const ai = new GoogleGenAI({ apiKey });
  const candidates = [...new Set([model, ...FALLBACK_MODELS].filter(Boolean))];
  // Once a model answers, keep using it.
  let working = 0;

  const ask = async (name: string, image: Parameters<VisionCall>[0], ctx: Parameters<VisionCall>[1]): Promise<VisionReply> => {
    const response = await ai.models.generateContent({
      model: name,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: image.mediaType, data: image.base64 } }, { text: userPrompt(ctx) }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: VISION_SCHEMA,
      },
    });
    const text = response.text;
    if (!text) throw new VisionError("Gemini returned no text (the request may have been blocked).", "bad-output");
    const usage = response.usageMetadata;
    return {
      raw: extractJson(text),
      model: response.modelVersion ?? name,
      usage: usage
        ? {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          }
        : undefined,
    };
  };

  return async (image, ctx): Promise<VisionReply> => {
    let lastError: VisionError | undefined;
    for (let i = working; i < candidates.length; i++) {
      try {
        const reply = await ask(candidates[i]!, image, ctx);
        working = i;
        return reply;
      } catch (err) {
        lastError = toVisionError(err);
        // Only "that model does not exist" is worth retrying with another name.
        if (lastError.kind !== "config") throw lastError;
      }
    }
    throw lastError ?? new VisionError("No Gemini model answered.", "api");
  };
}
