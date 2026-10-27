export const license = { apiId: 'test-license', apiKey: 'test-secret-key' };
export const bank = { providerId: 0, login: 'fixture-login', password: 'fixture-password' };
export const account = { AccountNumber: '000123', AccountCurrency: 'PLN', AccountAvailableFunds: 12.5, AccountBalance: 15.25 };
export const transaction = {
  TransactionRefNumber: '00042', TransactionOperationDate: '2026-10-20T00:00:00',
  TransactionBookingDate: '2026-10-21T00:00:00', TransactionAmount: -2.75,
  TransactionBalance: 15.25, TransactionType: 'TRANSFER', TransactionDescription: 'Fixture',
};

export function json(body, headers = {}) {
  const result = new Headers(headers);
  result.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { headers: result });
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function mockApi(handler = () => undefined) {
  const calls = [];
  let counter = 0;
  const fetch = async (url, init) => {
    const call = { path: new URL(url).pathname.replace(/^\/api/, ''), url, ...init, body: JSON.parse(init.body) };
    calls.push(call);
    const custom = await handler(call, calls);
    if (custom !== undefined) return custom;
    switch (call.path) {
      case '/Common/SayHello': {
        const id = `session-${++counter}`;
        return json({ SessionId: id }, { 'Set-Cookie': `session=${id}; Path=/; HttpOnly; Secure` });
      }
      case '/Common/SayBye': return json({});
      case '/Accounts/GetAccountsList': return json({ Accounts: [account] });
      case '/Accounts/GetAccountHistory': return json({ Transactions: [transaction] });
      case '/Accounts/GetAccountsHistory': return json({ Accounts: [account], Transactions: [[transaction]] });
      default: throw new Error(`Unexpected fixture endpoint: ${call.path}`);
    }
  };
  return { calls, fetch, options: { license, baseUrl: 'https://fixture.example/api', fetch } };
}

export function recentRange() {
  const today = new Date();
  return { dateSince: new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10), dateTo: today.toISOString().slice(0, 10) };
}
