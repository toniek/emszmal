import { CookieJar } from 'tough-cookie';
import { EmszmalError } from './errors.js';
import { delay, Transport } from './transport.js';
import type { AccountsHistoryQuery, AccountsHistoryResponse, AccountsResponse, BankCredentials, HistoryQuery, HistoryResponse, RequestOptions, SecondPhaseChallenge } from './types.js';
import { accountsHistoryQuery, credentials, historyQuery, isAccount, isChallenge, isTransaction, nonempty } from './validation.js';

function invalidResponse(): never {
  throw new EmszmalError('INVALID_RESPONSE', 'The emSzmal response does not match the expected data structure.');
}

/** One data request per session; second-phase calls run alongside that request. */
export class EmszmalSession {
  #transport: Transport;
  #jar: CookieJar;
  #id: string;
  #used = false;
  #closed = false;
  #pending = false;
  #startedAt = 0;
  #credentials: BankCredentials | undefined;
  #active = new AbortController();
  #closePromise: Promise<void> | undefined;
  #challenge: SecondPhaseChallenge | undefined;
  #challengePromise: Promise<SecondPhaseChallenge> | undefined;
  #submitted = false;

  /** @internal Obtain sessions through EmszmalClient.openSession(). */
  constructor(transport: Transport, jar: CookieJar, id: string) {
    this.#transport = transport;
    this.#jar = jar;
    this.#id = id;
  }

  async getAccounts(bank: BankCredentials, options: RequestOptions = {}): Promise<AccountsResponse> {
    const response = await this.#data('/Accounts/GetAccountsList', credentials(bank), undefined, options);
    if (!Array.isArray(response.Accounts) || !response.Accounts.every(isAccount)) invalidResponse();
    return { Accounts: response.Accounts };
  }

  async getAccountHistory(bank: BankCredentials, query: HistoryQuery, options: RequestOptions = {}): Promise<HistoryResponse> {
    const data = historyQuery(query);
    const response = await this.#data('/Accounts/GetAccountHistory', credentials(bank), data, options);
    if (!Array.isArray(response.Transactions) || !response.Transactions.every(isTransaction)) invalidResponse();
    return { Transactions: response.Transactions };
  }

  async getAccountsHistory(bank: BankCredentials, query: AccountsHistoryQuery = {}, options: RequestOptions = {}): Promise<AccountsHistoryResponse> {
    const data = accountsHistoryQuery(query);
    const response = await this.#data('/Accounts/GetAccountsHistory', credentials(bank), data, options);
    if (!Array.isArray(response.Accounts) || !response.Accounts.every(isAccount) || response.Accounts.length > 10
      || !Array.isArray(response.Transactions) || !response.Transactions.every((rows) => Array.isArray(rows) && rows.every(isTransaction))
      || response.Accounts.length !== response.Transactions.length) invalidResponse();
    return { Accounts: response.Accounts, Transactions: response.Transactions as AccountsHistoryResponse['Transactions'] };
  }

  /** Waits until at least secondPhaseDelayMs after the data request started. */
  async getSecondPhaseAuthenticationData(options: RequestOptions = {}): Promise<SecondPhaseChallenge> {
    this.#assertPending();
    if (this.#challengePromise) return this.#challengePromise;
    const signal = this.#signal(options);
    this.#challengePromise = (async () => {
      await delay(this.#transport.secondPhaseDelayMs - (Date.now() - this.#startedAt), signal);
      this.#assertPending();
      const response = await this.#transport.request('/SessionManager/GetSecondPhaseAuthenticationData', this.#bankBody(), this.#jar, { signal });
      if (!isChallenge(response)) invalidResponse();
      this.#challenge = {
        AuthenticationMethod: response.AuthenticationMethod,
        PreAuthenticationCode: response.PreAuthenticationCode,
        AuthenticationCodeHint: response.AuthenticationCodeHint,
      };
      return { ...this.#challenge };
    })();
    return this.#challengePromise;
  }

  async doSecondPhaseAuthentication(code: string, options: RequestOptions = {}): Promise<void> {
    this.#assertPending();
    nonempty(code, 'authenticationCode');
    if (!this.#challenge || this.#challenge.AuthenticationMethod === 'MOBILE_APP' || this.#submitted) {
      throw new EmszmalError('SESSION_STATE', 'A pending SMS or TOKEN challenge is required and may be submitted only once.');
    }
    this.#submitted = true;
    await this.#transport.request('/SessionManager/DoSecondPhaseAuthentication', { ...this.#bankBody(), AuthenticationCode: code }, this.#jar, { signal: this.#signal(options) });
  }

  /** Idempotent. Uses its own timeout, independent of the cancelled data request. */
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#active.abort();
    this.#closePromise = (async () => {
      try {
        await this.#transport.request('/Common/SayBye', { SessionId: this.#id }, this.#jar, {}, this.#transport.cleanupTimeoutMs);
      } finally {
        this.#jar.removeAllCookiesSync();
        this.#credentials = undefined;
        this.#challenge = undefined;
        this.#id = '';
      }
    })();
    return this.#closePromise;
  }

  #signal(options: RequestOptions): AbortSignal {
    return options.signal ? AbortSignal.any([this.#active.signal, options.signal]) : this.#active.signal;
  }

  #assertPending(): void {
    if (this.#closed || !this.#pending) throw new EmszmalError('SESSION_STATE', 'Second-phase authentication requires a pending data request.');
  }

  #bankBody(): Record<string, unknown> {
    const bank = this.#credentials!;
    return {
      SessionId: this.#id,
      ProviderId: bank.providerId,
      ProviderConfiguration: bank.providerConfiguration ?? '',
      Authentication: {
        UserLogin: bank.login, UserPassword: bank.password,
        UserContext: bank.userContext ?? '', TokenValue: bank.tokenValue ?? '',
      },
      ...(bank.proxy ? { Proxy: {
        Host: bank.proxy.host, Port: bank.proxy.port,
        Login: bank.proxy.login ?? '', Password: bank.proxy.password ?? '',
      } } : {}),
    };
  }

  async #data(endpoint: string, bank: BankCredentials, data: Record<string, unknown> | undefined, options: RequestOptions): Promise<Record<string, unknown>> {
    if (this.#closed || this.#used) throw new EmszmalError('SESSION_STATE', 'A session permits only one data request.');
    this.#used = true;
    this.#pending = true;
    this.#credentials = bank;
    this.#startedAt = Date.now();
    try {
      return await this.#transport.request(endpoint, { ...this.#bankBody(), ...(data ? { Data: data } : {}) }, this.#jar, { signal: this.#signal(options) });
    } finally {
      this.#pending = false;
      this.#active.abort();
    }
  }
}
