/**
 * Minimal Octokit stand-in.
 *
 * The real client is not worth mocking wholesale; the actions only touch a
 * handful of endpoints plus `paginate`. Hand-rolling the fake keeps the tests
 * honest about exactly which calls the code makes, and `paginate` here flattens
 * one call the way the real helper flattens many pages.
 */
import type { GitHub } from '@actions/github/lib/utils';

export type Octokit = InstanceType<typeof GitHub>;

export interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

export type EndpointHandler = (params: Record<string, unknown>) => unknown;

export class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message = `HTTP ${String(status)}`) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/** `Array.isArray` widens to `any[]`; this keeps the element type honest. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export interface FakeOctokit {
  octokit: Octokit;
  calls: RecordedCall[];
}

/**
 * Build a fake client from a flat map of `"group.endpoint"` handlers.
 * A handler may return a value or throw an {@link HttpError}.
 */
export function createFakeOctokit(handlers: Record<string, EndpointHandler>): FakeOctokit {
  const calls: RecordedCall[] = [];
  const rest: Record<string, Record<string, unknown>> = {};

  for (const [path, handler] of Object.entries(handlers)) {
    const [group, endpoint] = path.split('.');
    if (group === undefined || endpoint === undefined) {
      throw new Error(`Handler key "${path}" must be "group.endpoint".`);
    }

    const wrapped = (params: Record<string, unknown> = {}): unknown => {
      calls.push({ endpoint: path, params });
      return handler(params);
    };
    // Tag the function so `paginate` can route back to the right handler.
    Object.defineProperty(wrapped, 'endpointPath', { value: path });

    rest[group] ??= {};
    rest[group][endpoint] = wrapped;
  }

  const paginate = async (
    route: unknown,
    params: Record<string, unknown> = {},
  ): Promise<unknown[]> => {
    if (typeof route !== 'function') throw new Error('paginate expects an endpoint function.');
    const response = await (route as (p: Record<string, unknown>) => unknown)(params);
    if (isUnknownArray(response)) return response;
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const { data } = response;
      if (isUnknownArray(data)) return data;
    }
    throw new Error('paginate expects an array or a response with an array `data`.');
  };

  const octokit = { rest, paginate } as unknown as Octokit;
  return { octokit, calls };
}
