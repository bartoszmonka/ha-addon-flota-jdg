# Flota JDG – dodatek do Home Assistanta

Ewidencja przebiegu pojazdu dla VAT (VAT-26) z integracją Home Assistant. Dodatek (ingress): serwer Express + baza SQLite +
interfejs React w jednym kontenerze.

## Instalacja
1. Home Assistant → Ustawienia → Dodatki → Sklep → ⋮ → Repozytoria → dodaj `https://github.com/bartoszmonka/ha-addon-flota-jdg`.
2. Zainstaluj **Flota JDG**, włącz „Pokaż w pasku bocznym”.

## Jak to działa
- Użytkownik pochodzi z nagłówków ingress (`X-Remote-User-*`); zaufane tylko z bramki ingress `172.30.32.2`.
- Dane aut: `http://supervisor/core/api/states` z `SUPERVISOR_TOKEN` (`homeassistant_api: true`) – tylko odczyt.
- Dane: `/data` dodatku (SQLite), objęte kopią zapasową HA.

## Wydawanie wersji
Zmiana kodu → podbij `version` w `flota_jdg/config.yaml` (i wpis w `CHANGELOG.md`) → merge do `main`.
GitHub Actions buduje obraz `ghcr.io/bartoszmonka/ha-addon-flota-jdg:<version>`, a HA pokaże aktualizację.

## Rozwój lokalny
`npm run dev:server` (API, tryb testowy: `AUTH_MODE=dev`) i `npm run dev` (interfejs). `npm run lint` – typy.
Tryb dodatku lokalnie: `SUPERVISOR_TOKEN=x INGRESS_IPS=127.0.0.1 DATA_DIR=./data PORT=3055 npm start`
oraz żądania z nagłówkiem `X-Remote-User-ID`.
