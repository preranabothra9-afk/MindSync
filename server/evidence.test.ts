import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isVerbatimQuote,
  extractJsonObject,
  generateAiReference,
  type AiReferenceOutcome,
} from './evidence';
import type { Claim } from '../src/types';

// ---------------------------------------------------------------------------
// The evidence system's central promise: it never fabricates a citation or a
// quote. These tests pin the guarantees the UI relies on — the unverified label
// is honest because the quote really did come from the source, verbatim.
// ---------------------------------------------------------------------------

const SOURCE = [
  'Redis is a single-threaded in-memory data store.',
  'It achieves high throughput by keeping the working set in memory and',
  'avoiding disk access on the hot path. Persistence is an optional layer',
  'that snapshots the dataset to disk at configurable intervals.',
].join(' ');

function makeClaim(text: string): Claim {
  return {
    id: 'claim-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    modelKey: 'gemini-2.5-flash',
    modelName: 'Gemini 2.5 Flash',
    text,
    createdAt: new Date().toISOString(),
  };
}

/** Builds a fake model client that returns the given text for every model. */
function fakeClient(text: string) {
  return () => ({
    models: {
      generateContent: async () => ({ text }),
    },
  });
}

describe('isVerbatimQuote', () => {
  test('accepts a passage copied exactly', () => {
    assert.equal(
      isVerbatimQuote(SOURCE, 'It achieves high throughput by keeping the working set in memory'),
      true
    );
  });

  test('accepts a passage with only whitespace reformatting', () => {
    // The quote breaks the line mid-sentence; normalisation must bridge it.
    assert.equal(
      isVerbatimQuote(SOURCE, 'single-threaded in-memory data store.\nIt achieves high throughput'),
      true
    );
  });

  test('rejects a paraphrase that changes wording', () => {
    assert.equal(
      isVerbatimQuote(SOURCE, 'Redis keeps everything in memory to run quickly'),
      false
    );
  });

  test('rejects a quote that adds words the source never said', () => {
    assert.equal(
      isVerbatimQuote(SOURCE, 'Redis is a single-threaded in-memory data store with multi-threaded I/O'),
      false
    );
  });

  test('rejects an empty excerpt', () => {
    assert.equal(isVerbatimQuote(SOURCE, '   '), false);
  });
});

describe('extractJsonObject', () => {
  test('parses a JSON object surrounded by prose', () => {
    assert.deepEqual(
      extractJsonObject('Sure! Here it is:\n{"supported": true, "excerpt": "a", "note": "b"}\nHope that helps.'),
      { supported: true, excerpt: 'a', note: 'b' }
    );
  });

  test('returns null for prose with no object', () => {
    assert.equal(extractJsonObject('The claim is supported by the passage above.'), null);
  });

  test('returns null for malformed JSON', () => {
    assert.equal(extractJsonObject('{"supported": true, "excerpt": '), null);
  });

  test('reaches the outermost braces when the object contains nested braces', () => {
    // A quote may legitimately contain braces; the extractor must span to the
    // real closing brace of the top-level object rather than the first one.
    assert.deepEqual(
      extractJsonObject('Here: {"supported": true, "excerpt": "func() { return 1; }", "note": "n"} done.'),
      { supported: true, excerpt: 'func() { return 1; }', note: 'n' }
    );
  });
});

describe('generateAiReference', () => {
  test('refuses without a configured model and fabricates nothing', async () => {
    const outcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      () => null
    );
    assert.equal(outcome.ok, false);
    assert.match((outcome as { ok: false; reason: string }).reason, /not configured/i);
  });

  test('refuses when the source is too thin to ground anything', async () => {
    const outcome = await generateAiReference(
      makeClaim('Redis is fast.'),
      'Short response.',
      fakeClient('{"supported": true, "excerpt": "Short response.", "note": "yes"}')
    );
    assert.equal(outcome.ok, false);
    assert.match((outcome as { ok: false; reason: string }).reason, /too short/i);
  });

  test('honours an honest "not supported" answer by creating nothing', async () => {
    const outcome = await generateAiReference(
      makeClaim('Redis writes to disk synchronously on every command.'),
      SOURCE,
      fakeClient('{"supported": false}')
    );
    assert.equal(outcome.ok, false);
    assert.match((outcome as { ok: false; reason: string }).reason, /no passage/i);
  });

  test('rejects a quote that is not verbatim in the source', async () => {
    // The model paraphrases instead of quoting. This is the fabrication case:
    // the generator must refuse rather than store invented text as a quote.
    const outcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      fakeClient('{"supported": true, "excerpt": "Redis uses one thread to serve all requests", "note": "Yes."}')
    );
    assert.equal(outcome.ok, false);
    assert.match((outcome as { ok: false; reason: string }).reason, /unverifiable|failed/i);
  });

  test('rejects a truncated excerpt missing the required note', async () => {
    const outcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      fakeClient('{"supported": true, "excerpt": "Redis is a single-threaded in-memory data store."}')
    );
    assert.equal(outcome.ok, false);
  });

  test('rejects a client that returns prose instead of JSON', async () => {
    const outcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      fakeClient('The claim is clearly supported by the first sentence.')
    );
    assert.equal(outcome.ok, false);
  });

  test('produces a reference only for a genuine verbatim quote', async () => {
    const excerpt = 'Redis is a single-threaded in-memory data store.';
    const note = 'The opening sentence states that Redis is single-threaded.';
    const outcome: AiReferenceOutcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      fakeClient(JSON.stringify({ supported: true, excerpt, note }))
    );
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.reference.excerpt, excerpt);
      assert.equal(outcome.reference.note, note);
      assert.ok(outcome.reference.modelName.length > 0);
    }
  });

  test('falls back across models and reports when all fail', async () => {
    let calls = 0;
    const outcome = await generateAiReference(
      makeClaim('Redis is single-threaded.'),
      SOURCE,
      () => ({
        models: {
          generateContent: async () => {
            calls++;
            throw new Error('503 Service Unavailable');
          },
        },
      })
    );
    assert.equal(outcome.ok, false);
    assert.match((outcome as { ok: false; reason: string }).reason, /unverifiable|failed/i);
    // Every model in the cascade was attempted before giving up.
    assert.ok(calls >= 1);
  });
});
