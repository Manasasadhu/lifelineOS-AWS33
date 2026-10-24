import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { ParsedRequest } from "../types";

const DEFAULT_LOCATION = "Downtown San José";

function rulesParse(text: string): ParsedRequest {
  const lower = text.toLowerCase();
  let need = "unknown";
  if (/(insulin|medication|pharmacy|medicine)/.test(lower)) need = "insulin";
  else if (/(meal|food|hungry|shelter)/.test(lower)) need = "meals";
  else if (/(power|electric|generator|battery)/.test(lower)) need = "power";
  else if (/(water)/.test(lower)) need = "water";
  else if (/(transport|ride|driver)/.test(lower)) need = "transport";

  const peopleMatch = lower.match(/(\d+)\s*(people|person|residents|family)/);
  const people = peopleMatch ? Number(peopleMatch[1]) : /(grandmother|grandpa|child|me\b)/.test(lower) ? 1 : 1;

  const urgency: ParsedRequest["urgency"] = /(insulin|critical|no power|power (is )?out|can't breathe)/.test(lower)
    ? "critical"
    : /(need|urgent|tonight|immediately)/.test(lower)
      ? "high"
      : "medium";

  const powerAvailable = /(no power|power (is |went )?out|lost power|electricity is out|without power)/.test(lower)
    ? false
    : /(have power|electricity is on)/.test(lower)
      ? true
      : null;

  let location = DEFAULT_LOCATION;
  if (/shelter/.test(lower)) location = "Shelter C, San José";
  if (/downtown/.test(lower)) location = "Downtown San José";
  if (/sjsu|campus/.test(lower)) location = "SJSU, San José";

  return { need, urgency, people, powerAvailable, location, source: "rules" };
}

export async function parseRequest(text: string): Promise<ParsedRequest> {
  const fallback = rulesParse(text);
  if (process.env.USE_BEDROCK !== "true") return fallback;

  try {
    const modelId = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0";
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-west-2" });
    const prompt = `Extract a JSON object from this emergency request. Keys: need (short noun: insulin|meals|power|water|transport|other), urgency (critical|high|medium|low), people (number), powerAvailable (true|false|null), location (string). No markdown.
Request: ${text}`;

    const command = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const response = await client.send(command);
    const raw = new TextDecoder().decode(response.body);
    const envelope = JSON.parse(raw) as { content?: { text?: string }[] };
    const textOut = envelope.content?.[0]?.text ?? raw;
    const jsonMatch = textOut.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ParsedRequest>;
    return {
      need: parsed.need ?? fallback.need,
      urgency: parsed.urgency ?? fallback.urgency,
      people: Number(parsed.people ?? fallback.people),
      powerAvailable: parsed.powerAvailable ?? fallback.powerAvailable,
      location: parsed.location ?? fallback.location,
      source: "bedrock",
    };
  } catch (err) {
    console.warn("Bedrock parse failed, using rules", err);
    return fallback;
  }
}
