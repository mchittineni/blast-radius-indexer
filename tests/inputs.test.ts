import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';

// `@actions/core` v3 is ESM, so its namespace object is frozen and `vi.spyOn`
// cannot redefine an export. Replacing the module is the supported route.
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  warning: vi.fn(),
}));

import { booleanInput, optionalInput, positiveIntInput, stringInput } from '../shared/inputs';

/** `@actions/core` reads `INPUT_<NAME>`; set it the way the runner would. */
function setInput(name: string, value: string): void {
  process.env[`INPUT_${name.toUpperCase()}`] = value;
}

const warnMock = vi.mocked(core.warning);

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) process.env[key] = '';
  }
  warnMock.mockClear();
});

describe('optionalInput / stringInput', () => {
  it('trims a provided value', () => {
    setInput('thing', '  value  ');
    expect(optionalInput('thing')).toBe('value');
  });

  it('treats a blank value as absent', () => {
    setInput('thing', '   ');
    expect(optionalInput('thing')).toBeUndefined();
    expect(stringInput('thing', 'fallback')).toBe('fallback');
  });
});

describe('booleanInput', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['1', true],
    ['on', true],
    ['false', false],
    ['no', false],
    ['0', false],
    ['off', false],
  ])('reads %s as %s', (raw, expected) => {
    setInput('flag', raw);
    expect(booleanInput('flag', !expected)).toBe(expected);
  });

  it('falls back on a blank value instead of throwing', () => {
    // core.getBooleanInput throws here; an optional flag must not crash the run.
    expect(booleanInput('flag', true)).toBe(true);
    expect(booleanInput('flag', false)).toBe(false);
  });

  it('warns and falls back on an unrecognized value', () => {
    setInput('flag', 'maybe');

    expect(booleanInput('flag', false)).toBe(false);
    expect(warnMock).toHaveBeenCalledOnce();
  });
});

describe('positiveIntInput', () => {
  it('parses a positive integer', () => {
    setInput('count', '42');
    expect(positiveIntInput('count', 8)).toBe(42);
  });

  it('falls back on a blank value', () => {
    expect(positiveIntInput('count', 8)).toBe(8);
  });

  it.each(['0', '-5', 'abc', '1.5', '1e999'])('warns and falls back on %s', (raw) => {
    setInput('count', raw);

    expect(positiveIntInput('count', 8)).toBe(8);
    expect(warnMock).toHaveBeenCalledOnce();
  });
});
