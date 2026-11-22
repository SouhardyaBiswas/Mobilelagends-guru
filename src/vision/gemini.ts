import { ApiError, GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { extractJson, VISION_SCHEMA } from "./schema";
import { VisionError, type VisionCall, type VisionReply } from "./types";

function toVisionError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return new VisionError("Gemini rejected the API key. Check it in Settings.", "auth");
    if (err.status === 401 || err.status === 403) return new VisionError("Gemini rejected the API key. Check it in Settings.", "auth");
    if (err.status === 404) return new VisionError("Gemini model not found. Check the model name in Settings.", "config");
    if (err.status === 429) return new VisionError("Gemini rate limit or quota hit — slowing down.", "rate");
    return new VisionError(`Gemini API error ${err.status}: ${err.message.slice(0, 160)}`, "api");
  }
  if (err instanceof TypeError) return new VisionError("Could not reach Gemini. Check your connection.", "network");
  return new VisionError(err instanceof Error ? err.message : String(err), "api");
}

export function geminiVision(apiKey: string, model: string): VisionCall {
  if (!apiKey) throw new VisionError("Add your Gemini API key in Settings.", "config");
  // The key stays in this browser; requests go straight to Google.
  const ai = new GoogleGenAI({ apiKey });

  return async (image, ctx): Promise<VisionReply> => {
    try {
      const response = await ai.models.generateContent({
        model,
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
        model: response.modelVersion ?? model,
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount ?? 0,
              outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            }
          : undefined,
      };
    } catch (err) {
      throw toVisionError(err);
    }
  };
}
