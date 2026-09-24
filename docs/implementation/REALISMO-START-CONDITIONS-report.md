# REALISMO START CONDITIONS — debito ereditato e scala storica

**Data:** 2026-09-24
**Branch:** `fix/realismo-debito-ereditato-e-scala-storica`
**Commit:** `8a43ace`
**Analisi di riferimento:** [`docs/ANALISI_REALISMO_SIMULAZIONE_2026-09-24.md`](../ANALISI_REALISMO_SIMULAZIONE_2026-09-24.md)

---

## Perché questa patch

Due difetti di realismo misurati sul motore, entrambi verificabili senza LLM e
senza partita: il debito pubblico con cui una nazione nasce e la scala economica
delle epoche storiche. Nessuno dei due era coperto da test, ed entrambi
alteravano l'esperienza dal primo turno.

### 1. Cinque grandi nazioni in default sovrano dopo tre mesi

`seedInheritedDebt` (`MaterialEconomy.ts`) emetteva il debito pubblico ereditato
come titoli valorizzati al **tasso di mercato corrente**, premio di rischio
incluso, applicato a tutto lo stock. Uno stock di debito pubblico non è emesso al
prezzo di oggi: è un portafoglio costruito in decenni, con una vita media di 7-10
anni, e solo la quota che arriva a scadenza si rifinanzia al prezzo corrente.

Misurato eseguendo `assessCrisis` con i dati reali del registro:

| Paese | Debito % PIL | Tasso applicato | Interessi % PIL | Servizio % entrate |
|---|---|---|---|---|
| JPN | 214,5 | 12,8% | 27,5% | **275%** |
| SGP | 166,0 | 10,4% | 17,3% | **173%** |
| GRC | 155,4 | 9,9% | 15,4% | **154%** |
| ITA | 134,7 | 8,4% | 11,3% | **113%** |
| USA | 122,3 | 7,4% | 9,1% | **91%** |

Tutte e cinque risultavano già in criticità `critical`. Simulando
`advanceCrisis` con tick da 45 giorni, **tutte e cinque andavano in default
sovrano dopo 90 giorni di gioco senza che il giocatore facesse nulla**. La
pressione fiscale necessaria per sopravvivere andava dal 13% (USA) al 28% (JPN)
del PIL, senza alcun indizio che quella fosse la leva.

### 2. La modalità storica copriva due anni su due secoli

`HISTORICAL_GDP_BY_YEAR` conteneva solo `1939` e `1951`, e `historicalGdpYear`
sceglie l'anno più vicino. Conseguenze misurate:

| Preset | Anno | Riga applicata | Esito |
|---|---|---|---|
| europa_1815 | 1815 | **1939** | GBR «del 1815» a 27 mld del 1939 |
| europa_1914 | 1914 | **1939** | plausibile per le 21 curate, no per le altre |
| mondo_1989 | 1989 | **1951** | USA 346 mld invece di ~5.660 (**0,06×**) |
| millennium_dawn | 2000 | fatti **2024** | Cina 18.730 invece di ~1.211 (**15,5×**) |

La soglia `hasModernReferenceFacts` (`year >= 1990`) non era il problema:
**mancavano le righe della tabella**.

---

## Cosa cambia

### `SovereignDebt.ts` — tasso effettivo di carry

Nuova `inheritedCarryRatePct(debtRatioPct)`: cedola media storica
(`INHERITED_LEGACY_COUPON_PCT = 1`) più il contributo della **sola quota che si
rifinanzia** (`INHERITED_REFINANCE_SHARE = 0,1`) al premio di rischio corrente,
con tetto `INHERITED_EFFECTIVE_CAP_PCT = 5`. Il debito **nuovo** continua a
costare `marketRatePct` pieno: quello è ciò che il giocatore sceglie, e lo paga.

Nuova `normalizeInheritedDebtRates(debts, debtRatioPct)`, idempotente, che tocca
**solo** le tranche `debt-inherited-*` o etichettate «Debito ereditato».

### `MaterialEconomy.ts`

`seedInheritedDebt` emette al carry invece che al tasso di mercato. Nuove
`normalizeInheritedDebtStock` e `hasUnnormalizedInheritedDebt` per la bonifica.

`DEBT_HEADROOM_RATIO` da `0,15` a `0,35`: con 0,15 il debito massimo legalmente
raggiungibile restava sempre 5 punti di PIL **sotto** la soglia di crisi
`baseline + 20` di `NationCrisis`, quindi il canale «debito nuovo» della crisi di
insolvenza era irraggiungibile per costruzione.

### `NationStateService.ts` — bonifica dei salvataggi

`stockForEra(stock)` → `stockForEra(polityId, stock)`. Nei mondi moderni riporta
al carry le tranche già scritte in DB, in modo idempotente, senza toccare il
debito emesso dal giocatore. Nessuna migrazione distruttiva: la riga viene
riscritta alla prima lettura utile.

### `country-facts.ts` — righe storiche

Aggiunte `1815`, `1914`, `1989`, `2000` a `HISTORICAL_GDP_BY_YEAR` e i redditi
pro capite di ripiego coerenti (`3`, `40`, `2 400`, `3 500`). Il 1951 è escluso
dai test di monotonia perché India 25 → 22 è un **calo post-bellico reale**, non
un errore di tabella.

---

## Verifiche

- `npx tsc` pulito.
- **107 test verdi** sui moduli toccati (8 file), compreso il nuovo
  `tests/realism-start-conditions.test.ts` (23 test).
- Effetto misurato dopo la patch — servizio del debito e crisi:

| Paese | Debito % PIL | Tasso carry | Interessi % PIL | Servizio % entrate | Livello | Collasso |
|---|---|---|---|---|---|---|
| JPN | 214,5 | 2,0% | 4,3% | 43% | calm | nessuno |
| SGP | 166,0 | 1,7% | 2,8% | 28% | calm | nessuno |
| GRC | 155,4 | 1,7% | 2,6% | 26% | calm | nessuno |
| ITA | 134,7 | 1,5% | 2,0% | 20% | calm | nessuno |
| USA | 122,3 | 1,4% | 1,7% | 17% | calm | nessuno |

- Scala storica dopo la patch: 1815 → riga 1815 (GBR 0,4 mld), 1914 → riga 1914
  (DEU 12 mld), 1989 → riga 1989 (USA 5 657 mld), 2000 → riga 2000 (CHN 1 211 mld).

## I test di accettazione

`tests/realism-start-conditions.test.ts` è scritto come **accettazione**, non
come verifica di comportamento: il criterio è un fatto osservabile del gioco.

- nessuna nazione del registro con debito di riferimento può partire in crisi
  critica o in allarme di insolvenza senza essersi indebitata;
- il tasso di carry resta sotto la metà delle entrate anche per il debito più
  alto del registro;
- la bonifica è idempotente e non tocca il debito del giocatore;
- il margine di credito supera la soglia di crisi;
- ogni anno dei preset ha una riga propria, con valori positivi e codici validi.

## Verifica estesa (tutti i test eseguibili)

Ricompilando `better-sqlite3` per Linux (`npm rebuild better-sqlite3`) anche i
test che aprono il database sono diventati eseguibili, quindi la verifica copre
l'intero gate della CI:

| Area | Esito |
|---|---|
| Test backend di logica pura (88 file) | **809 verdi** |
| Test backend che aprono il DB (12 file, inclusi i più lenti) | **202 verdi** |
| `nation-state-service` (esercita `stockForEra`) | **12 verdi** |
| `natural-resource-integration` (tesoreria, debito, riparazione magazzino) | **11 verdi** |
| Test frontend (84 file) | **689 verdi** |
| `tsc` backend | pulito |
| Build backend + frontend | verdi |

I test DB più lenti (`war-fronts` 57 test, `balance-mode` 32) richiedono
`--maxWorkers=1` e timeout alti: le migrazioni del database dominano la durata
(oltre 150 s per `war-fronts`), non il costo dei test.

## Limiti dichiarati

- I valori della cedola storica (`1%`) e della quota rifinanziata (`10%`) sono
  ancorati all'ordine di grandezza **reale** (il Giappone paga ~2% su un debito
  del 214% del PIL), non a una serie storica per paese. Una taratura più fine
  richiederebbe i tassi effettivi per paese, che il registro non contiene.
- Le cifre del report sono state misurate eseguendo `backend-nest/dist` e
  ricontrollate da una revisione indipendente, che ha corretto sei imprecisioni
  minori (elencate in §7 del report).
- Non è stata eseguita una **partita reale** con LLM configurato: la verifica è
  sui numeri del motore e sui test, non sul bilanciamento empirico di una
  sessione lunga.
