/** Credentials for the emSzmal service, not credentials for a bank. */
export interface License {
  apiId: string;
  apiKey: string;
}

export interface BankCredentials {
  providerId: number;
  login: string;
  password: string;
  userContext?: string;
  tokenValue?: string;
  providerConfiguration?: string;
  /** Proxy used by emSzmal to connect to the bank (not a local HTTP proxy). */
  proxy?: { host: string; port: number; login?: string; password?: string };
}

export interface ClientOptions {
  license: License;
  environment?: 'production' | 'test';
  /** Overrides environment. HTTPS is required except for loopback test servers. */
  baseUrl?: string;
  /** Per HTTP request, including response body. Default: 120000 ms. */
  requestTimeoutMs?: number;
  /** Separate budget for closing a session, even after cancellation. Default: 10000 ms. */
  cleanupTimeoutMs?: number;
  /** Minimum 10000 ms from starting the data request. */
  secondPhaseDelayMs?: number;
  /** Injectable for testing or a custom transport. Must honor AbortSignal. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface OperationOptions extends RequestOptions {
  /** Opt in for a bank that needs second-phase authentication. */
  onSecondPhase?: (
    challenge: SecondPhaseChallenge,
    context: { signal: AbortSignal },
  ) => string | void | Promise<string | void>;
}

export interface HistoryQuery {
  accountNumber: string;
  /** Calendar dates in YYYY-MM-DD format, without a timezone conversion. */
  dateSince: string;
  dateTo: string;
}

export interface AccountsHistoryQuery {
  accountNumbers?: readonly string[];
  /** Supply both dates or neither (server defaults to the last seven days). */
  dateSince?: string;
  dateTo?: string;
}

/** Wire responses retain the official API field names and numeric money values. */
export interface Account {
  AccountNumber: string;
  AccountCurrency: string;
  AccountAvailableFunds: number;
  AccountBalance: number;
}

export interface Transaction {
  TransactionRefNumber: string;
  TransactionOperationDate: string;
  TransactionBookingDate: string;
  TransactionAmount: number;
  TransactionBalance: number;
  TransactionType: string;
  TransactionDescription: string;
}

export interface AccountsResponse { Accounts: Account[] }
export interface HistoryResponse { Transactions: Transaction[] }
/** Transactions[i] belongs to Accounts[i]; no flattening or silent truncation. */
export interface AccountsHistoryResponse extends AccountsResponse { Transactions: Transaction[][] }

export interface SecondPhaseChallenge {
  AuthenticationMethod: 'SMS' | 'TOKEN' | 'MOBILE_APP';
  PreAuthenticationCode: string;
  AuthenticationCodeHint: string;
}
