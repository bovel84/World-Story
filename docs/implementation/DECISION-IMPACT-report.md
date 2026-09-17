# REPORT — DECISION-IMPACT (non si capisce quanto le decisioni incidono)

Base: `main` = `2e138ad` (SUGGESTIONS-RESET merged). Segnalazione: turno 8, 05/05/1816,
Confederazione Germanica — «La cassa sta perdendo ma io non so quanto le mie decisioni stanno
incidendo positivamente o negativamente».

---

## 1. FASE 1 — diagnosi: che cosa esiste oggi e che cosa manca

### 1.1 Cosa il gioco mostra oggi sull'impatto delle decisioni

| Livello | Dato | Dove si vede | Per decisione? |
|---|---|---|---|
| Turno | delta reali di tesoreria, saldo mensile, stabilità, tensione, sforzo bellico, debito/PIL, PIL, potenza, popolazione + risorse | read model LW02 (`deriveCheckpointImpact`/`impactsByTurn`) → «Effetti nel turno» nella Timeline e «Variazioni registrate nel periodo» nel lettore del checkpoint | **no** (per turno) |
| Decisione | esito narrativo (`accepted`/`partial`/`rejected`/`voided`) + cronaca dell'ordine (`simulation_action_outcomes`, `item.result`) | card dell'ordine, cronaca | **no** (racconta *cosa*, non *quanto*) |
| Decisione | importo realmente addebitato all'ordine (`💸 Spesa ordinata «…» (Categoria): X mld dalla tesoreria.`) | — | il motore lo calcola, ma **non arriva al giocatore** (vedi 1.2) |
| Coda | stima di fattibilità prima dell'invio (`estimateOrderCost`, «Spesa stimata · Categoria · 12,40 mld · 25% del gettito annuo») | verifica di fattibilità nel compositore d'ordine | è una **stima ex ante**, non l'effetto registrato |

Quindi: il giocatore ha il **saldo aggregato del turno** e le **storie** delle sue mosse, ma nessun
ponte fra i due. La cassa peggiora e non c'è modo di sapere quanto di quel peggioramento è la sua
decisione e quanto è gestione ordinaria del paese.

### 1.2 Il dato per decisione esiste, ma non viene consegnato (evidenza misurata)

`OrderExecutionService.settleOrderCosts()` addebita la tesoreria **per singolo ordine**
(`estimateOrderCost` → `affordableCharge` → `saveResourceStock`) e produce la riga di bollettino.
Sonda eseguita su una sessione reale (provider stub, due partite identiche con lo stesso ordine
«Costruire un ponte sul fiume», esito `accepted`):

| | salto fisso (30 giorni) | **auto-jump** `{"mode":"next_event","jump_days":0}` |
|---|---|---|
| `turnResult.events` | include `💸 Spesa ordinata «Costruire un ponte sul fiume» (Infrastrutture): 0.06 mld dalla tesoreria.` | `["Evento di prova"]` — **nessuna riga di spesa** |
| eventi per azione consegnati al client | bollettini del turno | `[]` |
| storico conti | 1 punto per data | 1 punto per data |

Causa nel codice: `TurnPipelineService.processActionBatchUnlocked`
(`const economyEvents = autoJump ? [] : economyBulletins;`) esclude i bollettini economici
dall'esito del turno in auto-jump — scelta motivata (evita una seconda narrazione del periodo),
ma porta via anche la **contabilità delle decisioni del giocatore**.

La modalità auto-jump non è un caso di laboratorio: la partita dell'utente usa **sempre**
`next_event` (`simulation_jobs.payload_json` = `{"mode":"next_event","jump_days":0}` per tutti i
turni), e il risultato consegnato al client (`simulation_jobs.result_json`) contiene solo i titoli
narrativi, senza alcun importo. Verifica anche sui dati persistiti della partita
`246c9cda8b8f`: in `turn_results.events` nessuna riga `💸`/`📊`, in `simulation_events` solo eventi
`world`/`diplomacy`.

### 1.3 Il secondo punto storico non è recuperabile

`TurnPipelineService` **riregistra** il punto dello storico conti dopo l'addebito («Il punto storico
della tesoreria va riscritto dopo la spesa ordinata»), ma `nationalAccountRepository.append` fa
`INSERT … ON CONFLICT(game_id, branch_id, game_date, polity_id) DO UPDATE`: il punto pre-addebito
viene sovrascritto, quindi la differenza fra i due non è più leggibile (verificato: 1 sola riga per
data nella partita dell'utente). L'unica traccia per-decisione era la riga di bollettino, che in
auto-jump non veniva consegnata.

### 1.4 `deriveCheckpointImpact` / `impactsByTurn` possono dare la lettura per decisione?

**No, e non devono**: lo storico conti è registrato **per turno**; quei read model rispondono
correttamente «quanto si è mosso il paese nel periodo». Ciò che manca è (a) il valore per decisione
e (b) la dichiarazione esplicita di quale parte della variazione **non** è attribuibile alle
decisioni. Sono due dati distinti e vanno composti, non confusi.

### 1.5 Gap esatto

1. L'addebito per ordine non raggiunge il client quando il turno è in auto-jump (percorso reale del
   giocatore) → manca il numero.
2. Non esiste alcuna presentazione che dica «questa decisione è costata X» e «il resto della
   variazione non dipende dalle tue decisioni» → manca la lettura.
3. Gli indicatori non monetari (stabilità, tensione, saldo) non hanno **alcun** valore per singola
   decisione nel motore: qualunque attribuzione sarebbe inventata → va dichiarato, non dedotto.

## 2. FASE 2 — intervento minimo

### 2.1 Motore: la contabilità già calcolata viaggia con l'esito (non come narrativa)

- `OrderExecutionService.settleOrderCosts()` restituisce ora anche `entries`:
  `{ actionId, kind: 'charged'|'partial'|'unfunded', requestedMld, chargedMld, label }` — la stessa
  contabilità del bollettino, in forma **strutturata** (nessun secondo calcolo, nessuna stima).
- `TurnPipelineService` (e `PlaybackService` per il percorso in pausa) allegano la voce al
  `item.result.settlement` **della decisione corrispondente**: il numero viaggia con l'ordine a cui
  appartiene, anche quando il modello fornisce titoli di evento propri (prima la riga andava persa
  nel filtro `eventHeadlines`).
- Nessuna modifica a `core/simulation/**`; nessuna migrazione; nessun nuovo endpoint; il bollettino
  testuale resta identico (cambia solo *chi* lo riceve: ora anche l'esito strutturato dell'ordine).

### 2.2 Client: read model puro + presentazione unica

- **`frontend/src/components/Game/decisionImpact.ts`** (nuovo, puro): compone le decisioni del turno
  con il delta LW02 e produce
  - effetto **per decisione** (testo con segno, categoria, tono: spesa = negativo, copertura
    parziale/annullato = attenzione);
  - **totale addebitato** alle decisioni;
  - **quota non attribuibile** = variazione registrata della tesoreria + totale addebitato (residuo
    aritmetico fra due numeri del motore, dichiarato come tale: gestione ordinaria, acquisti,
    manutenzione, debito);
  - indicatori registrati **solo per turno**, mai presentati come effetto della decisione;
  - se non esiste alcun addebito registrato → nessun importo (e la motivazione), mai un numero
    inventato.
- **`DecisionImpactBlock.tsx`** (nuovo): presentazione unica, usata in **due** punti —
  «Effetti nel turno» nella Timeline e «Variazioni registrate nel periodo» nel lettore del
  checkpoint. Il blocco compare **solo** quando il motore ha registrato un effetto: i delta del
  turno restano dove sono già pubblicati, senza duplicarli.
- Importi formattati con `formatMoney` (`utils/format`): una sola convenzione italiana. La stessa
  formattazione è stata adottata dal read model LW02 per gli importi in `mld` (prima uscivano con il
  punto decimale), così i due numeri affiancati si leggono allo stesso modo.
- Le decisioni con il loro effetto entrano in `HistoryItem` (store esistente, nessun nuovo stato) e
  sono filtrate per turno/checkpoint con la stessa chiave del delta LW02.

## 3. File modificati

**Motore (non congelato):**
- `backend-nest/src/game/OrderExecutionService.ts` — `OrderSettlementEntry` + `entries` in `settleOrderCosts`; campo `result.settlement`.
- `backend-nest/src/game/TurnPipelineService.ts` — allegato `settlement` all'esito dell'ordine.
- `backend-nest/src/game/PlaybackService.ts` — stessa attribuzione nel percorso in pausa.

**Client:**
- `frontend/src/components/Game/decisionImpact.ts` + `.test.ts` — **nuovi**, read model puro.
- `frontend/src/components/Game/DecisionImpactBlock.tsx` — **nuovo**, presentazione unica.
- `frontend/src/components/Game/checkpointImpact.ts` + `.test.ts` — importi in `mld` con la formattazione condivisa.
- `frontend/src/components/Game/HudBar.tsx` — blocco per turno nella Timeline (+ prop `decisions`).
- `frontend/src/components/Game/SimulationEventReader.tsx` + `GameScreen.tsx` — decisioni del checkpoint in lettura.
- `frontend/src/hooks/useWorldAdvance.ts`, `frontend/src/stores/gameStore.ts`, `frontend/src/services/api.ts` — trasporto del dato strutturato.
- `frontend/src/index.css` — stile `.decision-impact*`.

**Test/E2E/docs:**
- `backend-nest/tests/order-execution-service.test.ts` — effetto strutturato per decisione.
- `e2e/mock-api.mjs`, `e2e/tests/decision-impact.spec.mjs` — **nuovo** E2E mock.
- `docs/implementation/DECISION-IMPACT-report.md` (questo report).

## 4. CORE ENGINE FREEZE

`core/simulation/**` **non toccato**. Nessuna migrazione, nessun nuovo endpoint, nessuna seconda
verità: il numero per decisione è quello che il motore già calcola quando addebita l'ordine e la
variazione del turno è quella già registrata nello storico conti. Le modifiche in
`TurnPipelineService`/`PlaybackService`/`OrderExecutionService` sono additive (un campo in più
nell'esito) e non alterano semantica di run, checkpoint, coda o Continue/Interviene.

## 5. Test eseguiti (esito reale)

- `backend-nest/tests/order-execution-service.test.ts` — `entries` per ordine pagato, coperto solo
  in parte (charged < requested), non coperto (charged = 0) e respinto (nessuna voce). Suite
  backend completa: **137 file / 1165 test verdi**.
- `frontend/src/components/Game/decisionImpact.test.ts` (9 test): addebito per decisione con segno;
  somma e quota non attribuibile dal delta reale; ordine annullato (0,00 mld, nessuna spesa);
  copertura parziale (addebitato su richiesto); indicatori per-turno **non** attribuiti; nessun
  importo senza addebito registrato (con motivazione); nessuna quota inventata senza delta del
  turno; ordine respinto senza effetto; valori non numerici esclusi.
- `checkpointImpact.test.ts` aggiornato alla formattazione italiana degli importi (24 test verdi con
  il nuovo file). Suite frontend completa: **51 file / 334 test verdi**.
- **E2E mock** `e2e/tests/decision-impact.spec.mjs` (2, browser + API mockate):
  1. dopo l'avanzamento la cronaca mostra `−12,40 mld` per la singola decisione (numero del
     motore), il totale addebitato, la variazione registrata `−19,50 mld` e la quota **non
     attribuibile** `−7,10 mld`;
  2. senza addebito registrato **non** compare alcun `.decision-impact`: resta la sola variazione
     del turno registrata dal motore.
  Suite E2E mock completa: **27 test verdi**.
- `tsc --noEmit` pulito (backend e frontend); build frontend verde.

## 6. Limiti residui (dichiarati, non aggirati)

1. **L'attribuzione per decisione vale per i turni eseguiti nella sessione corrente.** Il motore
   calcola l'addebito al momento dell'esecuzione e lo consegna con l'esito del turno; non lo
   conserva (vedi 6.2), quindi dopo un reload dei turni passati resta leggibile solo la variazione
   del periodo. Il blocco E2E verifica proprio il caso «nessun addebito registrato»: nessun importo
   inventato.
2. **Proposta (NON applicata) — durabilità senza migrazione.** `recordAccountSnapshot(period.end)`
   viene già richiamato dopo l'addebito; se il payload registrato includesse anche il **totale
   addebitato del turno** (una chiave in più nel JSON `account` di `national_account_history`,
   colonna già esistente) la quota «spiegata dalle decisioni» sarebbe durabile per tutti i turni,
   senza migrazione e senza toccare il motore di simulazione. Non è stata applicata perché cambia
   la forma di un payload consumato dal Dossier: da valutare come intervento separato.
3. **Proposta (NON applicata) — durabilità per singola decisione.** Richiede di conservare
   `{actionId, kind, requestedMld, chargedMld, label}` accanto all'esito dell'ordine;
   `simulation_action_outcomes` non ha una colonna adatta → servirebbe una **migrazione di schema**.
   Regola della consegna: fermarsi e documentare. Non applicata.
4. **Gli indicatori non monetari non hanno un valore per decisione nel motore** (stabilità,
   tensione sociale, saldo, PIL, potenza militare): restano variazione del turno, con dicitura
   esplicita. Attribuirli sarebbe inventare causalità.
5. Il residuo «non attribuibile» è un **residuo aritmetico** fra variazione registrata e addebiti
   registrati: include anche eventuali effetti delle decisioni che il motore non contabilizza per
   ordine (es. benefici narrativi). È dichiarato come non attribuibile, non come causa.
6. La verifica di fattibilità nel compositore d'ordine continua a mostrare una **stima ex ante**
   (`estimateOrderCost`): resta distinta, per costruzione, dall'effetto registrato a posteriori.
