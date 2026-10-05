import { getGeminiClient } from './ai';
import type { Claim } from '../src/types';

// ---------------------------------------------------------------------------
// AI-generated evidence references.
//
// A member can ask a model to produce a reference for a claim. The reference is
// only ever built out of text the source response *actually contains*: the
// model is instructed to quote the supporting passage verbatim, and the result
// is then checked against that source text before it is ever stored. If the
// quote cannot be found verbatim, or the model invents a URL or citation, the
// reference is discarded and the caller reports the failure.
//
// This is why every AI reference carries an "unverified" label for life: it is
// a model's reading of the room, never proof, and the room decides what it's
// worth during contradiction resolution.
// ---------------------------------------------------------------------------

/** What the generator produces when it can ground the claim. */
export interface AiReferenceResult {
  /** Verbatim passage drawn from the source response. */
  excerpt: string;
  /** The model's one-or-two-sentence explanation of how the passage bears on the claim. */
  note: string;
  /** The model that produced it, for the unverified label. */
  modelName: string;
}

export type AiReferenceOutcome =
  | { ok: true; reference: AiReferenceResult }
  | { ok: false; reason: string };

/** Models tried in order; the first success wins. */
const REFERENCE_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

/** Hard bounds so a reference can never swamp the claim it backs. */
const MAX_EXCERPT_CHARS = 600;
const MAX_NOTE_CHARS = 400;
/** Source too short to ground anything meaningful. */
const MIN_SOURCE_CHARS = 40;

/**
 * Collapses every run of whitespace (including newlines the model may have
 * introduced) to single spaces so a verbatim check survives reformatting while
 * still rejecting changed wording.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The excerpt must be findable verbatim in the source. We try the normalized
 * comparison first, then a case-insensitive one as a courtesy for capitalisation
 * drift — but never anything looser: paraphrase is not a quote.
 */
export function isVerbatimQuote(source: string, excerpt: string): boolean {
  const s = normalizeWhitespace(source);
  const q = normalizeWhitespace(excerpt);
  if (!q) return false;
  if (s.includes(q)) return true;
  return s.toLowerCase().includes(q.toLowerCase());
}

/** Strict JSON extraction: the prompt forbids anything else, so anything else is a failure. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildPrompt(claim: Claim, sourceText: string): string {
  return [
    'You are grounding a claim extracted from an AI response in a team workspace.',
    '',
    `Claim: "${claim.text}"`,
    '',
    'Below is the FULL text of the response the claim was extracted from. You may only use this text.',
    '',
    '--- SOURCE START ---',
    sourceText,
    '--- SOURCE END ---',
    '',
    'Your job:',
    '1. Find the passage in SOURCE that this claim was drawn from.',
    '2. Quote that passage VERBATIM in "excerpt". Copy it exactly, changing no words. If the passage is longer than 600 characters, quote the most relevant part.',
    '3. In "note", write one or two sentences explaining how the passage supports the claim, using ONLY facts stated in SOURCE.',
    '',
    'Absolute rules:',
    '- Never invent a URL, link, citation, author, date, or statistic. SOURCE is the entire universe of allowed facts.',
    '- If SOURCE does not actually support the claim, return {"supported": false} and nothing else. Saying "not supported" is correct and expected; paraphrasing or inventing support is a serious error.',
    '- Do not add markdown formatting to the excerpt.',
    '',
    'Respond with ONLY one of these two JSON objects:',
    '{"supported": true, "excerpt": "<verbatim passage>", "note": "<one or two sentences>}',
    '{"supported": false}'
  ].join('\n');
}

/**
 * Asks a model to produce an unverified reference for a claim, grounded entirely
 * in the response the claim came from. Returns `ok: false` (and stores nothing)
 * whenever the result cannot be verified — the model is unavailable, the source
 * is too thin, the model declined to support the claim, or the quote it returned
 * is not verbatim in the source. Under no circumstance does this fabricate a
 * citation or store an unverifiable quote as though it were real.
 *
 * `clientSupplier` is an optional seam so tests can drive the model path without
 * a network call; production leaves it out and uses the configured client.
 */
export async function generateAiReference(
  claim: Claim,
  sourceText: string,
  clientSupplier: () => { models: { generateContent: (req: { model: string; contents: string }) => Promise<{ text?: string }> } } | null = getGeminiClient
): Promise<AiReferenceOutcome> {
  const source = (sourceText || '').trim();
  if (source.length < MIN_SOURCE_CHARS) {
    return { ok: false, reason: 'The response this claim came from is too short to ground a reference in.' };
  }

  const client = clientSupplier();
  if (!client) {
    return { ok: false, reason: 'AI is not configured on this server (no GEMINI_API_KEY), so references cannot be generated.' };
  }

  const prompt = buildPrompt(claim, source);

  for (const modelName of REFERENCE_MODELS) {
    let raw: string;
    try {
      const response = await client.models.generateContent({ model: modelName, contents: prompt });
      raw = response.text || '';
    } catch (err: any) {
      const message = (err?.message || String(err)).replace(/\s+/g, ' ').trim();
      console.warn(`[evidence] reference model ${modelName} failed: ${message.slice(0, 200)}`);
      continue;
    }

    const parsed = extractJsonObject(raw);
    if (!parsed) {
      console.warn(`[evidence] reference model ${modelName} returned non-JSON; rejecting.`);
      continue;
    }

    // An honest "I cannot support this" is a success for the safety contract,
    // just not an evidence item.
    if (parsed.supported === false) {
      return { ok: false, reason: 'The model found no passage in the source response that supports this claim, so no reference was created.' };
    }

    const excerpt = typeof parsed.excerpt === 'string' ? parsed.excerpt.trim() : '';
    const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';

    if (!excerpt || !note) {
      console.warn(`[evidence] reference model ${modelName} returned an incomplete object; rejecting.`);
      continue;
    }

    // The anti-fabrication gate. A quote that isn't verbatim in the source is
    // invention, and is discarded rather than stored as evidence.
    if (!isVerbatimQuote(source, excerpt)) {
      console.warn(`[evidence] reference model ${modelName} produced a quote not found verbatim in the source; rejecting.`);
      continue;
    }

    return {
      ok: true,
      reference: {
        excerpt: excerpt.slice(0, MAX_EXCERPT_CHARS),
        note: note.slice(0, MAX_NOTE_CHARS),
        modelName
      }
    };
  }

  return { ok: false, reason: 'Every reference model failed or returned an unverifiable result. No evidence was created.' };
}
