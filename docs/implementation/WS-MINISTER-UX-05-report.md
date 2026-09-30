# WS-MINISTER-UX-05 — Memoria persistente del ministro

> Il ministro non deve più «dimenticare» una proposta respinta, un obiettivo
> esplicitato dal Presidente o una decisione accodata. Questa fase consegna il
> **contratto** della memoria e il suo **motore puro** (registrazione, selezione
> per il prompt, copia al fork, potatura al rewind). La **persistenza reale**
> ricade sotto il CORE ENGINE FREEZE: è stata **fermata** e l'innesto preciso è
> documentato in §6. La tappa intermedia nel browser è dichiarata in §5 e **non**
> sostituisce l'innesto.

- **Branch**: `feat/ws-minister-ux-05-memoria-persistente`, base `main` @ `25a9d89`
  (PR #147 — UX-04 — mergiata) + il commit `4cf03e8` con il task di questa fase.
- **Task**: `docs/roadmaps/task-ws-minister-ux-05.md`.
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fase UX-05.
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3 (conversazione /
  evidenze / ordini / memoria sono oggetti distinti), `WS-MINISTER-UX-01-report.md`,
  `WS-MINISTER-UX-02-report.md` (profilo e voce), `WS-MINISTER-UX-03-report.md`
  (direttive), `WS-MINISTER-UX-04-report.md` (conseguenze).
- **Freeze rispettato**: nessuna modifica a `core/simulation/**`, `GameSession`,
  `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema o
  repository. Il punto è dichiarato in §6.
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

Il freeze impedisce la persistenza reale (§6). Per non lasciare la fase senza
nulla di funzionante, gli **stessi ricordi** vivono anche lato client, nel modulo
`frontend/src/components/Game/ministerMemory.ts`:

- derivati dagli **eventi espliciti** della seduta: una proposta confrontata
  (`discussedProposal`), un atto accodato (`queuedDecision`), una seduta chiusa
  senza ordine (`openQuestion`);
- persistiti in `localStorage` con chiave `ws:minister-memory:<gameId>`, **per
  partita** e per sedia;
- potati alla data corrente (`pruneMemoryByDate`) per il rewind;
- composti con lo stesso confine (`memorySection`) e inviati **prima della
  domanda** al ministro (`MinisterChat` → `memoryPrompt`), così il modello li usa
  senza che il testo mostrato cambi.

Il fascicolo della sedia mostra «Cosa ricorda il ministro» (`SeatBrief`), con la
nota esplicita che la memoria definitiva richiede l'innesto backend.

> **Questa tappa non soddisfa la fase come soluzione finale** (task §5): è tenuta
> **nel browser**, non sopravvive a un'altra macchina, non è isolata per ramo a
> livello di storage e non copre il respingimento strutturato. È utile, ma resta
> un ponte verso l'innesto di §6.

## 6. L'esito sull'innesto: **bloccato dal freeze** (innesto necessario)

La persistenza reale richiede di toccare schema e repository, vietati dal freeze.
**Mi sono fermato su quella parte.** Ecco l'innesto preciso, pronto per un
intervento successivo autorizzato.

### 6.1 Schema — `backend-nest/src/database.ts`

Accanto alle altre `CREATE TABLE IF NOT EXISTS`, una tabella **isolata** (nessun
riferimento al mondo):

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

### 6.2 Repository — **nuovo** file `backend-nest/src/repositories/minister-memory.repository.ts`

```ts
listMemory(scope: MinisterMemoryScope): MinisterMemoryRecord[];
upsertRecords(scope: MinisterMemoryScope, records: readonly MinisterMemoryRecord[]): void; // INSERT … ON CONFLICT DO UPDATE
forkMemory(scope: MinisterMemoryScope, toBranchId: string): void;                          // INSERT … SELECT su branch_id nuovo
pruneAfter(scope: MinisterMemoryScope, cutoff: { turn?: number; gameDate?: string }): number; // DELETE
deleteGameMemory(gameId: string): void;                                                     // pulizia
```

Da esportare in `src/repositories/index.ts` (una riga).

### 6.3 Punti di aggancio (i file **frozen** che lo richiedono)

| Punto | File (frozen) | Modifica necessaria |
|---|---|---|
| **Lettura** nel prompt | `game-session.ts::ministerPromptFor` (~`3361`) e `ministerPrompt` (~`3376`) | `briefingFor(address, agenda, ministerMemoryRepository.listMemory(scope))` |
| **Trasporto** | `game-session.ts::getMinisterReply` / `getMinisterStream` | parametro opzionale `memory?: MinisterMemory` da passare a `ministerPromptFor` |
| **Scrittura** | `routes/games/advisor.routes.ts` (**non** frozen) | accettare `memory` nel body, validarlo e `upsertRecords` dopo la risposta; oppure rotta dedicata `POST /:id/government/minister/:seat/memory` |
| **Fork** | `repositories/game.repository.ts::createBranch` (frozen) | dopo la creazione del ramo, `forkMemory(scope, toBranchId)` |
| **Rewind** | `game.repository.ts::deleteAfterTurn` + percorso di restore (frozen) | `pruneAfter(scope, cutoff)` |
| **Cancellazione** | percorso `deleteGame` (frozen) | `deleteGameMemory(gameId)` |

L'identità `mandate` va derivata **server-side** dal governo in carica (es.
`<seat>` + identificativo del mandato/governo), non dal `label` del client: è la
differenza fra «il Ministro del Tesoro» e «*quella* persona in *quel* mandato».

### 6.4 Cosa resta aperto finché l'innesto non è autorizzato

1. persistenza **server-side** (sopravvivenza a un'altra macchina, al
   riavvio del server e al cambio di browser);
2. isolamento per **ramo** a livello di storage e copia al fork;
3. potatura al **rewind** quando il rollback avviene lato server;
4. **respingimento strutturato** (una proposta respinta *con motivo* registrata
   dal modello): richiede un protocollo strutturato (come la direttiva `tavola`
   di UX-03, esteso a un `memoria` event) che il modello emette e l'innesto
   persiste.

## 7. File

### Nuovi
| File | Ruolo |
|---|---|
| `backend-nest/src/core/government/MinisterMemory.ts` | contratto e motore puri della memoria |
| `backend-nest/tests/ws-minister-ux-05.test.ts` | 15 test puri (contratto, selezione, prompt, fork/rewind, isolamento, briefing) |
| `frontend/src/components/Game/ministerMemory.ts` | tappa intermedia: derivazione, sintesi, persistenza browser |
| `frontend/src/components/Game/ministerMemory.test.ts` | 13 test puri (derivazione, selezione, rewind, persistenza, isolamento) |
| `frontend/src/components/Game/seatBriefMemory.test.tsx` | 3 test di render del fascicolo con la memoria |
| `e2e/ux05-shot.mjs` | harness screenshot (memoria della sedia) |
| `docs/implementation/assets/ws-minister-ux-05/` | screenshot a 1440×900, 1024×768, 390×844 |

### Modificati
| File | Cosa |
|---|---|
| `backend-nest/src/core/government/MinisterChat.ts` | `briefingFor(address, agenda, memory?)` + sezione `MEMORIA DELLA SEDUTA` |
| `frontend/src/components/Game/GovernmentOffice.tsx` | stato memoria per partita, eventi → ricordi, passaggio a fascicolo e chat |
| `frontend/src/components/Game/MinisterChat.tsx` | `memoryPrompt` inviato prima della domanda (il testo mostrato non cambia) |
| `frontend/src/components/Game/SeatBrief.tsx` | sezione «Cosa ricorda il ministro» |
| `frontend/src/editorial.css` | stili della memoria nel fascicolo |
| `e2e/tests/modules.spec.mjs` | nuovo **P04e**: memoria che sopravvive a cambio ministro e ricarica |

## 8. Test ed esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **204 file / 2146 test** verdi (baseline UX-04 203/2131 → +1 file / +15 test) |
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **117 file / 980 test** verdi (baseline 115/964 → +2 file / +16 test) |
| `npm run build` (frontend) | build ok |
| E2E `modules.spec.mjs` (mock) | **10/10**, incluso **P04e** |
| Screenshot 1440×900 / 1024×768 / 390×844 | `e2e/ux05-shot.mjs`, tutti prodotti |

I test dell'accettazione:

1. **Persistenza** — P04e: un atto accodato e una proposta discussa compaiono nel
   fascicolo dopo cambio ministro e dopo **ricarica del browser** (tappa
   intermedia). La persistenza server-side resta aperta (§6).
2. **Isolamento** — `ministerMemory.test.ts` «due partite non si scambiano
   ricordi» e `ws-minister-ux-05.test.ts` «due partite restano isolate».
3. **Rewind** — `pruneMinisterMemory` / `pruneMemoryByDate`: un rollback pota i
   ricordi del futuro (per turno e per data).
4. **Respingimento** — il contratto e il fascicolo mostrano una respinta **con il
   motivo**, distinta da «discussa» e da «accodata»; la registrazione *strutturata*
   dal modello attende l'innesto (§6.4).
5. **Invarianti** — suite backend e frontend verdi, `tsc` pulito, build ok.

Verifica DOM sul percorso mock (1440×900): 3 ricordi (1 `accodata`, 2 `discusse`),
chiave `ws:minister-memory:mock-game-1`, **nessun overflow** orizzontale nel
pannello del dialogo.

## 9. Verifica visiva

`docs/implementation/assets/ws-minister-ux-05/ux05-*-memoria.png`: il fascicolo
aperto su «Cosa ricorda il ministro», con l'atto accodato e le proposte discusse,
la provenienza e la nota sulla natura di tappa intermedia, a desktop, tablet e mobile.

## 10. Limiti residui

- **Persistenza server-side**: assente, bloccata dal freeze. Vedi §6 per l'innesto
  puntuale e §6.4 per ciò che resta aperto.
- **Respingimento strutturato**: supportato dal contratto e mostrato, ma non
  ancora *prodotto* dal modello (serve il protocollo `memoria`).
- **Mandato**: nel client è il `label` della sedia; il mandato-identità reale è
  server-side (§6.3).
- **Cache browser**: dichiarata come intermedia, non come soluzione finale.
- Igiene preesistente: `dist/**/*.test.js` (copie compilate non versionate) vanno
  rimosse prima di `vitest`, altrimenti falliscono per `require('vitest')` in
  CommonJS.

## 11. Freeze e classificazione A/B/C/D/E

Il freeze è **intatto**: nessuna riga sotto `core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema o
repository; nessuna migrazione, nessun motore nuovo.

- **A** — contratto e motore della memoria (`MinisterMemory.ts`, `MinisterChat.ts`)
  e la tappa intermedia + resa (`ministerMemory.ts`, `GovernmentOffice.tsx`,
  `MinisterChat.tsx`, `SeatBrief.tsx`, `editorial.css`).
- **B** — harness e E2E: `e2e/ux05-shot.mjs`, `e2e/tests/modules.spec.mjs` (P04e).
- **C** — test: `ws-minister-ux-05.test.ts`, `ministerMemory.test.ts`,
  `seatBriefMemory.test.tsx`.
- **D** — questo report e gli screenshot.
- **E** — *nessuna*. Nessuna migrazione: **l'innesto di persistenza è rimandato**
  (bloccato dal freeze), non eseguito.

---

**Prossimo passo del piano**: **WS-MINISTER-UX-06** (dalla proposta alla decisione
del Presidente), che chiuderà il flusso proposta → confronto → atto → registro →
esito. L'innesto di persistenza di §6 va autorizzato per chiudere UX-05 sul serio.
