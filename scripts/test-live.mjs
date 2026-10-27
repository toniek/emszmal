import { EmszmalClient, EmszmalError } from '../packages/client/dist/index.js';
import { loadLicense } from './live-config.mjs';

if (process.env.EMSZMAL_LIVE !== '1') {
  console.log('Skipped live API tests. Set EMSZMAL_LIVE=1 to explicitly enable the emSzmal test environment.');
} else {
  try {
    const client = new EmszmalClient({ license: loadLicense(), environment: 'test' });
    await client.withSession(async () => {});
    console.log('Test API: session opened and closed.');
    if (process.env.EMSZMAL_LIVE_BANK === '1') {
      const { EMSZMAL_PROVIDER_ID, EMSZMAL_BANK_LOGIN, EMSZMAL_BANK_PASSWORD, EMSZMAL_AUTH_CODE } = process.env;
      if (!EMSZMAL_PROVIDER_ID || !EMSZMAL_BANK_LOGIN || !EMSZMAL_BANK_PASSWORD) throw new Error('Explicit test-bank credentials and provider id are required.');
      const result = await client.getAccounts({ providerId: Number(EMSZMAL_PROVIDER_ID), login: EMSZMAL_BANK_LOGIN, password: EMSZMAL_BANK_PASSWORD },
        process.env.EMSZMAL_LIVE_MFA === '1' ? { onSecondPhase: (challenge) => {
          if (challenge.AuthenticationMethod === 'MOBILE_APP') {
            console.log('Confirm the test-bank login in the mobile app.');
            return;
          }
          if (!EMSZMAL_AUTH_CODE) throw new Error('An authentication code is required.');
          return EMSZMAL_AUTH_CODE;
        } } : {});
      console.log(`Test API: received ${result.Accounts.length} accounts. Account details are not logged.`);
    }
  } catch (error) {
    console.error(error instanceof EmszmalError ? `Live test failed: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''}.` : 'Live test failed. Check the local license file and required environment variables.');
    process.exitCode = 1;
  }
}
