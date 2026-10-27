# @toniekw/emszmal-client

Nieoficjalny, typowany klient [emSzmal Banking API](https://web.emszmal.pl/BankingAPI)
dla Node.js `^22.12.0 || ^24.0.0`. ESM i CommonJS, deklaracje TypeScript, licencja MIT.

## Instalacja i użycie

```sh
npm install @toniekw/emszmal-client
```

```ts
import { EmszmalClient } from '@toniekw/emszmal-client';

const client = new EmszmalClient({
  license: { apiId: process.env.EMSZMAL_API_ID!, apiKey: process.env.EMSZMAL_API_KEY! },
  environment: 'test',
});

const bank = {
  providerId: Number(process.env.EMSZMAL_PROVIDER_ID),
  login: process.env.EMSZMAL_BANK_LOGIN!,
  password: process.env.EMSZMAL_BANK_PASSWORD!,
};

const { Accounts } = await client.getAccounts(bank);
```

CommonJS: `const { EmszmalClient } = require('@toniekw/emszmal-client')`.
Każda operacja klienta otwiera osobną sesję, przekazuje ciasteczka i próbuje zamknąć
sesję po zakończeniu, również po błędzie. Instancję klienta można współdzielić.

## Publiczne metody

| Metoda | Wynik |
| --- | --- |
| `getAccounts(bank, options?)` | `{ Accounts: Account[] }` |
| `getAccountHistory(bank, query, options?)` | `{ Transactions: Transaction[] }` |
| `getAccountsHistory(bank, query?, options?)` | `{ Accounts: Account[], Transactions: Transaction[][] }` |
| `openSession(options?)` | Ręcznie zarządzana `EmszmalSession` |
| `withSession(callback, options?)` | Wynik callbacka, z automatycznym zamknięciem sesji |

Historia jednego rachunku wymaga `accountNumber`, `dateSince` i `dateTo`.
Historia wielu rachunków przyjmuje opcjonalne `accountNumbers` oraz obie daty albo
żadnej. Bez dat zakres ustala serwer. Przekazanie więcej niż dziesięciu numerów
jest błędem, zamiast cichego ucinania wyniku.

Daty są ciągami `YYYY-MM-DD`: początek nie może być starszy niż jeden miesiąc
kalendarzowy względem daty UTC, a różnica między datami nie może przekroczyć siedmiu
dni. Przy końcu miesiąca granica jest przycinana do ostatniego dnia poprzedniego
miesiąca. Biblioteka nie dzieli automatycznie dłuższych zakresów na sesje.

Odpowiedzi zachowują nazwy pól API. Numery rachunków i referencje są ciągami znaków,
daty pozostają ciągami bez narzucania strefy czasowej, kwoty są liczbami JSON.
Do obliczeń finansowych aplikacja powinna użyć własnej reprezentacji dziesiętnej.
W historii wielu rachunków `Transactions[i]` odpowiada `Accounts[i]`.
Nieprawidłowe struktury odpowiedzi są odrzucane.

## Konfiguracja

| Pole | Domyślnie / znaczenie |
| --- | --- |
| `license` | Wymagane `{ apiId, apiKey }` |
| `environment` | `production`; `test` wybiera `/apidev` |
| `baseUrl` | Nadpisuje środowisko; HTTPS, wyjątek HTTP dla loopback |
| `requestTimeoutMs` | `120000`, limit pojedynczego żądania wraz z odczytem odpowiedzi |
| `cleanupTimeoutMs` | `10000`, niezależny limit zamknięcia sesji |
| `secondPhaseDelayMs` | `10000`, minimalna dozwolona wartość także `10000` |
| `fetch` | Wbudowany `fetch`; można podać własny zgodny transport |

`BankCredentials` obejmuje `providerId`, `login`, `password` oraz opcjonalne
`userContext`, `tokenValue`, `providerConfiguration` i `proxy`.
`proxy: { host, port, login?, password? }` jest przekazywane do emSzmal jako
konfiguracja połączenia z bankiem. Nie jest to ustawienie lokalnego klienta HTTP.
Nie ma wbudowanej, potencjalnie nieaktualnej listy identyfikatorów banków.

Konfiguracja i dane wejściowe są kopiowane. Biblioteka nie odczytuje środowiska,
plików z kluczami ani globalnej konfiguracji aplikacji. Nie loguje żądań.

## Dodatkowe uwierzytelnianie

Dla banku wymagającego dodatkowej autoryzacji podaj `onSecondPhase`:

```ts
const result = await client.getAccounts(bank, {
  signal: AbortSignal.timeout(180_000),
  onSecondPhase: async (challenge, { signal }) => {
    if (challenge.AuthenticationMethod === 'MOBILE_APP') {
      // Powiadom użytkownika, aby potwierdził logowanie w aplikacji banku.
      // Nie wysyłaj kodu: oczekujące żądanie danych zakończy się po potwierdzeniu.
      return;
    }
    // Implementacja w aplikacji: SMS lub odpowiedź tokena.
    return askUserForCode(challenge.AuthenticationCodeHint, challenge.PreAuthenticationCode, signal);
  },
});
```

`askUserForCode` reprezentuje funkcję aplikacji, nie eksport biblioteki. Callback
otrzymuje `AbortSignal` i powinien zakończyć własne oczekiwanie, gdy zostanie anulowany.

Żądanie danych jest już w toku, gdy klient po minimum dziesięciu sekundach pobiera
wyzwanie. SMS/token są przesyłane jeden raz. Jeśli dane przyjdą wcześniej, klient
anuluje oczekiwanie na autoryzację. Błąd callbacka przerywa operację i uruchamia
zamknięcie sesji. Brak callbacka oznacza brak dodatkowych wywołań autoryzacyjnych.
Nie ma automatycznych ponowień ani odpytywania nieudokumentowanych stanów.

## Ręczne sesje

```ts
const session = await client.openSession();
try {
  const result = await session.getAccounts(bank);
} finally {
  await session.close();
}
```

Sesja umożliwia tylko jedną próbę pobrania danych. Jej metody pobierające odpowiadają
metodom klienta i przyjmują `{ signal? }`, bez automatycznego callbacka MFA.
`getSecondPhaseAuthenticationData()` oraz `doSecondPhaseAuthentication(code)` działają
wyłącznie podczas oczekiwania na rozpoczęte żądanie danych. Pierwsza z nich sama
odczekuje wymagany czas. `close()` jest idempotentne i przerywa aktywne oczekiwanie.
Do typowej obsługi MFA zalecane są metody klienta z callbackiem.

## Błędy i anulowanie

```ts
import { EmszmalError } from '@toniekw/emszmal-client';

try {
  await client.getAccounts(bank);
} catch (error) {
  if (error instanceof EmszmalError) {
    // Bezpieczne metadane, bez treści odpowiedzi i danych logowania.
    console.error(error.code, error.status, error.cleanupError?.code);
  } else {
    throw error;
  }
}
```

Kody: `VALIDATION`, `SESSION_STATE`, `TRANSPORT`, `HTTP`, `API`,
`INVALID_RESPONSE`, `TIMEOUT`, `ABORTED`, `AUTHENTICATION`.
Walidacja argumentów metod klienta może rzucić błąd synchronicznie, przed wysłaniem żądania.
Dokumentacja serwera nie definiuje pełnego formatu błędów; rozpoznawane są jawne
koperty `Error`, `Success: false` i `ExceptionMessage`. Inne niezgodne odpowiedzi
otrzymują `INVALID_RESPONSE`, a nie zgadywany kod banku.

Jeśli operacja i zamknięcie zawiodą, zachowany zostaje błąd operacji, a błąd zamknięcia
znajduje się w `cleanupError`. Po udanej operacji błąd zamknięcia jest zgłaszany.
`withSession` zachowuje także własne wyjątki callbacka, ale `cleanupError` dołącza
wyłącznie do `EmszmalError`.

Po anulowaniu klient nadal próbuje zamknąć sesję w osobnym limicie czasu. Nie gwarantuje
to przerwania pracy banku po stronie serwera. Błędne logowanie może blokować licencję,
dlatego klient nie ponawia automatycznie operacji.
