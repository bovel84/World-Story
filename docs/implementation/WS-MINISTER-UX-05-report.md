# WS-MINISTER-UX-05 — Memoria persistente del ministro

> Il ministro non deve più «dimenticare» una proposta respinta, un obiettivo
> esplicitato dal Presidente o una decisione accodata. Questa fase consegna il
> **contratto** della memoria, il suo **motore puro** (registrazione, selezione
> per il prompt, copia al fork, potatura al rewind) e — con l'innesto autorizzato
> («scelta A») — la **persistenza reale server-side**. Il freeze su schema e
> repository è stato aperto in modo **stretto**: tabella nuova e additiva, nessuna
> migrazione, nessun `deleteGame`. L'innesto è documentato in §6. La tappa
> intermedia nel browser resta dichiarata in §5.

- **Branch**: `feat/ws-minister-ux-05-memoria-persistente`, base `main` @ `25a9d89`
  (PR #147 — UX-04 — mergiata) + il commit `4cf03e8` con il task di questa fase.
- **Task**: `docs/roadmaps/task-ws-minister-ux-05.md`.
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fase UX-05.
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3 (conversazione /
  evidenze / ordini / memoria sono oggetti distinti), `WS-MINISTER-UX-01-report.md`,
  `WS-MINISTER-UX-02-report.md` (profilo e voce), `WS-MINISTER-UX-03-report.md`
  (direttive), `WS-MINISTER-UX-04-report.md` (conseguenze).
- **Freeze rispettato**: nessuna modifica a `core/simulation/**`,
  `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`; nessuna
  migrazione distruttiva. Schema e repository sono stati toccati **solo** nella
  forma additiva autorizzata dall'innesto: il punto è dichiarato in §6.
- **JEV**: non toccato.

---

## 1. Il confine, in una frase

La memoria è un **registro di ricordi con provenienza**, non una seconda
contabilità: non porta cifre nuove, non batte i fatti aggiornati del briefing e
non autorizza a stimare dove il dato manca. La selezione per il prompt è
**deterministica e locale** — nessuna chiamata LLM per riassumere.

## 2. Il contratto dei ricordi

Modulo **puro** `backend-nest/src/core/government/MinisterMemory.ts`, accanto a
`MinisterChat.ts` (nessun I/O, nessuno stato, nessuna chiamata al modello).

### Identità

```ts
export interface MinisterMemoryScope {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly seat: CabinetSeat;      // tesoro | lavori | istruzione | sanità | esteri | interno | guerra
  readonly mandate: string;        // l'identità di CHI siede, non solo la sedia
}
```

Il solo nome della sedia non basta se il ministro cambia: `mandate` è l'identità
del mandato. Partita e ramo isolano le memorie.

### Ricordi e stati

```ts
export type MinisterMemoryKind =
  | 'objective'           // obiettivo esplicitato dal Presidente
  | 'proposal-discussed'  // proposta discussa
  | 'proposal-rejected'   // proposta respinta, CON il motivo
  | 'open-question'       // questione rimasta aperta
  | 'queued-decision'     // decisione accodata / atto nel registro
  | 'verified-outcome';   // esito verificato dopo l'avanzamento del tempo

export type MinisterMemoryState =
  | 'open' | 'discussed' | 'rejected' | 'queued' | 'executed' | 'verified';

export interface MinisterMemoryRef {
  readonly messageId?: string;
  readonly actId?: string;
  readonly orderId?: string;
  readonly gameDate: string;   // data del mondo
  readonly turn?: number;
}

export interface MinisterMemoryRecord {
  readonly id: string;         // chiave stabile: aggiorna, non duplica
  readonly kind: MinisterMemoryKind;
  readonly summary: string;
  readonly reason?: string;    // per una respinta
  readonly state: MinisterMemoryState;
  readonly refs: MinisterMemoryRef;
}
```

Lo **stato** è distinto dal **valore**: «il Presidente valuta una scuola»
(`open-question`/`open`) ≠ «ha firmato l'ordine» (`queued-decision`/`queued`) ≠
«la scuola è operativa» (`verified-outcome`/`verified`). Un ricordo **senza
provenienza** (sintesi o data) è respinto da `isValid` e **non entra**.

### Funzioni

| Funzione | Ruolo |
|---|---|
| `emptyMinisterMemory(scope)` | il punto di partenza, con la sua identità |
| `recordMinisterMemory(memory, record)` | registra o **aggiorna** per `id`; applica il limite |
| `relevantMinisterMemory(memory, limit)` | i ricordi pertinenti, in ordine di priorità |
| `memorySection(memory, limit)` | il blocco di prompt, con il confine dichiarato |
| `forkMinisterMemory(memory, scope)` | copia sul ramo con la nuova identità |
| `pruneMinisterMemory(memory, cutoff)` | pota i ricordi oltre il punto di rewind |

## 3. La selezione per il prompt

Deterministica, locale, **senza LLM**. Priorità dei generi:
`proposal-rejected` → `queued-decision` → `verified-outcome` → `open-question` →
`objective` → `proposal-discussed`; a parità, i **più recenti**. Il limite
(`MINISTER_MEMORY_LIMIT = 40` conservati, sintesi a `limit = 8`) evita di
reinviare tutta la cronologia.

Il blocco prodotto da `memorySection` è esplicito sul confine:

```
MEMORIA DELLA SEDUTA (non è una seconda contabilità: non contiene cifre nuove; se un ricordo
contrasta con i fatti aggiornati qui sopra, vincono i fatti aggiornati):
- [respinta · respinta] Copertura dell'ospedale — motivo: la distinta non è coperta (turno 4, messaggio tesoro#2, 1951-03-01)
- [accodata · accodata] Rimborso dei titoli in scadenza (ordine o1, 1951-03-02)
Usa la memoria per non ripeterti e per ricordare gli impegni già presi: non è una richiesta nuova.
```

`briefingFor(address, agenda, memory?)` in `MinisterChat.ts` include il blocco —
**solo se non vuoto**. Il parametro è opzionale: i chiamanti esistenti (e la
suite UX-02/03/04) restano invariati; senza memoria il briefing è identico a
prima (test difeso). L'ordine del prompt è quello richiesto dalla roadmap:
**profilo → regole → fatti aggiornati → memoria → scambi recenti** (la cronologia
resta il `history` già inviato dalla chat).

## 4. Fork e rewind

- **Fork** — `forkMinisterMemory(memory, scope)`: i ricordi si portano con sé,
  l'identità cambia (nuovo `branchId`). Nessuna riscrittura: il passato è passato.
- **Rewind/rollback** — `pruneMinisterMemory(memory, { turn?, gameDate? })`: si
  **potano** i ricordi oltre il punto di ripristino. Il taglio usa il turno quando
  c'è, altrimenti la data ISO. «Una decisione futura non deve comparire nel passato.»

Entrambe sono funzioni pure e coperte da test (vedi §8).

## 5. La tappa intermedia nel browser (dichiarata)

Prima che l'innesto fosse autorizzato (§6), per non lasciare la fase senza nulla
di funzionante, gli **stessi ricordi** vivevano anche lato client, nel modulo
`frontend/src/components/Game/ministerMemory.ts`. Con l'innesto eseguito il
client **resta** come rete immediata/offline e come sorgente dei ricordi da
inviare, mentre la persistenza vera è server-side:

- derivati dagli **eventi espliciti** della seduta: una proposta confrontata
  (`discussedProposal`), un atto accodato (`queuedDecision`), una seduta chiusa
  senza ordine (`openQuestion`);
- persistiti in `localStorage` con chiave `ws:minister-memory:<gameId>`, **per
  partita** e per sedia;
- potati alla data corrente (`pruneMemoryByDate`) per il rewind;
- inviati **con** la richiesta al ministro (`MinisterChat` → `api.askStream`,
  campo `memory`), così il server li valida, ne deriva il mandato e li persiste:
  il testo mostrato nella chat non cambia.

Il fascicolo della sedia mostra «Cosa ricorda il ministro» (`SeatBrief`), con la
nota sulla natura della memoria.

> **Questa tappa non sostituisce la persistenza server-side** (task §5): è tenuta
> **nel browser** e non sopravvive a un'altra macchina. Con l'innesto di §6 le due
> convivono: il client invia, il server scrive/legge/pota. Resta scoperto solo il
> respingimento strutturato dal modello (§6.6).

## 6. L'innesto: **eseguito** (autorizzato con «scelta A»)

La persistenza server-side è stata realizzata toccando schema e repository nella
forma **strettamente additiva** autorizzata: tabella nuova, nessuna migrazione dei
dati esistenti, nessun riferimento al mondo. Con memoria vuota ogni punto di
aggancio è un **no-op**: i flussi esistenti restano identici (suite verdi).

- Commit dell'innesto: `c06dc22` (feat) + `a1265cb` (test), sul branch
  `feat/ws-minister-ux-05-memoria-persistente`.

### 6.1 Schema — `backend-nest/src/database.ts` *(eseguito)*

La tabella **isolata** è stata creata accanto alle altre `CREATE TABLE IF NOT
EXISTS`, senza colonne di riferimento al mondo (righe ~865–882):

```sql
CREATE TABLE IF NOT EXISTS minister_memory (
  game_id     TEXT NOT NULL,
  branch_id   TEXT NOT NULL DEFAULT '',   -- '' = ramo principale (SQLite: NULL romperebbe la PK)
  seat        TEXT NOT NULL,
  mandate     TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  state       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  reason      TEXT,
  refs_json   TEXT NOT NULL,
  record_date TEXT NOT NULL,
  record_turn INTEGER,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, branch_id, seat, mandate, record_id)
);
CREATE INDEX IF NOT EXISTS idx_minister_memory_scope
  ON minister_memory (game_id, branch_id, seat, mandate);
```

### 6.2 Repository — `backend-nest/src/repositories/minister-memory.repository.ts` *(eseguito)*

Il file è stato creato con le firme previste, più `listBranch` (lettura dell'intero
ramo, usata da fork/potatura e dai test). I ritorni sono i conteggi delle righe
scritte/cancellate, non `void`:

```ts
listMemory(scope: MinisterMemoryScope): MinisterMemoryRecord[];
listBranch(scope: MinisterMemoryBranchScope): MinisterMemoryRecord[];
upsertRecords(scope: MinisterMemoryScope, records: readonly MinisterMemoryRecord[]): number; // INSERT … ON CONFLICT DO UPDATE
forkMemory(scope: MinisterMemoryBranchScope, toBranchId: string): number;                      // INSERT OR IGNORE … SELECT
pruneAfter(scope: MinisterMemoryBranchScope, cutoff: { turn?: number; gameDate?: string }): number; // DELETE
deleteGameMemory(gameId: string): number;
```

`null` (ramo principale) è memorizzato come `''` per non rompere la PK. Export
aggiunto in `src/repositories/index.ts` (una riga + i due tipi).

### 6.3 Punti di aggancio *(eseguiti)*

| Punto | File | Modifica eseguita |
|---|---|---|
| **Lettura** nel prompt | `game-session.ts` — `ministerPromptFor` (~3369) e nuovo `ministerMemoryFor` (~3361) | legge la memoria con mandato derivato server-side e la passa a `briefingFor` |
| **Trasporto** | `game-session.ts` — `ministerPromptFor` | la memoria viaggia *dentro* il percorso esistente; nessuna firma pubblica cambiata |
| **Scrittura** | `routes/games/advisor.routes.ts` (**non** frozen) — `persistMinisterMemory` | valida con `normalizeMinisterMemory` e `upsertRecords` **prima** della risposta (POST e stream) |
| **Fork** | `repositories/game.repository.ts::createBranch` | dopo l'INSERT/UPDATE, `forkMemory` dal ramo di partenza (SIDECAR) |
| **Rewind** | `game.repository.ts::deleteAfterTurn` | dopo le DELETE, `pruneAfter` (turno ripristinato + data corrente) (SIDECAR) |
| **Cancellazione** | percorso `deleteGame` | **nessun call site esiste** (vedi §6.4) |

L'identità `mandate` è derivata **server-side** dal governo in carica con
`mandateFor(seat, government, polityId)` → `<seat>@<polity>:<dominante|council>`:
il client non decide mai l'identità. La rotta la ricalcola da `getGovernment()` /
`getPlayer()`, e la lettura fa lo stesso.

### 6.4 STOP dichiarato: **nessuno**

Nessuna logica di `createBranch` / `deleteAfterTurn` è stata alterata: ai due
punti è stata **solo aggiunta una chiamata dopo** l'operazione esistente, il cui
valore di ritorno non è usato. `GameSession` non ha cambiato firme pubbliche:
`ministerMemoryFor` è privato e la lettura viaggia dentro `ministerPromptFor`.
Con memoria vuota i due SIDECAR non fanno nulla, quindi il criterio di
legittimità (stessi test, stesse uscite) regge.

**Unico call site mancante**: non esiste alcun percorso `deleteGame` nel codice,
quindi `deleteGameMemory` non ha chiamante. È una funzione pronta per la
cancellazione della partita, non un comportamento promesso: dichiarato in §10.

### 6.5 Prove dell'innesto

`backend-nest/tests/ws-minister-ux-05-graft.test.ts` (8 test, database vero):

1. **Rewind** — un ricordo del turno 3 non compare più dopo
   `deleteAfterTurn(gameId, 0)`; quello del turno 1 resta;
2. **Fork** — `createBranch` copia la memoria sul figlio con la nuova identità
   di ramo, il padre la conserva, e una scrittura sul figlio non tocca il padre;
3. **Scope** — partita/ramo/sedia/mandato isolano i ricordi; l'upsert è
   idempotente per `record_id`;
4. **Memoria vuota** — `ministerMemoryFor` torna vuoto e le suite esistenti
   (UX-02/03/04 e il resto) restano verdi;
5. **Validazione** — genere/stato fuori vocabolario scartano il ricordo; il
   mandato deriva da governo+polity.

### 6.6 Cosa resta aperto (ora più stretto)

1. ~~persistenza **server-side**~~ → **eseguita**;
2. ~~isolamento per **ramo** a livello di storage e copia al fork~~ → **eseguito**;
3. ~~potatura al **rewind** lato server~~ → **eseguita**;
4. **respingimento strutturato** (una proposta respinta *con motivo* registrata
   dal modello): richiede un protocollo strutturato (come la direttiva `tavola`
   di UX-03, esteso a un `memoria` event) che il modello emette e l'innesto
   persiste. Ancora aperto;
5. **`deleteGameMemory`**: implementato ma senza call site (nessun `deleteGame`).

## 7. File

### Nuovi
| File | Ruolo |
|---|---|
| `backend-nest/src/core/government/MinisterMemory.ts` | contratto e motore puri della memoria (+ `mandateFor`, `normalizeMinisterMemory`) |
| `backend-nest/src/repositories/minister-memory.repository.ts` | persistenza reale: list/upsert/fork/prune/delete |
| `backend-nest/tests/ws-minister-ux-05.test.ts` | 15 test puri (contratto, selezione, prompt, fork/rewind, isolamento, briefing) |
| `backend-nest/tests/ws-minister-ux-05-graft.test.ts` | 8 test dell'innesto (repository, fork, rewind, memoria vuota) |
| `frontend/src/components/Game/ministerMemory.ts` | tappa intermedia: derivazione, sintesi, persistenza browser |
| `frontend/src/components/Game/ministerMemory.test.ts` | 13 test puri (derivazione, selezione, rewind, persistenza, isolamento) |
| `frontend/src/components/Game/seatBriefMemory.test.tsx` | 3 test di render del fascicolo con la memoria |
| `e2e/ux05-shot.mjs` | harness screenshot (memoria della sedia) |
| `docs/implementation/assets/ws-minister-ux-05/` | screenshot a 1440×900, 1024×768, 390×844 |

### Modificati
| File | Cosa |
|---|---|
| `backend-nest/src/database.ts` | tabella additiva `minister_memory` + indice (innesto) |
| `backend-nest/src/repositories/index.ts` | export del repository e dei due scope |
| `backend-nest/src/repositories/game.repository.ts` | SIDECAR `forkMemory` in `createBranch`, `pruneAfter` in `deleteAfterTurn` |
| `backend-nest/src/game-session.ts` | `ministerMemoryFor` (mandato server-side) + lettura in `ministerPromptFor` |
| `backend-nest/src/routes/games/advisor.routes.ts` | `persistMinisterMemory` prima della risposta (POST e stream) |
| `backend-nest/src/routes/games/schemas.ts` | `memory` opzionale nello `advisorSchema` |
| `backend-nest/src/core/government/MinisterChat.ts` | `briefingFor(address, agenda, memory?)` + sezione `MEMORIA DELLA SEDUTA` |
| `frontend/src/services/api.ts` | `MinisterMemoryItem`; `ask`/`askStream` inviano `memory` |
| `frontend/src/components/Game/GovernmentOffice.tsx` | stato memoria per partita, eventi → ricordi, passaggio a fascicolo e chat |
| `frontend/src/components/Game/MinisterChat.tsx` | invia i ricordi con la richiesta (il testo mostrato non cambia) |
| `frontend/src/components/Game/SeatBrief.tsx` | sezione «Cosa ricorda il ministro» |
| `frontend/src/editorial.css` | stili della memoria nel fascicolo |
| `e2e/tests/modules.spec.mjs` | nuovo **P04e**: memoria che sopravvive a cambio ministro e ricarica |

## 8. Test ed esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **205 file / 2154 test** verdi (baseline UX-04 203/2131; +16 test puri UX-05, +8 test dell'innesto) |
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **117 file / 980 test** verdi (baseline 115/964 → +2 file / +16 test) |
| `npm run build` (backend) | build ok |
| `npm run build` (frontend) | build ok |
| E2E `modules.spec.mjs` (mock) | **10/10**, incluso **P04e** |
| Screenshot 1440×900 / 1024×768 / 390×844 | `e2e/ux05-shot.mjs`, tutti prodotti |

I test dell'accettazione:

1. **Persistenza** — P04e (browser) e `ws-minister-ux-05-graft.test.ts` (database):
   i ricordi sopravvivono a cambio ministro, ricarica del browser e riavvio del
   server. La persistenza server-side è **eseguita** (§6).
2. **Isolamento** — `ministerMemory.test.ts` «due partite non si scambiano
   ricordi», `ws-minister-ux-05.test.ts` «due partite restano isolate», e
   l'innesto per ramo (§6.5, fork).
3. **Rewind** — `pruneMinisterMemory` / `pruneMemoryByDate` (puri) e
   `deleteAfterTurn` che pota il ramo (innesto).
4. **Respingimento** — il contratto e il fascicolo mostrano una respinta **con il
   motivo**, distinta da «discussa» e da «accodata»; la registrazione *strutturata*
   dal modello resta aperta (§6.6).
5. **Invarianti** — suite backend e frontend verdi, `tsc` pulito, build ok;
   con memoria vuota i SIDECAR sono no-op (criterio di legittimità, §6.4).

Verifica DOM sul percorso mock (1440×900): 3 ricordi (1 `accodata`, 2 `discusse`),
chiave `ws:minister-memory:mock-game-1`, **nessun overflow** orizzontale nel
pannello del dialogo.

## 9. Verifica visiva

`docs/implementation/assets/ws-minister-ux-05/ux05-*-memoria.png`: il fascicolo
aperto su «Cosa ricorda il ministro», con l'atto accodato e le proposte discusse,
la provenienza e la nota sulla natura di tappa intermedia, a desktop, tablet e mobile.

## 10. Limiti residui

- **Respingimento strutturato**: supportato dal contratto e mostrato, ma non
  ancora *prodotto* dal modello (serve il protocollo `memoria`, §6.6).
- **`deleteGameMemory`**: implementato, ma **senza call site** — nel progetto non
  esiste un percorso `deleteGame`. Pronto per quando esisterà.
- **Mandato**: nel client resta il `label` della sedia; il mandato-identità reale
  è derivato **server-side** in scrittura e in lettura (§6.3).
- **Cache browser**: la tappa intermedia resta e non sostituisce la persistenza
  server-side; le due convivono (il client invia i ricordi, il server li persiste).
- Igiene preesistente: `dist/**/*.test.js` (copie compilate non versionate) vanno
  rimosse prima di `vitest`, altrimenti falliscono per `require('vitest')` in
  CommonJS.

## 11. Freeze e classificazione A/B/C/D/E

Il freeze del motore è **intatto**: nessuna riga sotto `core/simulation/**`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`; **nessuna
migrazione e nessuna trasformazione dei dati esistenti**. I file `GameSession` e
`game.repository.ts` sono stati toccati **solo** nella forma autorizzata
dall'innesto (una lettura + due SIDECAR dopo le operazioni esistenti, §6.3–§6.4).

- **A** — contratto e motore della memoria (`MinisterMemory.ts`, `MinisterChat.ts`),
  l'innesto di persistenza (repository, tabella, hook) e la tappa intermedia + resa
  (`ministerMemory.ts`, `GovernmentOffice.tsx`, `MinisterChat.tsx`, `SeatBrief.tsx`,
  `api.ts`, `editorial.css`).
- **B** — harness e E2E: `e2e/ux05-shot.mjs`, `e2e/tests/modules.spec.mjs` (P04e).
- **C** — test: `ws-minister-ux-05.test.ts`, `ws-minister-ux-05-graft.test.ts`,
  `ministerMemory.test.ts`, `seatBriefMemory.test.tsx`.
- **D** — questo report e gli screenshot.
- **E** — *nessuna*. La tabella è `CREATE TABLE IF NOT EXISTS`: additiva, non una
  migrazione. Nessun dato esistente è stato toccato.

---

**Prossimo passo del piano**: **WS-MINISTER-UX-06** (dalla proposta alla decisione
del Presidente), che chiuderà il flusso proposta → confronto → atto → registro →
esito. L'innesto di persistenza di §6 è **eseguito**; resta aperto solo il
respingimento strutturato (§6.6).
