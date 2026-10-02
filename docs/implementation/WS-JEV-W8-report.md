# WS-JEV-W8 — Metriche: telemetria, token reduction, latenza

## 1. Perimetro ed esito

Fase **W8**, ultima del piano JEV. Base `main@05301ec` (W1–W7 già in `main`),
ramo `feat/ws-jev-w8-metrics`.

Obiettivo: rendere JEV **misurabile** sul traffico reale — quante memorie sono
state considerate/selezionate/scartate, i token stimati prima e dopo, il rapporto
di compressione e le latenze di retrieval/consolidamento — **senza cambiare il
comportamento**. La telemetria è un effetto collaterale di sola lettura, mai un
input alle decisioni; `model_calls` resta **0** per costruzione.

Esito: implementata, verificata e consegnata come **sola PR verso `main`**
(nessun merge/deploy). Chiude la Definition of Done §7 («metriche token
prima/dopo») e alimenta il test di accettazione **B**.

## 2. File toccati (estensioni, nessun nuovo sistema)

| File | Intervento |
| --- | --- |
| `src/core/government/jev/jev-telemetry.ts` | **nuovo** modulo puro: `JevTelemetry` (spec §16 + `model_calls`), `estimateTokens`/`bytesToTokens` (byte/4, ceil), `compressionRatio`, `buildJevTelemetry`, `sumJevTelemetry` |
| `src/core/government/jev/jev-memory.service.ts` | campo additivo `metrics` su `JevMinisterRecall`, `DiplomaticMemoryResult`, `FactionMemoryResult`, `MinisterContextResult`, `JevConsolidationResult` e sul ritorno di `ingestJevBatch`; popolato dai retrieval W3/W4/W5/W6 e dal consolidamento W7 |
| `tests/ws-jev-w8-metrics.test.ts` | **15 test**: struttura, retrieval, ingestion, consolidamento, flag off, filtro gioco/ramo, accettazione B |

Nessun nuovo store, nessuna tabella, nessuna route. La telemetria è **derivata**:
riusa i conteggi/byte/latenze già calcolati dai retrieval esistenti.

## 3. Design

- **Stima token deterministica**: `token = ceil(byte UTF-8 / 4)`. Non è il
  conteggio di un tokenizer di provider: è stabile e ripetibile, adatta a
  confrontare *prima/dopo* (la convenzione JEV resta il byte come upper bound).
- **Popolamento senza cambiare le firme**: i retrieval mantengono la loro firma
  e il loro campo `telemetry` preesistente; si **aggiunge** `metrics`. Tutti i
  campi sono additivi, quindi retro-compatibili.
- **Sola lettura**: la telemetria legge gli stessi valori già in memoria
  (candidati, byte, id selezionati, latenza misurata) e non altera né testo, né
  ordinamento, né `touch`, né scritture.
- **Semantica dei contatori**:
  - retrieval: `considered = selected + deferred + dropped`; i non eleggibili
    (futuro, archiviate, superate) sono pre-filtrati da `eligibleOnly`, quindi lì
    `dropped = 0` e lo scarto vive in `deferred`.
  - consolidamento: `totale = considered + deferred + dropped`, con
    `considered = selected` (le grezze della finestra pronta entrano in episodio),
    `deferred` = fuori finestra, `dropped` = questioni aperte non consolidate.
  - ingestion: `selected` = KEEP, `deferred` = DEFER, `dropped` = DROP.
- **`contextTokensBefore`/`After`**: *before* = token della cronologia grezza
  eleggibile dello scope; *after* = token del contesto prodotto. `compressionRatio`
  = after/before (0 se before = 0).
- **Latenza**: `retrievalMs` attorno alle letture/selezioni reali,
  `consolidationMs` attorno al consolidamento.
- **Flag off**: ogni `metrics` è a zeri e le funzioni non toccano JEV (nessun
  `listMemory`/`listScopes`/`currentPoint`/`touch`/`find`/`upsert`/`archive`).
- **Nessun endpoint `GET /api/games/:id/memory/stats`**: il router debug di W1
  **non esiste** (nessuna route `memory*` è mai stata aperta), quindi per §3.4
  **non si aggiunge superficie nuova**. `sumJevTelemetry` resta una funzione pura
  a disposizione di consumatori/test.

## 4. Prove e gate

| Gate | Comando | Esito |
| --- | --- | --- |
| Focused W8 | `vitest run tests/ws-jev-w8-metrics.test.ts` | **15/15** |
| Compatibilità JEV W1–W8 | `vitest run tests/ws-jev-w{1..8}*.test.ts` | **132/132** |
| Backend completo | `npm --prefix backend-nest test` | **216 file / 2313 test** |
| Type-check backend | `tsc --noEmit` | exit 0 |
| Build backend | `npm run build` | exit 0 |

Log in `/tmp/jev-w8-gate/`. Nota: il full-suite locale va eseguito con `dist/`
assente (la build lascia `dist/**/*.test.js` che vitest raccoglie come falsi
fallimenti); la CI esegue i test **prima** della build. W8 è backend-only:
nessun frontend, nessun E2E mirato; l'E2E completo (160) resta l'ultimo gate del
blocco JEV.

### Accettazione B — numeri verificati

Scenario deterministico: 500 decisioni ministeriali + 200 di governo + 120 tra
fatti diplomatici e viste di percezione, su un DB temporaneo (`mkdtemp`), **mai**
`open-pax.db`.

| Misura | Valore verificato | Soglia |
| --- | --- | --- |
| Storia grezza totale | **252.370 token** (1.009.480 byte) | > 150.000 |
| `contextTokensBefore` (ministro, advisor) | **173.348 token** | — |
| Contesto **advisor** | **284 token** | < 6.000 |
| Contesto **ministro** | **236 token** | < 5.000 |
| Contesto **NPC diplomatico** | **795 token** | < 5.000 |
| `compressionRatio` (advisor) | **0,0016** | < 0,25 |

Il test **fallisce** se un budget viene sfondato (`toBeLessThan`); un test
dedicato (budget ministro enorme) dimostra che l'asserzione non è tautologica.

## 5. Revisione indipendente — rilievi e chiusure

Verdetto: **approve**, con warning chiusi in questa stessa tornata.

- **`memoriesDropped` sempre 0 nel retrieval** (warning): **chiarito** —
  `eligibleOnly` pre-filtra i non eleggibili; documentato nell'interfaccia.
  Inoltre il consolidamento ora **distingue** `deferred` (fuori finestra) da
  `dropped` (questioni aperte), con test dedicato.
- **Accettazione B poteva passare con contesto vuoto** (warning): **chiuso** —
  aggiunte asserzioni `memoriesSelected > 0` e token `> 0` per advisor, ministro
  e diplomatico.
- **Flag off: spy incomplete** (warning): **chiuso** — spiati anche
  `currentPoint`, `touch`, `find`, `upsert`, `archive`.
- **`DiplomaticMemorySection.rawBytes/rawCount` richiesti** (warning): **chiuso**
  — resi opzionali (cambio additivo).
- **Commento «troncato» vs `Math.round`** (suggestion): corretto.
- **`selectedLegacy` escludeva le questioni aperte** (suggestion): corretto —
  contate anche le righe finte in `unresolved`.
- **`sumJevTelemetry` usato solo dai test** (suggestion): documentato — nessun
  endpoint `/memory/stats` (router debug W1 assente).

## 6. Chiusura roadmap JEV

### Stato fasi W1–W8

| Fase | Contenuto | Stato |
| --- | --- | --- |
| **W1** | Storage `jev_memory`, repository, tipi, feature flag | ✅ in `main` |
| **W2** | Ingestion deterministica (KEEP/DEFER/DROP), zero LLM | ✅ in `main` |
| **W3** | Minister retrieval (estende `MinisterMemory`) | ✅ in `main` |
| **W4** | Context builder a sezioni, innesto nel `PromptBuilder` | ✅ in `main` |
| **W5** | Diplomazia: fatto condiviso (coppia ordinata) + viste direzionali | ✅ in `main` |
| **W6** | Fazioni interne: memoria narrativa nel briefing | ✅ in `main` |
| **W7** | Consolidation: episodi storici, archiviazione non distruttiva | ✅ in `main` |
| **W8** | Metriche: telemetria, token reduction, latenza | ✅ questa PR |

### Definition of Done §20

1. **Un ministro ricorda decisioni di decine di turni prima** — ✅ retrieval W3 +
   contesto W4, con `touch` di accesso.
2. **NPC diversi hanno memorie diverse** — ✅ scope `minister` (per sedia),
   `faction` (per fazione), `diplomacy`/`perception` (per coppia/osservatore).
3. **I numeri verificati vengono sempre dal motore** — ✅ `CURRENT VERIFIED STATE`
   è inserito integro dal motore; JEV non calcola né modifica numeri.
4. **Il contesto non cresce linearmente con la partita** — ✅ budget a sezioni
   (W4) + consolidamento in episodi (W7); il test B lo dimostra (173k→284 token).
5. **Una partita da centinaia di turni resta utilizzabile** — ✅ finestre fisse,
   archiviazione non distruttiva, contesti < 6k token.
6. **JEV si disabilita senza rompere il gioco** — ✅ flag off ⇒ prompt
   byte-identico e zero accessi JEV (test W4–W8).
7. **Esistono metriche token prima/dopo** — ✅ `JevTelemetry` (W8), esposta su
   ogni retrieval e sul consolidamento.
8. **`MinisterMemory` non è duplicato** — ✅ nessun secondo store: JEV estende
   `MinisterMemory` e usa lo stesso `jev_memory` per gli altri scope.
9. **Ogni query è filtrata per `branch_id`** — ✅ ogni lettura JEV filtra
   `game_id` **e** `branch_id`; test di isolamento per ramo e per gioco in W1,
   W5, W7, W8.

### Cosa resta fuori (non-goals §18)

Non implementati e deliberatamente esclusi: Rizzo Flow, vector DB esterno,
embeddings obbligatori, knowledge graph complesso, agenti autonomi, LLM che
modifica il world state, riscrittura del prompt system. Nessun endpoint UI per la
memoria: solo strumenti di sviluppo (e lo `stats` non è stato aperto perché il
router debug di W1 non esiste).

## 7. Limiti espliciti

- La stima token è `byte/4` (deterministica): utile al confronto, non è il
  conteggio del tokenizer di un provider.
- `contextTokensBefore` somma i byte del testo grezzo; il contesto *after*
  include il wrapper JSON delle righe: a fronte di memorie molto brevi il
  rapporto può avvicinarsi a 1 (non è un difetto, è il costo di citazione).
- `memoriesDropped` è popolato dall'ingestion e dal consolidamento; nel retrieval
  è 0 per costruzione (`eligibleOnly`).
- Nessun test con provider reale, multi-processo o partita reale: come W1–W7, la
  prova autorevole su Node 22 è la CI.
- Localmente il full-suite su Node 22 resta bloccato dal nativo `better-sqlite3`
  compilato per Node 26; il risultato Node 22 autorevole è quello della CI.

## 8. Consegna

- Ramo `feat/ws-jev-w8-metrics` — **sola PR verso `main`**, nessun merge/deploy.
- Nessuna scrittura su `main`, nessuna credenziale esposta, nessun tocco allo
  stato deterministico (solo letture; `touch` invariato).
