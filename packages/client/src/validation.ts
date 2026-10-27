import { EmszmalError, validation } from './errors.js';
import type { Account, AccountsHistoryQuery, BankCredentials, HistoryQuery, SecondPhaseChallenge, Transaction } from './types.js';

export function nonempty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) validation(`${field} must be a non-empty string.`);
}

export function duration(value: number, field: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) validation(`${field} is outside the supported timer range.`);
  return value;
}

export function credentials(value: BankCredentials): BankCredentials {
  if (!value || !Number.isSafeInteger(value.providerId) || value.providerId < 0) validation('providerId must be a non-negative integer.');
  nonempty(value.login, 'login');
  nonempty(value.password, 'password');
  for (const field of ['userContext', 'tokenValue', 'providerConfiguration'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') validation(`${field} must be a string.`);
  }
  if (value.proxy) {
    nonempty(value.proxy.host, 'proxy.host');
    if (!Number.isInteger(value.proxy.port) || value.proxy.port < 1 || value.proxy.port > 65535) validation('proxy.port must be between 1 and 65535.');
    for (const field of ['login', 'password'] as const) {
      if (value.proxy[field] !== undefined && typeof value.proxy[field] !== 'string') validation(`proxy.${field} must be a string.`);
    }
  }
  return { ...value, ...(value.proxy ? { proxy: { ...value.proxy } } : {}) };
}

function parseDate(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) validation('Dates must use YYYY-MM-DD format.');
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) validation('Invalid calendar date.');
  return timestamp;
}

function dateRange(since: string, to: string): void {
  const start = parseDate(since);
  const end = parseDate(to);
  if (start > end || end - start > 7 * 86_400_000) validation('The history range must be ordered and at most seven days.');
  // Calendar month, clamped at month end (March 31 -> February 28/29).
  const now = new Date();
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  const earliest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, Math.min(now.getUTCDate(), lastDay));
  if (start < earliest) validation('dateSince must not be older than one calendar month (UTC).');
}

export function historyQuery(query: HistoryQuery): Record<string, unknown> {
  if (!query) validation('A history query is required.');
  nonempty(query.accountNumber, 'accountNumber');
  dateRange(query.dateSince, query.dateTo);
  return { AccountNumber: query.accountNumber, DateSince: query.dateSince, DateTo: query.dateTo };
}

export function accountsHistoryQuery(query: AccountsHistoryQuery): Record<string, unknown> {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) validation('An accounts history query must be an object.');
  const data: Record<string, unknown> = {};
  if (query.accountNumbers !== undefined) {
    if (!Array.isArray(query.accountNumbers) || query.accountNumbers.length > 10) validation('At most ten account numbers may be requested.');
    query.accountNumbers.forEach((number) => nonempty(number, 'accountNumbers entry'));
    data.AccountNumbers = [...query.accountNumbers];
  }
  if ((query.dateSince === undefined) !== (query.dateTo === undefined)) validation('Supply both dateSince and dateTo or neither.');
  if (query.dateSince !== undefined && query.dateTo !== undefined) {
    dateRange(query.dateSince, query.dateTo);
    data.DateSince = query.dateSince;
    data.DateTo = query.dateTo;
  }
  return data;
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function responseObject(value: unknown): asserts value is Record<string, unknown> {
  if (!record(value)) throw new EmszmalError('INVALID_RESPONSE', 'Expected a JSON object from emSzmal.');
  // The public documentation does not specify an error schema. Recognize common
  // explicit envelopes; never guess errors from arbitrary Message fields alone.
  if (value.Success === false || (value.Error != null && value.Error !== false && value.Error !== '') || value.ExceptionMessage != null) {
    throw new EmszmalError('API', 'emSzmal returned an API error.');
  }
}

export function isAccount(value: unknown): value is Account {
  return record(value) && typeof value.AccountNumber === 'string' && typeof value.AccountCurrency === 'string'
    && typeof value.AccountAvailableFunds === 'number' && Number.isFinite(value.AccountAvailableFunds)
    && typeof value.AccountBalance === 'number' && Number.isFinite(value.AccountBalance);
}

export function isTransaction(value: unknown): value is Transaction {
  return record(value)
    && ['TransactionRefNumber', 'TransactionOperationDate', 'TransactionBookingDate', 'TransactionType', 'TransactionDescription'].every((key) => typeof value[key] === 'string')
    && typeof value.TransactionAmount === 'number' && Number.isFinite(value.TransactionAmount)
    && typeof value.TransactionBalance === 'number' && Number.isFinite(value.TransactionBalance);
}

export function isChallenge(value: Record<string, unknown>): value is SecondPhaseChallenge & Record<string, unknown> {
  return ['SMS', 'TOKEN', 'MOBILE_APP'].includes(value.AuthenticationMethod as string)
    && typeof value.PreAuthenticationCode === 'string' && typeof value.AuthenticationCodeHint === 'string';
}
