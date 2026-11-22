import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { extractJson, VISION_SCHEMA } from "./schema";
import { VisionError, type AskInput, type AskJson, type VisionCall, type VisionReply } from "./types";

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

/** Ask Claude a question that must be answered as JSON matching a schema, with optional pictures. */
export function claudeAsk(apiKey: string, model: string): AskJson {
  if (!apiKey) throw new VisionError("Add your Claude API key in Settings.", "config");
  // The key lives in this browser only; requests go straight to Anthropic.
  // dangerouslyAllowBrowser acknowledges that — fine for a personal tool, not for a shared deployment.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45_000 });

  return async ({ system, user, images = [], schema, effort = "low" }): Promise<VisionReply> => {
    const common = {
      model,
      max_tokens: 16000,
      // The stable prefix (instructions and name lists) is cached; only the pictures and the match state vary.
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
      // Low effort by default: the player is mid-match and waiting on the answer.
      output_config: { effort, format: { type: "json_schema" as const, schema } },
      messages: [
        {
          role: "user" as const,
          content: [
            ...images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 } })),
            { type: "text" as const, text: user },
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
        throw new VisionError("Claude declined to answer this one.", "refused");
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

/** The screenshot reader: one picture in, the screen's contents out. */
export function claudeVision(apiKey: string, model: string, effort?: AskInput["effort"]): VisionCall {
  const ask = claudeAsk(apiKey, model);
  return (image, ctx) => ask({ system: SYSTEM_PROMPT, user: userPrompt(ctx), images: [image], schema: VISION_SCHEMA, effort });
}
