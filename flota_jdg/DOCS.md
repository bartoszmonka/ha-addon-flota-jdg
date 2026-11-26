# Flota JDG

Ewidencja przebiegu pojazdu dla VAT (VAT-26). Dodatek działa przez ingress – otwierasz go z panelu bocznego Home Assistanta,
bez osobnego logowania (dane należą do zalogowanego użytkownika HA).

## Opcje

| Opcja | Opis |
|---|---|
| `ha_vehicle_prefixes` | Prefiksy aut z HA widocznych w aplikacji, po przecinku (np. `audi`). Puste = wszystkie znalezione. |

Auta w HA są rozpoznawane po encjach `input_text.<prefiks>_numer_rejestracyjny` oraz `sensor.<prefiks>_*_mileage`
(przebieg), `input_datetime.<prefiks>_przeglad_techniczny_do`, `_ubezpieczenie_do`, `_nastepny_serwis_aso`.

## Dane i kopie zapasowe

Baza (SQLite) i załączniki leżą w katalogu danych dodatku i wchodzą do kopii zapasowych Home Assistanta.
Dodatkowo w aplikacji: Ustawienia → eksport kopii JSON.
