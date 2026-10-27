import { CookieJar } from 'tough-cookie';
import { aborted, EmszmalError, validation } from './errors.js';
import type { ClientOptions, RequestOptions } from './types.js';
import { duration, nonempty, responseObject } from './validation.js';

export const API_URLS = Object.freeze({
  production: 'https://web.emszmal.pl/api',
  test: 'https://web.emszmal.pl/apidev',
});

/** Races work with cancellation even when a user callback ignores its signal. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(aborted());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, ms)); }), signal);
  } finally { clearTimeout(timer); }
}

export class Transport {
  readonly cleanupTimeoutMs: number;
  readonly secondPhaseDelayMs: number;
  #baseUrl: string;
  #license: { APIId: string; APIKey: string };
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;

  constructor(options: ClientOptions) {
    if (!options?.license) validation('license is required.');
    nonempty(options.license.apiId, 'license.apiId');
    nonempty(options.license.apiKey, 'license.apiKey');
    if (options.environment !== undefined && options.environment !== 'test' && options.environment !== 'production') validation('Unknown API environment.');
    let url: URL;
    try { url = new URL(options.baseUrl ?? API_URLS[options.environment ?? 'production']); }
    catch { validation('baseUrl must be an absolute URL.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
      validation('baseUrl must be HTTPS (or HTTP loopback), without credentials, query or fragment.');
    }
    this.#baseUrl = url.href.replace(/\/+$/, '');
    this.#license = { APIId: options.license.apiId, APIKey: options.license.apiKey };
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') validation('fetch must be a function.');
    this.#timeoutMs = duration(options.requestTimeoutMs ?? 120_000, 'requestTimeoutMs');
    this.cleanupTimeoutMs = duration(options.cleanupTimeoutMs ?? 10_000, 'cleanupTimeoutMs');
    this.secondPhaseDelayMs = duration(options.secondPhaseDelayMs ?? 10_000, 'secondPhaseDelayMs', 10_000);
  }

  hasSessionCookie(jar: CookieJar): boolean {
    return jar.getCookieStringSync(`${this.#baseUrl}/Accounts/GetAccountsList`).length > 0;
  }

  async request(
    endpoint: string,
    data: Record<string, unknown>,
    jar: CookieJar,
    options: RequestOptions = {},
    timeoutMs = this.#timeoutMs,
  ): Promise<Record<string, unknown>> {
    if (options.signal?.aborted) throw aborted();
    const timeout = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const url = `${this.#baseUrl}${endpoint}`;
    try {
      const work = (async () => {
        const cookie = jar.getCookieStringSync(url);
        const response = await this.#fetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify({ ...data, License: this.#license }),
          signal,
        });
        if (signal.aborted) throw aborted();
        if (!response.ok) {
          await response.body?.cancel();
          throw new EmszmalError('HTTP', 'emSzmal returned an unsuccessful HTTP status.', response.status);
        }
        for (const value of response.headers.getSetCookie()) {
          jar.setCookieSync(value, url, { ignoreError: true });
        }
        let body: unknown;
        try { body = await response.json(); }
        catch { throw new EmszmalError('INVALID_RESPONSE', 'emSzmal returned invalid JSON.'); }
        responseObject(body);
        return body;
      })();
      return await abortable(work, signal);
    } catch (error) {
      if (options.signal?.aborted) throw aborted();
      if (timeout.signal.aborted) throw new EmszmalError('TIMEOUT', 'The emSzmal request timed out.');
      if (error instanceof EmszmalError) throw error;
      throw new EmszmalError('TRANSPORT', 'Could not communicate with emSzmal.');
    } finally { clearTimeout(timer); }
  }
}
