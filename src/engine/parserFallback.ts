/**
 * Keyword-based request parser. Used in edge mode and whenever Bedrock is
 * unavailable or times out. Returns the exact same shape as the Bedrock
 * Lambda (ParsedRequest), so the two are interchangeable.
 *
 * PRIVACY: the parser never extracts names, ages, diagnoses or IDs. It only
 * outputs what is needed to act. Use redactText() before storing raw text.
 */
import type { ItemKind, NeedRequest, Urgency } from './types';

export type ParserSource = 'local' | 'bedrock';

/** Shared contract with the Bedrock Lambda. Every field except confidence/signals/parser is optional. */
export interface ParsedRequest {
  needKind?: ItemKind;
  quantity?: number;
  peopleAffected?: number;
  urgency?: Urgency;
  vulnerable?: boolean;
  powerAvailable?: boolean;
  /** 0..1. Below LOW_CONFIDENCE_THRESHOLD the UI should ask a human to confirm. */
  confidence: number;
  /** Short, human-readable reasons, e.g. ["need: insulin", "vulnerable: grandmother"]. */
  signals: string[];
  parser: ParserSource;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * JSON Schema for ParsedRequest. Engineer 2: put this in the Bedrock prompt and
 * validate the model output with isParsedRequest() before using it.
 */
export const PARSED_REQUEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ParsedRequest',
  type: 'object',
  additionalProperties: false,
  required: ['confidence', 'signals', 'parser'],
  properties: {
    needKind: { type: 'string', enum: ['insulin', 'medication', 'meals', 'water', 'blankets'] },
    quantity: { type: 'integer', minimum: 1, description: 'Units of needKind (doses, meals, bottles, blankets).' },
    peopleAffected: { type: 'integer', minimum: 1 },
    urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    vulnerable: { type: 'boolean', description: 'Elderly, infant/child, pregnant, disabled, or medically dependent.' },
    powerAvailable: { type: 'boolean', description: 'false if the requester says they have no electricity.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    signals: { type: 'array', items: { type: 'string' }, description: 'Short reasons. Never include names or medical details.' },
    parser: { type: 'string', enum: ['local', 'bedrock'] },
  },
} as const;

// ---------------------------------------------------------------------------
// Keyword rules (first match wins; ordered by resource criticality)
// ---------------------------------------------------------------------------

const NEED_RULES: { kind: ItemKind; pattern: RegExp }[] = [
  { kind: 'insulin', pattern: /\b(insulin|diabet\w*)\b/i },
  { kind: 'medication', pattern: /\b(medic\w*|medicine|meds|prescriptions?|pills?|inhalers?|dialysis|oxygen)\b/i },
  { kind: 'water', pattern: /\b(water|thirsty|dehydrat\w*)\b/i },
  { kind: 'meals', pattern: /\b(food|meals?|hungry|eat|eating|starving|groceries|formula)\b/i },
  { kind: 'blankets', pattern: /\b(blankets?|sleeping bags?|freezing)\b/i },
];

const VULNERABLE = /\b(grand(mother|father|ma|pa|parents?)|elderly|seniors?|old(er)? (man|woman|person|people)|bab(y|ies)|infants?|newborn|toddlers?|child(ren)?|kids?|pregnan\w*|disab\w*|wheelchair|bedridden|dialysis|oxygen)\b/i;

const NO_POWER = /\b(no (electricity|power)|without (electricity|power)|power(\s+is)?\s+out|lost (electricity|power)|blackout|outage)\b/i;
const HAS_POWER = /\b(have|got|still have) (electricity|power)\b|\bpower is (on|back)\b/i;

const URGENT = /\b(urgent(ly)?|emergency|asap|right now|immediately|dying|unconscious|can'?t breathe|critical)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const NUM = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

const PEOPLE_PATTERNS: RegExp[] = [
  new RegExp(`\\bfamily of ${NUM}\\b`, 'i'),
  new RegExp(`\\b(?:we are|there are|we're) ${NUM}\\b`, 'i'),
  new RegExp(`\\b${NUM} (?:people|persons|residents|adults|kids|children|seniors|families|of us|evacuees)\\b`, 'i'),
];

const QUANTITY_PATTERN = new RegExp(`\\b${NUM} (?:doses?|vials?|meals?|bottles?|gallons?|blankets?|packs?|boxes?|cases?)\\b`, 'i');

/** Words for a single family member imply at least one affected person. */
const SINGLE_PERSON = /\b(my|our) (grand(mother|father|ma|pa)|mom|mother|dad|father|son|daughter|husband|wife|baby|child|neighbou?r)\b/i;

const BASE_URGENCY: Record<ItemKind, Urgency> = {
  insulin: 'high',
  medication: 'high',
  water: 'high',
  meals: 'medium',
  blankets: 'low',
};

/** Default quantity when the text doesn't say: per person, for ~1 day. */
const DEFAULT_UNITS_PER_PERSON: Record<ItemKind, number> = {
  insulin: 1,
  medication: 1,
  water: 3,
  meals: 3,
  blankets: 1,
};

const URGENCY_ORDER: Urgency[] = ['low', 'medium', 'high', 'critical'];
const bump = (u: Urgency, steps = 1): Urgency =>
  URGENCY_ORDER[Math.min(URGENCY_ORDER.length - 1, URGENCY_ORDER.indexOf(u) + steps)] as Urgency;

function toNumber(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const n = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];
  return n !== undefined && n > 0 && Number.isFinite(n) ? n : undefined;
}

function firstNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const p of patterns) {
    const n = toNumber(p.exec(text)?.[1]);
    if (n !== undefined) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseRequestLocally(text: string): ParsedRequest {
  const signals: string[] = [];
  let confidence = 0.3;

  const need = NEED_RULES.find((r) => r.pattern.test(text));
  if (need) {
    signals.push(`need: ${need.kind}`);
    confidence += 0.35;
  }

  const vulnerableMatch = VULNERABLE.exec(text)?.[0];
  const medicallyDependent = need?.kind === 'insulin' || need?.kind === 'medication';
  const vulnerable = Boolean(vulnerableMatch) || medicallyDependent;
  if (vulnerableMatch) {
    signals.push(`vulnerable: ${vulnerableMatch.toLowerCase()}`);
    confidence += 0.1;
  } else if (medicallyDependent) {
    signals.push('vulnerable: medically dependent');
  }

  let powerAvailable: boolean | undefined;
  if (NO_POWER.test(text)) {
    powerAvailable = false;
    signals.push('power: out');
    confidence += 0.1;
  } else if (HAS_POWER.test(text)) {
    powerAvailable = true;
    signals.push('power: available');
  }

  let peopleAffected = firstNumber(text, PEOPLE_PATTERNS);
  if (peopleAffected !== undefined) {
    signals.push(`people: ${peopleAffected}`);
    confidence += 0.1;
  } else if (SINGLE_PERSON.test(text) || vulnerableMatch) {
    peopleAffected = 1;
  }

  let quantity = firstNumber(text, [QUANTITY_PATTERN]);
  if (quantity !== undefined) {
    signals.push(`quantity: ${quantity}`);
    confidence += 0.1;
  }

  let urgency: Urgency | undefined;
  if (need) {
    urgency = BASE_URGENCY[need.kind];
    if (vulnerable) urgency = bump(urgency);
    // Insulin without power means no refrigeration at home either.
    if (need.kind === 'insulin' && powerAvailable === false) urgency = bump(urgency);
    if (URGENT.test(text)) {
      urgency = 'critical';
      signals.push('urgent wording');
    }
    signals.push(`urgency: ${urgency}`);
    quantity ??= (peopleAffected ?? 1) * DEFAULT_UNITS_PER_PERSON[need.kind];
  }

  return {
    ...(need ? { needKind: need.kind } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(peopleAffected !== undefined ? { peopleAffected } : {}),
    ...(urgency ? { urgency } : {}),
    vulnerable,
    ...(powerAvailable !== undefined ? { powerAvailable } : {}),
    confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
    signals,
    parser: 'local',
  };
}

const ITEM_KINDS: readonly string[] = ['insulin', 'medication', 'meals', 'water', 'blankets'];
const URGENCIES: readonly string[] = URGENCY_ORDER;

/** Runtime validation for untrusted (e.g. Bedrock) output. */
export function isParsedRequest(value: unknown): value is ParsedRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const optInt = (x: unknown) => x === undefined || (Number.isInteger(x) && (x as number) >= 1);
  const optBool = (x: unknown) => x === undefined || typeof x === 'boolean';
  return (
    typeof v.confidence === 'number' &&
    v.confidence >= 0 &&
    v.confidence <= 1 &&
    Array.isArray(v.signals) &&
    v.signals.every((s) => typeof s === 'string') &&
    (v.parser === 'local' || v.parser === 'bedrock') &&
    (v.needKind === undefined || ITEM_KINDS.includes(v.needKind as string)) &&
    (v.urgency === undefined || URGENCIES.includes(v.urgency as string)) &&
    optInt(v.quantity) &&
    optInt(v.peopleAffected) &&
    optBool(v.vulnerable) &&
    optBool(v.powerAvailable)
  );
}

/**
 * Prefer a valid Bedrock result; fill any field it left out from the local parser.
 * Falls back to the local parser entirely if Bedrock output is missing or invalid.
 */
export function resolveParsedRequest(text: string, bedrock?: unknown): ParsedRequest {
  const local = parseRequestLocally(text);
  if (!isParsedRequest(bedrock)) return local;
  return {
    ...local,
    ...Object.fromEntries(Object.entries(bedrock).filter(([, v]) => v !== undefined)),
    parser: 'bedrock',
  } as ParsedRequest;
}

/** Mask phone numbers, emails and self-introductions before storing raw text. */
export function redactText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\b([Mm]y name is|I am|I'm|[Tt]his is)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?/g, '$1 [name]');
}

export interface BuildRequestInput {
  id: string;
  text: string;
  /** Raw Bedrock output, if any. Validated; ignored if invalid. */
  bedrock?: unknown;
  lat: number;
  lng: number;
  locationLabel: string;
  createdAt: number;
  source?: NeedRequest['source'];
}

export interface BuildRequestResult {
  /** null when the need couldn't be determined; the UI should ask the requester. */
  request: NeedRequest | null;
  parsed: ParsedRequest;
  needsConfirmation: boolean;
}

/** Text + location → a privacy-safe NeedRequest, ready for a REQUEST_SUBMITTED event. */
export function buildRequest(input: BuildRequestInput): BuildRequestResult {
  const parsed = resolveParsedRequest(input.text, input.bedrock);
  const needsConfirmation = parsed.confidence < LOW_CONFIDENCE_THRESHOLD || !parsed.needKind;
  if (!parsed.needKind) return { request: null, parsed, needsConfirmation };

  const peopleAffected = parsed.peopleAffected ?? 1;
  const request: NeedRequest = {
    id: input.id,
    source: input.source ?? 'resident',
    rawText: redactText(input.text),
    needKind: parsed.needKind,
    quantity: parsed.quantity ?? peopleAffected * DEFAULT_UNITS_PER_PERSON[parsed.needKind],
    peopleAffected,
    urgency: parsed.urgency ?? BASE_URGENCY[parsed.needKind],
    vulnerable: parsed.vulnerable ?? false,
    ...(parsed.powerAvailable !== undefined ? { powerAvailable: parsed.powerAvailable } : {}),
    lat: input.lat,
    lng: input.lng,
    locationLabel: input.locationLabel,
    createdAt: input.createdAt,
    status: 'open',
  };
  return { request, parsed, needsConfirmation };
}
