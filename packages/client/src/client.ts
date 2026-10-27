import { CookieJar } from 'tough-cookie';
import { EmszmalError, validation } from './errors.js';
import { EmszmalSession } from './session.js';
import { abortable, Transport } from './transport.js';
import type { AccountsHistoryQuery, AccountsHistoryResponse, AccountsResponse, BankCredentials, ClientOptions, HistoryQuery, HistoryResponse, OperationOptions, RequestOptions } from './types.js';
import { accountsHistoryQuery, credentials, historyQuery, nonempty } from './validation.js';

/** Safe to share: each operation has its own session and cookie jar. */
export class EmszmalClient {
  #transport: Transport;

  constructor(options: ClientOptions) { this.#transport = new Transport(options); }

  async openSession(options: RequestOptions = {}): Promise<EmszmalSession> {
    const jar = new CookieJar();
    const response = await this.#transport.request('/Common/SayHello', {}, jar, options);
    if (typeof response.SessionId !== 'string' || !response.SessionId.trim()) {
      throw new EmszmalError('INVALID_RESPONSE', 'emSzmal did not return a valid session identifier.');
    }
    const session = new EmszmalSession(this.#transport, jar, response.SessionId);
    // A body session id is not a replacement for the required HTTP cookie.
    if (!this.#transport.hasSessionCookie(jar)) {
      const error = new EmszmalError('INVALID_RESPONSE', 'emSzmal did not return a session cookie.');
      try { await session.close(); } catch (cleanup) { if (cleanup instanceof EmszmalError) error.cleanupError = cleanup; }
      throw error;
    }
    return session;
  }

  async withSession<T>(callback: (session: EmszmalSession) => Promise<T>, options: RequestOptions = {}): Promise<T> {
    const session = await this.openSession(options);
    let failed = false;
    let original: unknown;
    let result: T;
    try { result = await callback(session); }
    catch (error) { failed = true; original = error; }
    try { await session.close(); }
    catch (cleanup) {
      if (!failed) throw cleanup;
      if (original instanceof EmszmalError && cleanup instanceof EmszmalError) original.cleanupError = cleanup;
    }
    if (failed) throw original;
    return result!;
  }

  getAccounts(bank: BankCredentials, options: OperationOptions = {}): Promise<AccountsResponse> {
    const checked = credentials(bank);
    return this.#run((session, request) => session.getAccounts(checked, request), options);
  }

  getAccountHistory(bank: BankCredentials, query: HistoryQuery, options: OperationOptions = {}): Promise<HistoryResponse> {
    const checked = credentials(bank);
    historyQuery(query);
    const snapshot = { ...query };
    return this.#run((session, request) => session.getAccountHistory(checked, snapshot, request), options);
  }

  getAccountsHistory(bank: BankCredentials, query: AccountsHistoryQuery = {}, options: OperationOptions = {}): Promise<AccountsHistoryResponse> {
    const checked = credentials(bank);
    accountsHistoryQuery(query);
    const snapshot = { ...query, ...(query.accountNumbers ? { accountNumbers: [...query.accountNumbers] } : {}) };
    return this.#run((session, request) => session.getAccountsHistory(checked, snapshot, request), options);
  }

  #run<T>(operation: (session: EmszmalSession, options: RequestOptions) => Promise<T>, options: OperationOptions): Promise<T> {
    options = { ...options };
    if (options.onSecondPhase !== undefined && typeof options.onSecondPhase !== 'function') validation('onSecondPhase must be a function.');
    return this.withSession(async (session) => {
      const operationAbort = new AbortController();
      const signal = options.signal ? AbortSignal.any([operationAbort.signal, options.signal]) : operationAbort.signal;
      const authAbort = new AbortController();
      const authSignal = AbortSignal.any([signal, authAbort.signal]);
      const data = operation(session, { signal });
      let authError: EmszmalError | undefined;
      const authentication = options.onSecondPhase ? (async () => {
        try {
          const challenge = await session.getSecondPhaseAuthenticationData({ signal: authSignal });
          if (authSignal.aborted) return;
          const result = await abortable(Promise.resolve(options.onSecondPhase!(challenge, { signal: authSignal })), authSignal);
          if (challenge.AuthenticationMethod !== 'MOBILE_APP') {
            nonempty(result, 'authenticationCode');
            await session.doSecondPhaseAuthentication(result, { signal: authSignal });
          }
        } catch (error) {
          if (authSignal.aborted || (error instanceof EmszmalError && error.code === 'ABORTED')) return;
          authError = error instanceof EmszmalError ? error : new EmszmalError('AUTHENTICATION', 'The second-phase authentication callback failed.');
          operationAbort.abort();
        }
      })() : Promise.resolve();
      try { return await data; }
      catch (error) { throw authError ?? error; }
      finally { authAbort.abort(); await authentication; }
    }, options);
  }
}
