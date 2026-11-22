import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { extractJson, VISION_SCHEMA } from "./schema";
import { VisionError, type VisionCall, type VisionReply } from "./types";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toVisionError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new VisionError("Claude rejected the API key. Check that the whole key was pasted, with no spaces.", "auth");
  }
  if (err instanceof Anthropic.RateLimitError) return new VisionError("Claude rate limit hit — slowing down.", "rate");
  if (err instanceof Anthropic.NotFoundError) return new VisionError("Claude model not found. Check the model name in Settings.", "config");
  if (err instanceof Anthropic.APIConnectionError) return new VisionError("Could not reach Claude. Check your connection.", "network");
  if (err instanceof Anthropic.APIError) return new VisionError(`Claude API error ${err.status ?? ""}: ${err.message}`, "api");
  return new VisionError(err instanceof Error ? err.message : String(err), "api");
}

export function claudeVision(apiKey: string, model: string): VisionCall {
  if (!apiKey) throw new VisionError("Add your Claude API key in Settings.", "config");
  // The key lives in this browser only; requests go straight to Anthropic.
  // dangerouslyAllowBrowser acknowledges that — fine for a personal tool, not for a shared deployment.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45_000 });

  return async (image, ctx): Promise<VisionReply> => {
    const common = {
      model,
      max_tokens: 16000,
      // Stable prefix (hero + item lists) is cached; only the image and roster vary.
      system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      // Low effort: this is transcription of a screenshot, and the coach is waiting.
      output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: VISION_SCHEMA } },
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 } },
            { type: "text" as const, text: userPrompt(ctx) },
          ],
        },
      ],
    };

    try {
      // Where supported, let the API re-run a declined request on a fallback model in the same call.
      const response = FALLBACK_MODELS.has(model)
        ? await client.beta.messages.create({ ...common, betas: [FALLBACK_BETA], fallbacks: "default" })
        : await client.messages.create(common);

      if (response.stop_reason === "refusal") {
        throw new VisionError("Claude declined to read this screenshot.", "refused");
      }
      if (response.stop_reason === "max_tokens") {
        throw new VisionError("Claude ran out of output tokens before finishing.", "bad-output");
      }
      let text = "";
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
      }
      if (!text) throw new VisionError("Claude returned no text.", "bad-output");
      return {
        raw: extractJson(text),
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      throw toVisionError(err);
    }
  };
}
