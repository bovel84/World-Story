# WS-GOVOFFICE-06 — Il catalogo delle opere nazionali

- **Base**: `main` @ `5074879` (WS-GOVOFFICE-05B).
- **Ramo**: `feat/ws-govoffice-06-catalogo-opere`.
- **Confine rispettato**: **nessuna** modifica sotto `backend-nest/src/**`. Tutto
  il lavoro è **dati di scenario** (`backend-nest/data/presets/realism_test_world/simulation/`)
  e **test**. Il loader non è stato toccato: è lui il contratto da soddisfare.
- **Freeze motore**: intatto. `core/simulation/**`, `GameSession`,
  `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema, DB,
  repository, `useSimulationPlayback`, pipeline di avanzamento tempo: non toccati.

## Sintesi

Il mondo di prova `realism_test_world` aveva **una sola opera** (`w_road`): il
Ministro dei Lavori non aveva nulla da proporre e il giocatore non poteva
costruire una scuola, un ospedale o un ponte. Il catalogo è stato esteso a
**dodici opere** e al vocabolario che servono a dichiararle. La prova regina —
`realism_test_world` carica senza errori — è verde: `ok: true, blocking: 0,
warnings: 0`, con **copertura di filiera vuota** (`coverage.missing: []`).

## 1. Il problema trovato

Il catalogo (`works.json`) dichiarava una sola opera. Le conseguenze misurate:

- `GovernmentAgenda` genera una voce `build_<workId>` per ogni opera: una sola
  proposta, sempre la stessa.
- `buildableWorks` leggeva un'opera sola: nessuna scelta di politica dei lavori.
- Il vocabolario era minimo: 5 risorse, 3 qualifiche, 5 tipi d'impianto. Non
  esistevano né `ft_school` né `ft_hospital` — un'opera nuova non avrebbe avuto
  un tipo d'asset valido, quindi nemmeno una capacità dichiarabile.

## 2. Vocabolario esteso (tutto dichiarato)

### 2.1 Risorse (5 → 12)

Aggiunte: `cement` (massa, kg), `bricks` (conteggio, pz), `timber` (volume, m³),
`machinery` (conteggio, pz), `fuel` (volume, L), `books` (conteggio, pz),
`medicine` (massa, kg).

**Giustificazione §4.4 — il punto che decide se lo scenario carica.** La regola
di chiusura del loader è:

```
justified = stockByResource ∪ extractable
while grew:
    per ogni ricetta: se TUTTI gli output sono già giusti E tutti gli input
    sono già giusti → aggiungi gli output a `justified`
```

Il primo test (`outputs.every(justified)`) rende la chiusura **incapace di
crescere**: una ricetta non può introdurre una risorsa nuova, perché i suoi
output devono essere già giusti per essere considerati. Ho verificato la regola
sul codice (`src/scenario/loader.ts`, §"Chiusura transitiva delle filiere"), non
assunta. Ne segue che **una risorsa usata in una distinta deve avere stock
iniziale o un giacimento estraibile**, altrimenti `unjustified_input` è un errore
bloccante.

Percorso scelto (sanzionato dal task): **stock iniziale** per tutte e sette le
risorse nuove (`initial-state.json`, lotti `lot_*_alpha`). Non si dichiara una
filiera che non esiste: il mondo di prova nasce con una scorta. Il rapporto di
validazione lo conferma con `coverage.missing: []`.

### 2.2 Qualifiche (3 → 8)

Aggiunte: `insegnante`, `medico`, `ingegnere`, `tecnico`, `soldato`, accanto a
`minatore`, `operaio`, `agricoltore`, con un bacino in `initial-state.workforce`
(`wf_teachers_alpha` 400, `wf_doctors_alpha` 150, `wf_engineers_alpha` 120,
`wf_technicians_alpha` 300, `wf_soldiers_alpha` 900). La manodopera è persone,
non ore (§4.1.7). Nota misurata e invariata: la forza lavoro **non è
materializzata nel ledger**; `Availability` la dichiara ignota invece di
inventare un numero.

### 2.3 Tipi d'impianto (5 → 16)

Aggiunti, **uno per dominio d'opera**, così che l'asset finale abbia una
capacità coerente e non sia un'officina travestita: `ft_school`,
`ft_university`, `ft_hospital`, `ft_bridge`, `ft_water`, `ft_railway`,
`ft_factory`, `ft_power`, `ft_housing`, `ft_barracks`, `ft_fortification`.

## 3. Le opere (1 → 12)

`w_road` resta la **prima** del catalogo (invariante dei test MG01–MG03).
Aggiunte 11 opere, tutte con fasi a DAG, distinta materiali non vuota, fondi in
`TEST`, manodopera, effetto, manutenzione e provenienza `authored`.

| opera | tipo asset | `effect.kind` | effetto | fasi | materiali | fondi | manodopera |
|---|---|---|---|---|---|---|---|
| `w_road` | ft_road | transport | 40 km/g | 2 | steel, tools | 20000 | operaio |
| `w_school` | ft_school | education | 400 studenti/g | 3 | books, bricks, cement, timber | 16000 | insegnante, operaio, tecnico |
| `w_university` | ft_university | education | 120 iscritti/g | 3 | books, bricks, cement, timber | 32000 | ingegnere, insegnante, operaio, tecnico |
| `w_hospital` | ft_hospital | health | 200 pazienti/g | 3 | bricks, cement, machinery, medicine | 41000 | ingegnere, medico, operaio, tecnico |
| `w_bridge` | ft_bridge | transport | 20 km/g | 2 | cement, steel | 26000 | ingegnere, operaio |
| `w_water` | ft_water | water | 5000 m³/g | 2 | bricks, cement, steel | 16000 | operaio, tecnico |
| `w_railway` | ft_railway | transport | 60 km/g | 2 | cement, steel, timber | 38000 | ingegnere, operaio, tecnico |
| `w_factory` | ft_factory | industry | 20 pz/g | 2 | cement, machinery, steel | 30000 | ingegnere, operaio, tecnico |
| `w_power` | ft_power | energy | 150 MW/g | 3 | cement, fuel, machinery, steel | 46000 | ingegnere, operaio, tecnico |
| `w_housing` | ft_housing | housing | 2000 abitanti/g | 3 | bricks, cement, timber | 27000 | operaio, tecnico |
| `w_barracks` | ft_barracks | defence | 600 posti/g | 2 | bricks, cement, steel, timber | 16000 | operaio, soldato |
| `w_fortification` | ft_fortification | defence | 300 posti/g | 2 | cement, steel | 24000 | ingegnere, operaio, soldato |

Le grandezze sono dello **stesso ordine di `w_road`** e sono inventate (la
fixture è dichiaratamente sintetica): non sono prezzi storici. Lo stock iniziale
copre il fabbisogno totale di ogni opera, quindi **tutte e 12** risultano
`buildable` (`missing: []`) e la strada diretta è raccomandata per ognuna.

### 3.1 Perché tutte le scorte stanno presso un solo attore

`resolveWorkHolders` (`src/game/WorkHolders.ts`) risolve **un solo** detentore
materiale per opera: il commit ne accetta uno. Se due attori coprissero
materiali diversi, `materialActorId` sarebbe `null` e la voce non sarebbe
committabile. Perciò i sette lotti nuovi — come già `steel` e `tools` — stanno
presso `alpha_steel_co`: ogni opera che mescola materiali vecchi e nuovi resta
coperta da un unico detentore. È un **limite del motore** (una mappa
risorsa→detentore è lavoro di una fase successiva), non una scelta del catalogo.

## 4. Il `effect.kind` delle opere: cosa esiste davvero nel motore

Ricerca in lettura prima di scrivere:

- `WorkDefinition.effect` è tipato `{ kind: string; unit: string; perDay: IntString }`
  (`src/scenario/types.ts`): **nessun enum**, nessun elenco chiuso.
- Il loader richiede solo che `kind` sia una stringa **non vuota**
  (`src/scenario/loader.ts`).
- `src/game/WorkDelivery.ts` ricopia `{ kind, unit, perDay }` nei metadati
  dell'asset consegnato; **nessun codice ramifica** su `kind`.
- L'unico valore presente nel repository è `transport` (di `w_road`).

Gli altri sistemi di effetti hanno vocabolari propri, **non** applicabili a
un'opera, e non sono stati usati:

- `NationalEffect` (`core/simulation/NationalEffects.ts`): `stock`, `arsenal`,
  `modifier`, `economy` — leve materiali del canale nazionale.
- `StrictEffect` (`core/simulation/EffectValidator.ts`): `ledger`, `project_tick`,
  `shipment`, `qualitative` — effetti del percorso strict, con causale.

**Decisione**: l'`effect.kind` di un'opera è un'**etichetta dichiarativa** della
capacità che l'asset rende operativa. Ho usato `transport` (preesistente) per le
opere di mobilità e un set coerente di etichette di dominio per le altre:
`education`, `health`, `water`, `energy`, `industry`, `housing`, `defence`. Non
sono meccaniche nuove: il campo non è interpretato e non è una leva materiale.
Un test in `scenario-catalog.test.ts` **fissa il set dichiarato**, così un refuso
non passa in silenzio.

## 5. File modificati

Dati (nessuna riga di `src/**`):

- `backend-nest/data/presets/realism_test_world/simulation/resources.json` — +7 risorse.
- `.../facilities.json` — +11 tipi d'impianto.
- `.../works.json` — +11 opere (`w_road` resta la prima).
- `.../initial-state.json` — +7 lotti inventario, +5 bacini di manodopera.
- `.../sources.md` — sezione WS-GOVOFFICE-06 (vocabolario e giustificazione §4.4).

Test:

- `backend-nest/tests/scenario-catalog.test.ts` — nuovo `describe` WS-GOVOFFICE-06 (4 test).
- `backend-nest/tests/mg01-work-feasibility.test.ts` — nuovo test sulla distinta di
  un'opera non-strada (`w_school`) + **aggiustato** il caso "due opere con lo
  stesso id": inseriva il clone in coda e assumeva `works[1]`; ora lo inserisce in
  posizione 1 (`splice(1, 0, …)`), indipendente dal numero di opere.
- `backend-nest/tests/mg05-agenda-reading.test.ts` — nuovo test su almeno 10 opere
  proposte e costruibili.
- `backend-nest/tests/economy-routes.test.ts` — **aggiustato** il conteggio del
  bootstrap `9 → 16` (3 tesorerie + 13 lotti; era 3 + 6).
- `backend-nest/tests/mg01-availability.test.ts` — **aggiustata** la lista delle
  unità in giacenza dell'impresa ALPHA, che ora include le 7 risorse nuove.

Nessun test è stato allentato o disabilitato: i tre aggiustamenti inseguono
assunzioni legate alla **dimensione** del catalogo (una sola opera, 9 righe di
bootstrap, 4 unità in magazzino), non la logica sotto prova.

## 6. Test eseguiti (esito reale)

- Prova regina — `node dist/scenario/cli.js data/presets/realism_test_world`:
  `[ok] realism_test_world: 0 errori, 0 avvisi`; `coverage.missing: []`;
  12 risorse tutte giustificate.
- Backend: `npm test` → **200 file, 2110 test, tutti verdi** (+6 test rispetto a
  `5074879`). `dist/**/*.test.js` sono artefatti di build **gitignored** e non
  vengono eseguiti in CI (che lancia i test prima della build); rimossi in locale.
- Backend: `npx tsc --noEmit` → pulito.
- Frontend: `vitest run` → **105 file, 898 test, tutti verdi** (nessuna modifica).

## 7. `effect.kind` evitati ed eventuali opere escluse

- **Evitati**: i `kind` di `NationalEffect` (`stock`, `arsenal`, `modifier`,
  `economy`) e di `StrictEffect` (`ledger`, `project_tick`, `shipment`,
  `qualitative`). Appartengono ad altre pipeline: usarli per un'opera
  significherebbe fingere una meccanica che il motore non applica.
- **Usati**: `transport` (l'unico preesistente) + etichette di dominio dichiarative.
- **Opere escluse**: **nessuna**. Il loader non rifiuta alcun `effect.kind`
  (accetta qualsiasi stringa non vuota), quindi il vincolo non ha costretto a
  rinunciare a nessuna delle opere richieste. La cautela è stata nel non
  attribuire all'effetto un potere che non ha.

## 8. Limiti e proposte

Limiti (dichiarati, non nascosti):

1. **Nessuna filiera per le risorse nuove.** Sono giustificate da stock, non da
   ricette: il mondo non le produce. La regola di chiusura del loader non
   permetterebbe comunque a una ricetta di giustificarle (§2.1).
2. **Crescita del bootstrap.** `bootstrapCatalogEconomy` appende
   `tesorerie + lotti` e, su un ramo già inizializzato, lancia
   `BOOTSTRAP_INCOMPLETE` se il conteggio è cambiato. Un salvataggio di
   `realism_test_world` creato col catalogo vecchio (9 righe) incontrerebbe
   l'errore alla prima command economy. Per un **mondo di prova** ricreato da
   zero è accettabile; per un mondo vivo non lo sarebbe.
3. **Un solo detentore materiale per opera** (§3.1): limite del motore.
4. **`effect.kind` e capacità degli impianti sono dichiarativi**, non ancora
   collegati a un motore di produzione/consumo: l'asset consegnato porta i
   metadati, non li esercita.
5. **Bilanciamento**: le grandezze sono d'ordine di `w_road`, non un equilibrio
   di gioco.

Proposte per la fase successiva:

1. Far **crescere davvero la chiusura §4.4** sulle uscite delle ricette (oggi il
   test `outputs.every(justified)` la blocca), così un catalogo può dichiarare
   una **filiera** invece di uno stock.
2. Rendere il **bootstrap tollerante alla crescita** del catalogo (append-only
   idempotente per contenuto), così aggiungere dati non rompe i rami esistenti.
3. Superare il limite **un detentore per opera** con una mappa risorsa→detentore.
4. Aggiungere **filiere** per cemento, mattoni, macchinari, libri, medicinali,
   carburante e istanziare i tipi d'impianto corrispondenti in `initial-state`.
5. Se l'`effect.kind` diventerà semantico, dargli un **contratto nel motore**
   (enum o resolver), invece di lasciarlo etichetta libera.
6. Un test **end-to-end** che dal Governo faccia partire una cantiere **non-strada**
   (es. `w_school`): oggi la copertura è unit/integration backend.
