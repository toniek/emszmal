import { Injectable, Module } from '@nestjs/common';
import { EmszmalClient, EmszmalModule, InjectEmszmalClient } from '@toniekw/nestjs-emszmal';
import type { BankCredentials } from '@toniekw/emszmal-client';

@Injectable()
export class BankingService {
  constructor(@InjectEmszmalClient() private readonly client: EmszmalClient) {}

  accounts(credentials: BankCredentials) { return this.client.getAccounts(credentials); }
}

@Module({
  imports: [EmszmalModule.forRootAsync({
    useFactory: async () => ({
      license: { apiId: process.env.EMSZMAL_API_ID!, apiKey: process.env.EMSZMAL_API_KEY! },
      environment: 'test',
    }),
  })],
  providers: [BankingService],
})
export class BankingModule {}
