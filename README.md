# emSzmal libraries

Dwie biblioteki TypeScript do [emSzmal Banking API](https://web.emszmal.pl/BankingAPI):

| Pakiet | Przeznaczenie |
| --- | --- |
| [`@toniekw/emszmal-client`](packages/client/README.md) | Klient Node.js, sesje, rachunki, historia, dodatkowe uwierzytelnianie |
| [`@toniekw/nestjs-emszmal`](packages/nestjs/README.md) | Moduł NestJS, konfiguracja synchroniczna/asynchroniczna i DI |

Są to niezależne, nieoficjalne biblioteki na licencji MIT.

## Instalacja

```sh
npm install @toniekw/emszmal-client
# Dla aplikacji NestJS:
npm install @toniekw/nestjs-emszmal
```

Przykłady konfiguracji i użycia znajdują się w dokumentacji poszczególnych pakietów.

## Wymagania i instalacja deweloperska

- Node.js `^22.12.0 || ^24.0.0`.
- NestJS 11 lub 12 dla adaptera.
- TypeScript 5.9+ do używania dołączonych deklaracji.
- npm z obsługą workspaces; CI używa npm 11.

```sh
npm ci
npm run check
```

`check` sprawdza typy, lint, testy z pokryciem oraz instalację gotowych paczek.
Oba formaty modułów mają wspólną implementację CommonJS i fasadę ESM, więc klasy
i tokeny zachowują tożsamość przy mieszaniu `import` z `require`.

## Polecenia

| Polecenie | Działanie |
| --- | --- |
| `npm run build` | JavaScript, mapy źródeł i deklaracje obu pakietów |
| `npm run typecheck` | Kompilacja i sprawdzenie przykładów TypeScript |
| `npm run lint` | ESLint bez automatycznej modyfikacji plików |
| `npm test` | Testy wbudowanym runnerem Node.js, bez sieci |
| `npm run test:coverage` | Pokrycie kodu wynikowego; progi: 90% linii/funkcji, 85% gałęzi |
| `npm run test:packages` | `npm pack`, instalacja w katalogu tymczasowym, ESM/CJS, typy i Nest DI |
| `npm run test:live` | Test API tylko po jawnym włączeniu |

Testy paczek instalują zależności z npm w osobnym projekcie i mogą wymagać
dostępu do sieci. Archiwa trafiają do `.artifacts/`. Gdy dostępne są tylko już zainstalowane zależności, można użyć
`npm run test:packages -- --reuse-installed`. Ten wariant wymaga polecenia `tar`:
kopiuje wymagane zależności do osobnego projektu i rozpakowuje obie biblioteki
z archiwów, bez odwołań do ich kodu w workspace. Weryfikuje działanie artefaktów;
pełną instalację i rozwiązywanie zależności przez npm sprawdza wariant domyślny.

Przy `test:watch` po zmianie źródeł należy ponowić `npm run build`.

## Testy zewnętrznego API

Domyślnie żadne testy nie łączą się z emSzmal. Klucze z `test_klucze` są odczytywane
wyłącznie przez jawnie włączony skrypt testowy; biblioteki nie czytają plików ani
zmiennych środowiskowych samodzielnie.

```sh
EMSZMAL_LIVE=1 npm run test:live
```

To otwiera i zamyka sesję pod `https://web.emszmal.pl/apidev`. Nie loguje do banku.
Klucze można też podać przez `EMSZMAL_API_ID` i `EMSZMAL_API_KEY`, albo ustawić
`EMSZMAL_KEYS_FILE`. Obsługiwany format pliku:

```text
Id licencji:
<identyfikator>
Klucz licencji:
<klucz>
```

Aby dodatkowo pobrać rachunki, ustaw `EMSZMAL_LIVE_BANK=1`,
`EMSZMAL_PROVIDER_ID`, `EMSZMAL_BANK_LOGIN` i `EMSZMAL_BANK_PASSWORD` dla
**dostawcy testowego**. Identyfikatora dostawcy ani danych logowania nie zgadujemy.
Lista dostawców jest udostępniana przez operatora API.
Przy `EMSZMAL_LIVE_MFA=1` skrypt używa `EMSZMAL_AUTH_CODE` dla SMS/tokena lub czeka
na potwierdzenie w aplikacji mobilnej. Interaktywny przepływ kodów wygodniej obsłużyć
własnym callbackiem opisanym w README klienta.

Skrypt wypisuje status i liczbę rachunków, bez danych rachunków, ciasteczek i sekretów.
Testy jednostkowe korzystają wyłącznie z fikcyjnych danych. `.gitignore` oraz
lista `files` w paczkach chronią lokalne pliki konfiguracyjne przed dołączeniem.

GitHub Actions sprawdza Node.js 22/24 i NestJS 11/12. Testy live nie są częścią CI.

## Kontrakt i ograniczenia

Źródłem kontraktu jest oficjalna dokumentacja emSzmal, sprawdzona 2026-10-26.
Brak kompletnej specyfikacji błędów i zachowania
wszystkich dostawców oznacza, że testy offline potwierdzają implementowany kontrakt,
a nie zgodność każdego banku. Testy live wymagają osobnego uruchomienia.

Biblioteki nie implementują przelewów, przechowywania historii, cache rachunków,
automatycznych ponowień logowania ani kolejek zadań. Za persystencję i interfejs
użytkownika podczas uwierzytelniania odpowiada aplikacja korzystająca z klienta.
