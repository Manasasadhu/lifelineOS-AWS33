import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  isParsedRequest,
  LOW_CONFIDENCE_THRESHOLD,
  parseRequestLocally,
  redactText,
  resolveParsedRequest,
  type ParsedRequest,
} from '../parserFallback';
import { GRANDMOTHER_REQUEST_TEXT, simulateEarthquake } from '../scenario';

describe('parseRequestLocally', () => {
  it('parses the scenario request', () => {
    expect(parseRequestLocally(GRANDMOTHER_REQUEST_TEXT)).toEqual({
      needKind: 'insulin',
      quantity: 1,
      peopleAffected: 1,
      urgency: 'critical',
      vulnerable: true,
      powerAvailable: false,
      confidence: 0.85,
      signals: ['need: insulin', 'vulnerable: grandmother', 'power: out', 'urgency: critical'],
      parser: 'local',
    });
  });

  it.each<[string, Partial<ParsedRequest>]>([
    ['We need food for 40 people at the church', { needKind: 'meals', peopleAffected: 40, quantity: 120, urgency: 'medium', vulnerable: false }],
    ['family of five, out of water, two kids', { needKind: 'water', peopleAffected: 5, quantity: 15, urgency: 'critical', vulnerable: true }],
    ['My dad ran out of his meds', { needKind: 'medication', peopleAffected: 1, urgency: 'critical', vulnerable: true }],
    ['Need 10 blankets please, freezing tonight', { needKind: 'blankets', quantity: 10, urgency: 'low' }],
    ['URGENT need meals right now', { needKind: 'meals', urgency: 'critical' }],
    ['power is out and baby needs formula', { needKind: 'meals', vulnerable: true, powerAvailable: false, urgency: 'high' }],
    ['we still have power, need 3 bottles of water', { needKind: 'water', quantity: 3, powerAvailable: true }],
  ])('%s', (text, expected) => {
    expect(parseRequestLocally(text)).toMatchObject(expected);
  });

  it('prefers the most critical need when several are mentioned', () => {
    expect(parseRequestLocally('need food, water and insulin').needKind).toBe('insulin');
  });

  it('returns low confidence and no need for unrelated text', () => {
    const p = parseRequestLocally('hello is anyone there');
    expect(p.needKind).toBeUndefined();
    expect(p.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it('never outputs names', () => {
    const p = parseRequestLocally('My name is Maria Lopez and my grandmother needs insulin');
    expect(JSON.stringify(p)).not.toMatch(/Maria|Lopez/);
  });

  it('output always passes the shared validator', () => {
    for (const text of [GRANDMOTHER_REQUEST_TEXT, 'hello', 'food for 3']) {
      expect(isParsedRequest(parseRequestLocally(text))).toBe(true);
    }
  });
});

describe('Bedrock interchangeability', () => {
  it('uses a valid Bedrock result and fills gaps from the local parser', () => {
    const bedrock = { needKind: 'insulin', urgency: 'high', confidence: 0.92, signals: ['llm'], parser: 'bedrock' };
    const r = resolveParsedRequest(GRANDMOTHER_REQUEST_TEXT, bedrock);
    expect(r).toMatchObject({ parser: 'bedrock', urgency: 'high', confidence: 0.92, powerAvailable: false, vulnerable: true });
  });

  it('falls back to local when Bedrock output is invalid or missing', () => {
    expect(resolveParsedRequest(GRANDMOTHER_REQUEST_TEXT, { needKind: 'pizza', confidence: 2 }).parser).toBe('local');
    expect(resolveParsedRequest(GRANDMOTHER_REQUEST_TEXT, undefined).parser).toBe('local');
    expect(resolveParsedRequest(GRANDMOTHER_REQUEST_TEXT, 'timeout').parser).toBe('local');
  });
});

describe('buildRequest', () => {
  const base = { id: 'r1', lat: 37.33, lng: -121.88, locationLabel: 'near SJSU', createdAt: 10 };

  it('builds a privacy-safe NeedRequest', () => {
    const { request, needsConfirmation } = buildRequest({
      ...base,
      text: "I'm Maria Lopez, call 408-555-1234. My grandmother needs insulin, no power.",
    });
    expect(needsConfirmation).toBe(false);
    expect(request).toMatchObject({ needKind: 'insulin', urgency: 'critical', status: 'open', createdAt: 10 });
    expect(request!.rawText).not.toMatch(/Maria|Lopez|555/);
  });

  it('returns null and asks for confirmation when the need is unknown', () => {
    const { request, needsConfirmation } = buildRequest({ ...base, text: 'help' });
    expect(request).toBeNull();
    expect(needsConfirmation).toBe(true);
  });

  it('feeds the scenario T+4 event (local parser by default)', () => {
    const event = simulateEarthquake().find((s) => s.event.type === 'REQUEST_SUBMITTED')!.event;
    expect(event).toMatchObject({ type: 'REQUEST_SUBMITTED', request: { needKind: 'insulin', urgency: 'critical', vulnerable: true } });
  });
});

describe('redactText', () => {
  it('masks emails, phone numbers and self-introductions', () => {
    expect(redactText('This is John Smith, email js@x.com, phone (408) 555-0199')).toBe(
      'This is [name], email [email], phone [phone]',
    );
  });
});
