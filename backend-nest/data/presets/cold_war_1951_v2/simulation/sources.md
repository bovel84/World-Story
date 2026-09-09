# Fonti del catalogo `cold_war_1951_v2` (pilota storico con stime dichiarate)

Dichiarazione del catalogo: `historical_estimated` in `mode: strict` — storico
rigoroso con stime e conversioni dichiarate. **Nessun dato fabbricato**: dove
la fonte non è stata raggiunta, il dato è `unknown` o è escluso dal catalogo.

> **µ2-bis (contratto multi-valuta):** il manifest dichiara ora l'insieme
> `currencies` (USD, SUR); ogni treasury deve usare una valuta dichiarata.
> Il campo `currency` resta la valuta di conto primaria. Contratto
> retrocompatibile: senza `currencies` vale solo `currency` (comportamento µ1).
> La modifica del contratto del loader è **segnalata per revisione
> indipendente** (revisore ≠ implementatore).

## produzione-energetica-usa-1951

Produzione annua USA 1951 (fonte verificata il 2026-09-08):

| Risorsa | Valore fonte | Unità fonte | Base catalogo |
|---|---|---|---|
| Carbone | 3.938,8542 | TWh/anno | 3.938.854 GWh/anno (arrotondato all'unità) |
| Petrolio greggio | 3.532,659 | TWh/anno | 3.532.659 GWh/anno (arrotondato all'unità) |

Fonte primaria: **Energy Institute — Statistical Review of World Energy (2026)**,
serie storica elaborata da **Our World in Data**
(`https://ourworldindata.org/grapher/coal-production-by-country` e
`https://ourworldindata.org/grapher/oil-production-by-country`, righe
`United States,USA,1951`). Provenienza della serie secondo i metadati OWID:
Energy Institute Statistical Review (dal 1965), estesa al periodo pre-1965 con
**Etemad & Luciani (1991)** e completata con **U.S. Energy Information
Administration**.

**Conversione dichiarata** (`methodVersion` delle ricette): la produzione
annuale è trasformata in capacità giornaliera con `round(annuale / 365)`:
carbone `3938854 / 365 → 10791 GWh/giorno`, greggio `3532659 / 365 →
9678 GWh/giorno`. La capacità resta distinta dalle quantità (§4.1.7) e non
viene mai sommata ai magazzini.

Limite dichiarato del metodo: il dato OWID/EIA pre-1965 è una **stima
storica** (Etemad & Luciani), non una statistica ufficiale dell'epoca; la
unità è energetica (TWh), non fisica (t). Entrambe le limitazioni sono
parte della dichiarazione `historical_estimated`.

## produzione-energetica-urss-1951

Produzione annua URSS 1951 (fonte identica alla serie USA, verificata il
2026-09-08):

| Risorsa | Valore fonte | Unità fonte | Base catalogo |
|---|---|---|---|
| Carbone | 1.606,4044 | TWh/anno | 1.606.404 GWh/anno (arrotondato all'unità) |
| Petrolio greggio | 491,40237 | TWh/anno | 491.402 GWh/anno (arrotondato all'unità) |

Righe `USSR,OWID_USS,1951` di
`https://ourworldindata.org/grapher/coal-production-by-country` e
`https://ourworldindata.org/grapher/oil-production-by-country` (Energy
Institute — Statistical Review of World Energy 2026; periodo pre-1965:
Etemad & Luciani 1991; complemento EIA).

**Conversione dichiarata** (`methodVersion` delle ricette URSS):
`round(annuale / 365)`: carbone `1606404 / 365 → 4401 GWh/giorno`, greggio
`491402 / 365 → 1346 GWh/giorno`. Stesse limitazioni della serie USA
(stima storica pre-1965, unità energetica non fisica). La produzione URSS è
attribuita all'industria di stato AGGREGATA (`ussr_state_industry`), design
dichiarato.

## censimento-1950

Popolazione USA al censimento del **1950: 151.325.798 residenti** (U.S.
Census Bureau; riga `1950` della tabella storica di
https://en.wikipedia.org/wiki/Demographic_history_of_the_United_States).
Usata come pool `wf_usa_residents` al `1951-01-01` **dichiarandola proxy**:
non esiste un censimento 1951; il dato è della primavera 1950 e non è
aggiustato (nessun tasso di crescita inventato).

## popolazione-urss-1951

**Popolazione media annuale URSS 1951: 181.582.000** («Average population
(thousand)», riga `1951 181,582` della tabella demografica sovietica 1950–1991
in https://en.wikipedia.org/wiki/Demographics_of_the_Soviet_Union, dati
Goskomstat/Demoscope). Usata come pool `wf_ussr_residents` al `1951-01-01`
**dichiarandola proxy** (media annuale, non stima al 1° gennaio; nessun
aggiustamento inventato).

## istituzioni

Attori economici reali esistenti al 1951 (riferimenti enciclopedici standard,
Wikipedia/Britannica — verifica del 2026-09-08):

- **Dipartimento del Tesoro USA** (1789) — attore `treasury`.
- **Tennessee Valley Authority** (1933) — impresa pubblica federale nel
  settore energetico, attore `public_enterprise`.
- **Federal Reserve System** (1913) — attore `bank`.
- **Pennsylvania Railroad** — la più grande compagnia ferroviaria USA ancora
  indipendente nel 1951, attore `carrier`.
- **Industrie carbonifera e petrolifera private (aggregati)** e
  **famiglie (aggregato)** — attori `private_sector`/`household` AGGREGATI
  per design: il pilota non assegna i volumi di produzione 1951 a imprese
  individuali (quote di mercato non verificate); l'aggregazione è dichiarata
  nei nomi degli attori.

- **Famiglie statunitensi (aggregato)** — attore `household`.

Istituzioni sovietiche esistenti nel 1951 (riferimenti enciclopedici
standard, Wikipedia/Britannica — verifica del 2026-09-08):

- **Ministero delle Finanze dell'URSS** — attore `treasury`; la tesoreria
  sovietica opera in **rubli (SUR), sottomultiplo kopeck** (1 rublo = 100
  kopeck, definizione monetaria dell'epoca).
- **Gosbank** (Banca di Stato dell'URSS, nome in uso dal 1923) — attore `bank`.
- **Ministero delle Ferrovie dell'URSS (MPS)** — attore `carrier`.
- **Industria di stato sovietica (aggregato)** e **famiglie sovietiche
  (aggregato)** — aggregazioni dichiarate, come per gli USA: le quote
  produttive per ministero/direzione generale non sono verificate.

La matrice di autorità sovietica (`auth_ussr_*`) è **disegno istituzionale**
dichiarato (maestro §4.3.1): stanziamento del Tesoro e produzione di stato
richiedono il consenso istituzionale (pianificazione centrale; non esiste
produzione privata sovietica da vincolare al consenso della controparte).

Tecnologie con data verificata:

- **rotary_oil_drilling** `validFrom 1901-01-10`: il gusher di Spindletop
  («On January 10, 1901, a well at Spindletop struck oil»,
  https://en.wikipedia.org/wiki/Spindletop) apre il boom petrolifero texano.
- **thermal_cracking** `validFrom 1908-06-08`: brevetto Burton–Humphreys
  (U.S. patent 1,049,667, 8 giugno 1908,
  https://en.wikipedia.org/wiki/Cracking_(chemistry)).

La matrice di autorità R1 (`authorities.json`) è **disegno istituzionale**
(maestro §4.3.1), non dato storico: tre consensi separati — stanziamenti del
Tesoro con consenso utente + istituzionale, debito pubblico con consenso
istituzionale (potere Congressuale di autorizzare il debito), produzione
privata con consenso della controparte (il settore privato non è magazzino
del governo).

## dati-non-inclusi

Dati NON presenti nel pilota perché **nessuna fonte verificabile è stata
raggiunta in questa µ** (mai fabbricare, MAT02):

1. **Acciaio, minerale di ferro, grano** — serie 1951 non raggiunte da fonti
   citabili in questa sessione (AISI/UN Statistical Yearbook/FAOSTAT non
   accessibili). Le risorse NON sono definite nel catalogo per non aprire
   filiere non giustificabili (§4.4).
2. **Riserve minerarie 1951** — i depositi `dep_usa_coal` e `dep_usa_oil`
   hanno `known: null` senza stima: ignoranza dichiarata (warning
   `unknown_quantity` atteso dal validatore), non assenza dei giacimenti.
3. **Saldo di cassa del Tesoro al 1951** — non raggiunto: `balanceMinorUnits:
   "0"` è un ancoraggio di modellizzazione dichiarato, NON un dato storico
   (la finanza operativa è M02: ledger, flussi, ratei).
4. **URSS — RISOLTA in µ2-bis:** il vincolo una-valuta-per-catalogo è stato
   superato dal nuovo contratto `manifest.currencies` (retrocompatibile);
   l'URSS è nel pilota con tesoreria in rubli, produzione energetica 1951 e
   popolazione media annuale. Restano `unknown` per l'URSS: riserve
   minerarie, saldo di cassa 1951, quote per ministero.
5. **Quote regionali e per-impresa** (regionId è l'aggregato `USA`) — le
   statistiche regionali/aziendali 1951 non sono state verificate in questa µ.

**Il gate di realismo storico resta CHIUSO**: il pilota non è completo e non
è approvato; la chiusura richiede fonti per acciaio/ferro/grano, riserve
minerarie, saldo di cassa 1951 per entrambe le polity, quote
regionali/per-impresa, e revisione indipendente delle fonti (revisore ≠
implementatore). Il vincolo multi-valuta è superato in µ2-bis.
