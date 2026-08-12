/**
 * Tolerant input parsing shared by both action entrypoints.
 *
 * `@actions/core` throws on an empty or non-YAML boolean and returns `NaN`
 * silently for a bad number. Defaults declared in `action.yml` normally prevent
 * the empty case, but a composite action or a direct `node dist/index.js`
 * invocation can leave a variable unset — and crashing on an optional flag is
 * the wrong failure mode. Every helper here falls back and says so.
 */
import * as core from '@actions/core';

const TRUTHY = new Set(['true', 'yes', '1', 'on']);
const FALSY = new Set(['false', 'no', '0', 'off']);

/** A trimmed input, or `undefined` when blank. */
export function optionalInput(name: string): string | undefined {
  const raw = core.getInput(name).trim();
  return raw === '' ? undefined : raw;
}

/** A trimmed input, or `fallback` when blank. */
export function stringInput(name: string, fallback: string): string {
  return optionalInput(name) ?? fallback;
}

/** A boolean input, warning and falling back on anything unrecognized. */
export function booleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw === '') return fallback;
  if (TRUTHY.has(raw)) return true;
  if (FALSY.has(raw)) return false;

  core.warning(`Input \`${name}\` is not a boolean ("${raw}"); using ${String(fallback)}.`);
  return fallback;
}

/** A positive integer input, warning and falling back on anything else. */
export function positiveIntInput(name: string, fallback: number): number {
  const raw = core.getInput(name).trim();
  if (raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    core.warning(
      `Input \`${name}\` is not a positive integer ("${raw}"); using ${String(fallback)}.`,
    );
    return fallback;
  }
  return parsed;
}
