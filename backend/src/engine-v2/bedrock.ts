/**
 * Bedrock (Amazon Nova) request parser for the v2 engine path.
 *
 * Produces Engineer 3's ParsedRequest shape so it can be passed straight into
 * buildRequest(text, bedrock). If USE_BEDROCK!=="true", or the call fails, the
 * caller falls back to the local keyword parser (parser: "local").
 *
 * Nova request/response format differs from Claude:
 *   request:  { messages:[{role,content:[{text}]}], inferenceConfig:{maxTokens} }
 *   response: output.message.content[0].text
 */
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ParsedRequest } from "@lifeline/engine";

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
const REGION = process.env.AWS_REGION ?? "us-west-2";

const PROMPT = (text: string) => `You extract structured data from an emergency help request.
Return ONLY a JSON object (no markdown, no prose) with these keys:
- needKind: one of "insulin","medication","meals","water","blankets" (best match)
- urgency: one of "critical","high","medium","low"
- peopleAffected: integer >= 1
- vulnerable: boolean (elderly, infant, pregnant, disabled, medically dependent)
- powerAvailable: boolean (false if they say no electricity/power out)
- confidence: number 0..1
- signals: array of short strings explaining the classification (no names, no medical records)

Request: ${text}`;

function extractJson(s: string): Record<string, unknown> | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns a ParsedRequest (parser:"bedrock") on success, or null so the caller
 * uses the local parser. Never throws — Bedrock is an enhancement, not a hard dep.
 */
export async function parseWithBedrock(text: string): Promise<ParsedRequest | null> {
  if (process.env.USE_BEDROCK !== "true") return null;
  try {
    const client = new BedrockRuntimeClient({ region: REGION });
    const body = {
      messages: [{ role: "user", content: [{ text: PROMPT(text) }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0 },
    };
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      }),
    );
    const raw = new TextDecoder().decode(res.body);
    const envelope = JSON.parse(raw) as { output?: { message?: { content?: { text?: string }[] } } };
    const textOut = envelope.output?.message?.content?.[0]?.text ?? "";
    const parsed = extractJson(textOut);
    if (!parsed) return null;

    const need = String(parsed.needKind ?? "").toLowerCase();
    const validNeeds = ["insulin", "medication", "meals", "water", "blankets"];
    const result: ParsedRequest = {
      ...(validNeeds.includes(need) ? { needKind: need as ParsedRequest["needKind"] } : {}),
      ...(typeof parsed.peopleAffected === "number" && parsed.peopleAffected >= 1
        ? { peopleAffected: Math.max(1, Math.round(parsed.peopleAffected)) }
        : {}),
      ...(typeof parsed.urgency === "string" ? { urgency: parsed.urgency as ParsedRequest["urgency"] } : {}),
      ...(typeof parsed.vulnerable === "boolean" ? { vulnerable: parsed.vulnerable } : {}),
      ...(typeof parsed.powerAvailable === "boolean" ? { powerAvailable: parsed.powerAvailable } : {}),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(String) : [],
      parser: "bedrock",
    };
    return result;
  } catch (err) {
    console.warn("Bedrock (Nova) parse failed, falling back to local parser:", err);
    return null;
  }
}
