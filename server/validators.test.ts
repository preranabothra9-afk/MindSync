import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attachEvidenceSchema } from './validators';

// ---------------------------------------------------------------------------
// Evidence shape validation: the per-kind rules that keep malformed or hostile
// payloads from reaching the database. The AI-reference kind is deliberately
// absent from the client-facing schema — an AI reference can only ever be
// produced by the generator, never posted directly as evidence.
// ---------------------------------------------------------------------------

function parse(body: unknown) {
  const result = attachEvidenceSchema.safeParse(body);
  return result.success ? { ok: true as const, data: result.data } : { ok: false as const, error: result.error.issues[0]?.message };
}

describe('attachEvidenceSchema', () => {
  test('accepts a minimal link', () => {
    const r = parse({ kind: 'url', title: 'Redis docs', url: 'https://redis.io/docs' });
    assert.equal(r.ok, true);
  });

  test('accepts a quote with an optional source', () => {
    const r = parse({ kind: 'quote', title: 'Single-threaded', excerpt: 'Redis is single-threaded.', source: 'Redis docs' });
    assert.equal(r.ok, true);
  });

  test('accepts a user note', () => {
    const r = parse({ kind: 'user', title: 'Ran a benchmark', excerpt: 'Our p99 dropped after caching.' });
    assert.equal(r.ok, true);
  });

  test('accepts a file payload', () => {
    const r = parse({
      kind: 'file',
      title: 'Benchmark results',
      fileName: 'bench.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      data: 'data:application/pdf;base64,JVBERi0xLjQK',
    });
    assert.equal(r.ok, true);
  });

  test('rejects an unknown kind', () => {
    const r = parse({ kind: 'rumour', title: 'Heard it somewhere', excerpt: 'x' });
    assert.equal(r.ok, false);
  });

  test('rejects the ai kind from a direct attach', () => {
    // AI references are generated server-side only, so a client may never post
    // one directly — that would let anyone dress invented text up as an AI
    // reference and bypass the verbatim gate.
    const r = parse({ kind: 'ai', title: 'AI said so', excerpt: 'Trust me.' });
    assert.equal(r.ok, false);
  });

  test('requires a title', () => {
    const r = parse({ kind: 'url', url: 'https://redis.io' });
    assert.equal(r.ok, false);
  });

  test('rejects an empty title', () => {
    const r = parse({ kind: 'url', title: '   ', url: 'https://redis.io' });
    assert.equal(r.ok, false);
  });

  test('rejects a title over the length cap', () => {
    const r = parse({ kind: 'user', title: 'x'.repeat(121), excerpt: 'something' });
    assert.equal(r.ok, false);
  });

  test('rejects an excerpt over the length cap', () => {
    const r = parse({ kind: 'user', title: 'Note', excerpt: 'x'.repeat(2001) });
    assert.equal(r.ok, false);
  });
});
