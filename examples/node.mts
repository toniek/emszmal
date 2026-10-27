import { EmszmalClient } from '@toniekw/emszmal-client';

const client = new EmszmalClient({
  license: { apiId: process.env.EMSZMAL_API_ID!, apiKey: process.env.EMSZMAL_API_KEY! },
  environment: 'test',
});

export async function readAccounts() {
  return client.getAccounts({
    providerId: Number(process.env.EMSZMAL_PROVIDER_ID),
    login: process.env.EMSZMAL_BANK_LOGIN!,
    password: process.env.EMSZMAL_BANK_PASSWORD!,
  });
}
