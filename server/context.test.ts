import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contextTraceEnabled, traceRoomContext } from './context';

// ---------------------------------------------------------------------------
// CONTEXT_DEBUG toggle — when CONTEXT_DEBUG=true every composed AI prompt is
// printed to stdout so engineers can inspect what the model is being told
// about the room's history without editing socket.ts.
// ---------------------------------------------------------------------------

describe('contextTraceEnabled', () => {
  test('returns false when CONTEXT_DEBUG is not set', () => {
    const prev = process.env.CONTEXT_DEBUG;
    delete process.env.CONTEXT_DEBUG;
    try {
      assert.strictEqual(contextTraceEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
    }
  });

  test('returns false when CONTEXT_DEBUG is "false"', () => {
    const prev = process.env.CONTEXT_DEBUG;
    process.env.CONTEXT_DEBUG = 'false';
    try {
      assert.strictEqual(contextTraceEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
      else delete process.env.CONTEXT_DEBUG;
    }
  });

  test('returns true when CONTEXT_DEBUG is "true"', () => {
    const prev = process.env.CONTEXT_DEBUG;
    process.env.CONTEXT_DEBUG = 'true';
    try {
      assert.strictEqual(contextTraceEnabled(), true);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
      else delete process.env.CONTEXT_DEBUG;
    }
  });

  test('returns false for garbage values', () => {
    const prev = process.env.CONTEXT_DEBUG;
    process.env.CONTEXT_DEBUG = '1';
    try {
      assert.strictEqual(contextTraceEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
      else delete process.env.CONTEXT_DEBUG;
    }
  });
});

describe('traceRoomContext', () => {
  test('is silent when CONTEXT_DEBUG is off', () => {
    const prev = process.env.CONTEXT_DEBUG;
    process.env.CONTEXT_DEBUG = 'false';
    try {
      let threw = false;
      try {
        traceRoomContext('anything', true);
        traceRoomContext('', false);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
      else delete process.env.CONTEXT_DEBUG;
    }
  });

  test('accepts any prompt string and hasContext flag without throwing', () => {
    const prev = process.env.CONTEXT_DEBUG;
    process.env.CONTEXT_DEBUG = 'true';
    try {
      let threw = false;
      try {
        traceRoomContext('## Decision Record\n\nsome text', true);
        traceRoomContext('', false);
        traceRoomContext('very long'.repeat(200), true);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false);
    } finally {
      if (prev !== undefined) process.env.CONTEXT_DEBUG = prev;
      else delete process.env.CONTEXT_DEBUG;
    }
  });
});
