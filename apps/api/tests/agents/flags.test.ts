import { afterEach, describe, expect, it } from 'vitest';

import { isAgentsEnabled } from 'src/agents/index.js';

const originalValue = process.env.AGENTS_ENABLED;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.AGENTS_ENABLED;
  } else {
    process.env.AGENTS_ENABLED = originalValue;
  }
});

describe('agents flags', () => {
  it('defaults to disabled when env is absent', () => {
    delete process.env.AGENTS_ENABLED;
    expect(isAgentsEnabled()).toBe(false);
  });

  it('treats true-ish values as enabled', () => {
    process.env.AGENTS_ENABLED = 'true';
    expect(isAgentsEnabled()).toBe(true);

    process.env.AGENTS_ENABLED = 'YES';
    expect(isAgentsEnabled()).toBe(true);
  });

  it('treats false-ish values as disabled', () => {
    process.env.AGENTS_ENABLED = '0';
    expect(isAgentsEnabled()).toBe(false);
  });
});
