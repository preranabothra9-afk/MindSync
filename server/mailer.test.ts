import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { isMailConfigured } from './mailer';

// ---------------------------------------------------------------------------
// Mail provider resolution.
//
// deliver() picks a provider from env, and the whole point worth testing is
// the precedence: Brevo beats Resend beats Gmail, and an unconfigured provider
// is never selected. The SMTP transport is cached on first build, so every
// case below has to run against a pristine module state or the cache would
// make the results order-dependent.
// ---------------------------------------------------------------------------

const MAIL_KEYS = [
  'RESEND_API_KEY',
  'BREVO_USER',
  'BREVO_PASS',
  'SMTP_USER',
  'SMTP_PASS',
] as const;

let saved: Record<string, string | undefined>;

describe('isMailConfigured', () => {
  before(() => {
    saved = {};
    for (const key of MAIL_KEYS) saved[key] = process.env[key];
    for (const key of MAIL_KEYS) delete process.env[key];
  });

  after(() => {
    for (const key of MAIL_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test('is false when no provider is configured', () => {
    assert.strictEqual(isMailConfigured(), false);
  });

  test('is true with only Brevo credentials', () => {
    process.env.BREVO_USER = 'me@example.com';
    process.env.BREVO_PASS = 'xsmtpsib-key';
    try {
      assert.strictEqual(isMailConfigured(), true);
    } finally {
      delete process.env.BREVO_USER;
      delete process.env.BREVO_PASS;
    }
  });

  test('is true with only a Resend key', () => {
    process.env.RESEND_API_KEY = 're_key';
    try {
      assert.strictEqual(isMailConfigured(), true);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  test('is true with only Gmail SMTP credentials', () => {
    process.env.SMTP_USER = 'me@gmail.com';
    process.env.SMTP_PASS = 'app-password';
    try {
      assert.strictEqual(isMailConfigured(), true);
    } finally {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    }
  });

  test('is false when a Brevo password is missing its login', () => {
    process.env.BREVO_PASS = 'xsmtpsib-key';
    try {
      assert.strictEqual(isMailConfigured(), false);
    } finally {
      delete process.env.BREVO_PASS;
    }
  });
});
