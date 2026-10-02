# WS-GOVUX-P6 — Cabinet memory: la memoria del Consiglio

Base verificata: `main` / `origin/main` **`3f62c8a`** (merge PR #163, WS-GOVUX P4).
Branch: **`feat/ws-govux-p6-cabinet-memory`**, commit di codice+test e questo
report. Task letti integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md` (§P6)
e `/tmp/pi-tasks/pi-task-govux-gates-lite.md` (gate ridotto; **P6 non è
nell'eccezione UI minima** → nessun E2E e nessuno screenshot obbligatori). Ordine
di lavoro: P1 → P3 → P4 → **P6** → P7.

**P6 completata.** P7 non avviata. Nessun merge, nessun deploy.

## 1. Problema risolto e comportamento finale

Il P0 aveva rilevato che la memoria esisteva già come **persistenza** (WS-MINISTER-UX-05)
e come **evidenza narrativa** (JEV), ma con tre lacune rispetto a P6:

- **non distingueva le quattro famiglie**: un atto accodato e una proposta solo
  discussa avevano generi diversi, ma mancava la lettura esplicita
  decisione confermata / preferenza dichiarata / questione aperta / ipotesi esplorata;
- **la revoca non esisteva**: l'unico modo di togliere un ricordo era cancellarlo
  (o la potatura al rewind), perdendo la storia;
- **il tempo del ricordo era debole**: i ricordi del client erano ancorati alla
  sola data (senza turno), e nel database l'ordine includeva `updated_at`
  (timestamp tecnico), non solo il tempo del mondo.

Comportamento finale, a parità di motore e di dati:

- **quattro famiglie derivate** dal genere, senza nuovo campo e **senza
  migrazione**: `confirmed-decision` ← queued/verified, `declared-preference` ←
  objective, `open-question` ← open-question, `explored-hypothesis` ←
  discussed/rejected. I vecchi salvataggi restano validi;
- **la revoca conserva la storia**: il ricordo resta, marcato `revoked`, con il
  motivo precedente accanto a quello della revoca; **non riemerge** nel retrieval
  né nel prompt (`relevantMemory`/`relevantMinisterMemory` lo saltano);
- **il tempo è il turno del mondo**: il client invia `turn` (dal motore) con ogni
  ricordo, e il repository ordina per **data, poi turno, poi id** — il timestamp
  tecnico (`updated_at`) non entra più nell'ordine;
- **scope = partita**: game (e ramo e mandato) già nel contratto, con test
  espliciti di isolamento fra partite;
- **retrieval breve**: poche memorie pertinenti (`relevantMemory`/`memorySection`,
  con limite), mai l'archivio intero.

Il confine del modello non cambia: il motore resta l'autorità sui dati, la memoria
non porta cifre nuove e non batte i fatti aggiornati. **Nessuna nuova chiamata LLM.**

## 2. File effettivamente modificati e componenti riusati

Classificazione locale (stessa convenzione del modulo Governo): **A**
comportamento/layout, **B** harness, **C** test, **D** report/assets, **E**
congelati. In P6: **E nessuna modifica**.

| File | Classe | Scopo |
|---|---|---|
| `frontend/src/components/Game/ministerMemory.ts` | **A — estensione del read model puro** | `MinisterMemoryFamily` + `FAMILY_LABEL` + `memoryFamily`; stato `revoked`; `revokeMemory` (conserva storia e motivo), `revokedMemory`; `relevantMemory` salta i revocati; `declaredPreference`; il turno entra nella provenienza (`refLabel`) |
| `frontend/src/components/Game/SeatBrief.tsx` | **A — estensione UI** | famiglia per ricordo (`data-family` + chip), stato revocato, pulsante **Revoca** (`onRevoke`), turno nella provenienza |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A — estensione** | prop `currentTurn`; `turn` in ogni ricordo; `prepareRoad` registra una **preferenza dichiarata**; `revokeFor` + `onRevoke` al fascicolo |
| `frontend/src/components/Game/GameScreen.tsx` | **A — cablaggio** | passa `currentTurn={currentGame?.currentTurn}` al modulo Governo |
| `frontend/src/editorial.css` | **A — stile** | chip delle famiglie (colore per famiglia), ricordo revocato smorzato, pulsante di revoca (nessun `!important`) |
| `backend-nest/src/core/government/MinisterMemory.ts` | **A — estensione del contratto puro** | `MinisterMemoryFamily` + `MINISTER_MEMORY_FAMILIES` + `memoryFamily`/`memoryFamilyLabel`; stato `revoked`; `revokeMinisterMemory`, `revokedMinisterMemory`; `relevantMinisterMemory` salta i revocati; `normalizeMinisterMemory` accoglie `revoked` |
| `backend-nest/src/repositories/minister-memory.repository.ts` | **A — estensione** | ordine per **tempo del mondo** (data, turno, id): rimosso `updated_at` da `listMemory`/`listBranch` |
| `frontend/src/components/Game/cabinetMemory.test.ts` | **C — nuovo** | 15 test: famiglie, revoca, turno, scope, retrieval |
| `frontend/src/components/Game/seatBriefMemory.test.tsx` | **C — esteso** | 3 test: chip famiglia + turno, ricordo revocato senza pulsante, pulsante per ricordo attivo |
| `backend-nest/tests/ws-govux-p6-memory.test.ts` | **C — nuovo** | 13 test: famiglie, revoca, turno, validazione, scope, retrieval |
| `backend-nest/tests/ws-govux-p6-persistence.test.ts` | **C — nuovo** | 8 test sul database vero: ordine per turno, revoca persistita, scope per partita, fork con revocati |
| `docs/implementation/WS-GOVUX-P6-report.md` | **D — documentazione** | Questo report |

**Riusati senza modificarli:** `recordMemory`/`recordMinisterMemory` (upsert per
`id`), `memorySection`/`briefingFor` (il confine della memoria nel prompt),
`pruneMemoryByDate`/`pruneMinisterMemory` (rewind), `forkMinisterMemory` e
`ministerMemoryRepository.forkMemory`, `mandateFor`, `clientMandate`, lo storage
`localStorage`, e il percorso JEV (`recallMinisterMemory`, `rankMinisterMemory`).
Nessuna libreria o dipendenza aggiunta; nessun sistema parallelo; nessuna nuova
rotta; nessuna migrazione.

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**. Log in `/tmp/govux-p6-gate/`.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/cabinetMemory.test.ts src/components/Game/seatBriefMemory.test.tsx` | **2 file / 21 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera frontend) | **130 file / 1104 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd backend-nest && ../node_modules/.bin/vitest run tests/ws-govux-p6-*.test.ts` | **2 file / 21 test passati**, exit 0 |
| `cd backend-nest && ../node_modules/.bin/vitest run <23 file memoria/governo/JEV>` | **23 file / 283 test passati**, 14,6 s, exit 0 |
| `cd frontend && npm run build` | exit 0; warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd backend-nest && npm run build` | exit 0 (poi `rm -rf dist`) |

**Perché la regressione mirata backend (23 file):** P6 tocca
`relevantMinisterMemory` e l'ordine del repository, che sono condivisi con
WS-MINISTER-UX-05/07 e con tutta la catena JEV (W1–W8). Sono stati rieseguiti i
test di memoria, governo, prompt, advisor e JEV: **nessuno allentato, escluso o
dichiarato verde senza esito**.

**Non eseguiti (dichiarati, non verdi):** suite backend **completa**
(`npm --prefix backend-nest test`), E2E completo dei percorsi Governo, matrice
multi-viewport — rimandati al **gate completo di fine blocco**, come da
`pi-task-govux-gates-lite.md`. L'audit `a11y` non è stato rieseguito.

## 4. Screenshot mobile e desktop del flusso interessato

P6 non è nella **eccezione UI minima** (`pi-task-govux-gates-lite.md` §0): il
profilo P6 è **ridotto**, senza E2E e senza screenshot obbligatori. P6 è una fase
di **contratto e persistenza della memoria** più un affinamento del fascicolo
della sedia: la prova sta nei **21 test frontend** (famiglie, revoca, turno,
scope) e nei **21 test backend** (pure + database vero). **Nessuno screenshot è
stato prodotto in questa fase**; mobile e desktop del flusso saranno ripresi dal
gate completo di fine blocco. Non si dichiara un'evidenza visiva non prodotta.

## 5. Checklist di fase

### Checklist P6

- **Completato:** riuso di `ministerMemory.ts` e della persistenza esistente, con
  **nessuna migrazione** (colonna `state` già `TEXT`; i vecchi salvataggi restano validi).
- **Completato:** distinzione **decisione confermata / preferenza dichiarata /
  questione aperta / ipotesi esplorata** (`memoryFamily`, derivata, una sola funzione).
- **Completato:** scope = **partita** (game + ramo + mandato), con test di isolamento.
- **Completato:** il **turno** non è sostituito dal timestamp tecnico (client invia
  `turn`; repository ordina per data/turno/id, `updated_at` fuori dall'ordine).
- **Completato:** le **revoche conservano la storia** (stato `revoked`, motivo
  conservato, ricordo visibile nello storico, escluso dal retrieval e dal prompt).
- **Completato:** retrieval = **poche memorie pertinenti**, mai l'archivio intero.
- **Completato:** 21 test frontend mirati + 21 test backend mirati, eseguiti davvero.

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P6 tocca `frontend/src/**` e, nel backend, **solo** il
contratto puro `core/government/MinisterMemory.ts` e il suo repository
`repositories/minister-memory.repository.ts`. Non tocca
`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, lo schema/database (nessuna migrazione), la semantica
checkpoint/simulation run/playback, né la pipeline di avanzamento del tempo. La
memoria non registra ordini, non applica atti, non muta il mondo: il tempo del
ricordo è quello che il motore fornisce.

## 7. Differenze rispetto alla roadmap e limiti residui

- **Le quattro famiglie sono derivate, non un nuovo campo.** La roadmap chiede di
  «distinguere» le quattro categorie; sono derivate dal genere esistente
  (`memoryFamily`), così i vecchi salvataggi restano validi e non serve una
  migrazione. La granularità a sei generi resta quella del contratto.
- **Preferenza dichiarata = obiettivo.** Il genere `objective` mappa la
  «preferenza dichiarata»; `declaredPreference` la produce quando il Presidente
  **prepara una strada** (la decisione resta la firma). Nessun parsing del testo.
- **Revoca senza timestamp di revoca.** Per non aggiungere un campo/colonna, la
  nota di revoca è composta nel `reason` (motivo precedente conservato · «revocata:
  …»); il tempo del ricordo resta il suo turno. Il ricordo revocato **conta** nel
  limite dei 40 come gli altri.
- **La copia autorevole è server-side, sincronizzata con la richiesta.** Come
  nella UX-05, la revoca fatta nel browser entra nel server col **prossimo
  messaggio** al ministro (nessuna nuova rotta): fra la revoca e quel messaggio la
  copia locale è già corretta, quella server si allinea subito dopo.
- **Nessun effetto di gioco.** La memoria non tocca numeri, code o RNG; la revoca
  è solo un fatto di memoria.
- **JEV intatto.** Nessuna modifica a `jev/**`: il recall JEV usa
  `relevantMinisterMemory`, che ora salta i revocati, senza altre modifiche.

## 8. Fase successiva indicata, senza dichiararla completata

**Prossima fase: P7 — Consequence board** (l'ordine indicato è P1 → P3 → P4 → P6
→ P7; P2 e P5 sono già in `main`). P7 mostrerà, **prima della firma**, effetti
diretti calcolati / previsioni del motore / rischi / incertezze, distinti ed
etichettati, senza mutare salvataggi, risorse, turno, code eventi o RNG. P6 non
avvia P7 e non la dichiara consegnata. Sola PR verso `main`; merge, deploy e gate
completo di fine blocco restano alla regia.
