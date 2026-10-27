# @toniekw/nestjs-emszmal

Moduł NestJS 11/12 dla [`@toniekw/emszmal-client`](https://www.npmjs.com/package/@toniekw/emszmal-client).
Node.js `^22.12.0 || ^24.0.0`, ESM i CommonJS, typy TypeScript, licencja MIT.

```sh
npm install @toniekw/nestjs-emszmal
```

Klient jest zależnością adaptera. Aplikacja dostarcza zgodne `@nestjs/common`,
`@nestjs/core`, `reflect-metadata` oraz `rxjs` jako peer dependencies.

## Konfiguracja synchroniczna

```ts
import { Module } from '@nestjs/common';
import { EmszmalModule } from '@toniekw/nestjs-emszmal';

@Module({
  imports: [EmszmalModule.forRoot({
    license: { apiId: process.env.EMSZMAL_API_ID!, apiKey: process.env.EMSZMAL_API_KEY! },
    environment: 'test',
    requestTimeoutMs: 120_000,
  })],
})
export class BankingModule {}
```

## Konfiguracja asynchroniczna

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';

EmszmalModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => ({
    license: {
      apiId: config.getOrThrow<string>('EMSZMAL_API_ID'),
      apiKey: config.getOrThrow<string>('EMSZMAL_API_KEY'),
    },
    environment: 'test',
  }),
});
```

`@nestjs/config` jest opcjonalnym wyborem aplikacji; adapter od niego nie zależy.
Fabryka może otrzymywać dowolne providery z importowanych modułów i zwrócić
`ClientOptions` albo `Promise<ClientOptions>`. Niepoprawna konfiguracja przerywa
tworzenie modułu przed wykonaniem żądań HTTP.

## Wstrzykiwanie klienta

```ts
import { Injectable } from '@nestjs/common';
import { EmszmalClient, InjectEmszmalClient } from '@toniekw/nestjs-emszmal';
import type { BankCredentials } from '@toniekw/emszmal-client';

@Injectable()
export class BankingService {
  constructor(@InjectEmszmalClient() private readonly client: EmszmalClient) {}

  getAccounts(bank: BankCredentials) {
    return this.client.getAccounts(bank);
  }
}
```

Można też użyć `@Inject(EMSZMAL_CLIENT)` albo tokena klasy `EmszmalClient`.
Wszystkie wskazują ten sam klient. Dekorator z jawnym tokenem działa również
przy kompilatorach, które nie emitują metadanych typów konstruktorów.

Domyślnie moduł nie jest globalny. `isGlobal: true` w `forRoot` lub `forRootAsync`
udostępnia go pozostałym modułom. Rejestruj jedną konfigurację w danym zakresie DI;
adapter nie implementuje nazwanych klientów. Osobne konteksty Nest mają osobne
instancje klienta, a każda operacja klienta ma odrębną sesję.

W testach aplikacji można podmienić provider przez
`overrideProvider(EMSZMAL_CLIENT).useValue(fakeClient)`.

Sesje, anulowanie, dodatkowe uwierzytelnianie oraz błędy są obsługiwane przez klienta.
Adapter nie mapuje ich na `HttpException`, nie dodaje kontrolerów, nie otwiera sesji
podczas startu NestJS i nie przechowuje danych bankowych. Przy ręcznie otwartej sesji
aplikacja odpowiada za `close()`; preferuj automatyczne metody klienta.
