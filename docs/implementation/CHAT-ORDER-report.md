# REPORT — CHAT-ORDER (i messaggi delle chat devono seguire la timeline del mondo)

Base: `main` = `59b353b` (MATERIEL-CLARITY merged). Segnalazione (screenshot di Andrea):
chat con l'**Impero d'Austria**, turno 4, 08/09/1815 — la nota austriaca e «Arrendetevi» fuori
sequenza nel thread.

---

## 1. FASE 1 — Diagnosi (riproduzione del disordine + causa)

### 1.1 Il caso dello screenshot, riga per riga (DB reale `backend-nest/data/open-pax.db`)

```
rowid | chat_id      | ruolo  | contenuto                                | turno | game_date
230   | 64234ebc3a9d | polity | «Avete aggredito la presidenza che vi ha…»| 3     | 1815-09-08
231   | 64234ebc3a9d | player | «Arrendetevi»                             | 4     | 1815-09-08
232   | 64234ebc3a9d | polity | «Alla voce ufficiale della Confederazione…»| 4    | 1815-09-08
```

Il server li restituisce **già giusti** (`chat.repository.ts getMessages`:
`SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC`), e il client
li riceve in quell'ordine. Quindi il disordine nasce **dopo**: la nota del turno 3 veniva
**consegnata in ritardo** rispetto allo scambio del turno 4 e il client la accodava.

### 1.2 I tre percorsi di scrittura del thread (`frontend/src/stores/chatStore.ts`)

| percorso | dove | come scriveva | ordine risultante |
|---|---|---|---|
| `setMessages` (riga 60) | `ChatsPanel` a chat aperta (riga 133) e riunione (riga 149) | sostituiva l'elenco | quello del server |
| `appendMessage` (riga ~75) | invio del giocatore, risposta della politia, «Prosegui dialogo» | `[...existing, message]`, cioè **in coda** | ordine di arrivo |
| `handleIncomingChatMessage` (riga ~150) | SSE `chat_message` (`useSimulationStream.ts:186`) | `[...existing, message]`, cioè **in coda** | ordine di arrivo |

**Nessuno dei tre ordinava.** Con una consegna fuori sequenza (SSE in ritardo, risposta locale
dopo un evento già arrivato) il messaggio finiva in fondo, anche se apparteneva a un turno
precedente: è esattamente lo screenshot.

### 1.3 Perché l'ordine di arrivo può differire da quello del mondo (evidenza)

- **SSE non ritrasmissibile**: `chat_message` è *fire-and-forget*, non passa dall'`simulation_outbox`
  (a differenza di `world_event`, che è at-least-once al rientro) → una notifica persa/in ritardo
  non ha garanzia d'ordine né recupero.
- **Inserimenti fuori sequenza nel DB** (non solo consegna): su 165 messaggi / 84 chat,
  **3 chat** contengono inversioni di data all'inserimento (8 eventi in totale; es.
  `66a43ccac03c`: i rowid 102-108 hanno `game_date` gennaio-marzo, inseriti dopo i turni
  7-9 di febbraio-aprile).
- **Nessuna collisione di `created_at`**: 165 messaggi, 165 `created_at` distinti, nessun
  `game_date`/`created_at` mancante → il timestamp del server non è ambiguo, ma **non è la
  timeline del mondo** (è il momento di scrittura, influenzato dai ritardi).

### 1.4 Qual è la chiave d'ordinamento corretta (verificata sui dati)

| candidata | verdetto | evidenza |
|---|---|---|
| ordine di arrivo (`rowid`) | **NO** | 3 chat con inversioni di data all'inserimento |
| solo `created_at` | **NO** | è il momento di scrittura: un messaggio vecchio consegnato tardi ha `created_at` più alto |
| solo `turn` | **NO** | 3 messaggi hanno **lo stesso turno con date diverse**; 2 casi hanno **data che cresce e turno che cala** (turno 1 datato 31/01) |
| solo `game_date` | **NO** | il caso dello screenshot: tre messaggi con lo **stesso giorno** e tre turni diversi (3, 4, 4) → la data da sola non li ordina |
| `(game_date, turn, seq)` | **SÌ** | invariante verificata: **0** casi in cui, nello stesso giorno, il turno decresce all'aumentare del `rowid` |

Dettaglio delle violazioni misurate:

```
stesso giorno → turno che diminuisce con rowid : 0   (chiave coerente)
stesso turno con date diverse                 : 3   (il turno da solo non basta)
data crescente con turno decrescente           : 2   (il turno non può essere primario)
game_date/created_at mancanti                  : 0   (165/165 presenti)
```

**Chiave scelta**: `gameDate` (fonte primaria: la timeline del mondo) → `turn` (più fine dello
stesso giorno) → `seq` (**sequenza di inserimento del server**, tie-breaker stabile) →
`createdAt` (solo se `seq` manca: payload vecchi) → `id` (determinismo finale). Mai il timestamp
locale, mai l'ordine di arrivo.

---

## 2. Intervento minimo

**Una sola funzione pura lato client, applicata dopo ogni scrittura** — nessun secondo stato,
nessuna copia del thread, nessun ordinamento nel motore.

- **Server (classe B, nessuna migrazione)**: il tie-breaker `seq` è il `rowid` **che già esiste**.
  - `chat.repository.ts`: `ChatMessageRecord.seq?`, `rowToMessage` legge `row.seq`,
    `getMessages` → `SELECT *, rowid AS seq …`, `addMessage` restituisce
    `seq: Number(info.lastInsertRowid)`. La sequenza esposta è **la stessa** con cui il server
    ordina (`ORDER BY created_at ASC, rowid ASC`), quindi client e server non possono divergere.
  - `routes/chats.routes.ts`: `messagePayload` espone `seq` (`null` quando assente, per i payload
    vecchi). L'evento SSE porta il record completo → `seq` viaggia già con il messaggio.
- **Client**: `chatTimeline.ts` guadagna tre funzioni pure
  - `chatMessageOrderKey(message)` → tupla comparabile (ordine delle chiavi documentato sopra);
  - `orderChatMessages(messages)` → **non muta l'input**, deterministico (l'ordinatore riapplicato
    su un elenco già ordinato lo lascia identico);
  - `lastChatMessage(messages)` → l'ultimo **della timeline**;
  - `compareChatMessages(a, b)` esposta per i test.
- **Applicazione nei tre percorsi** (`chatStore.ts`):
  - `setMessages` → `orderChatMessages(messages)`;
  - `appendMessage` → `orderChatMessages([...existing, message])`: un messaggio vecchio arrivato in
    ritardo va **nella sua posizione**;
  - `handleIncomingChatMessage` (SSE) → stesso ordinatore;
  - `lastMessage`/`lastMessageAt`/`lastMessageGameDate` dell'elenco chat derivano dall'**ultimo
    della timeline**, non dall'ultimo arrivato (la deduplica per `id` e la logica dei non letti
    restano invariate).
- **Contratto**: `ChatMessageData.seq?: number | null` in `services/api.ts`.

## 3. File modificati

| file | modifica |
|---|---|
| `backend-nest/src/repositories/chat.repository.ts` | `seq` nel record, `rowid AS seq` in `getMessages`, `seq` da `lastInsertRowid` in `addMessage` |
| `backend-nest/src/routes/chats.routes.ts` | `messagePayload` espone `seq` (esportata per il test) |
| `backend-nest/tests/chats.test.ts` | +2 test: sequenza esposta e uguale ai `rowid`, payload di rotta, `seq` via SSE |
| `frontend/src/components/Game/chatTimeline.ts` | +`orderChatMessages`, `compareChatMessages`, `lastChatMessage`, `chatMessageOrderKey` |
| `frontend/src/components/Game/chatTimeline.test.ts` | +10 test sull'ordinatore |
| `frontend/src/stores/chatStore.ts` | ordinatore applicato nei tre percorsi; ultimo messaggio dalla timeline |
| `frontend/src/stores/chatStore.test.ts` | **nuovo**, 9 test sui tre percorsi (fetch, invio, SSE) |
| `frontend/src/services/api.ts` | `ChatMessageData.seq` |
| `e2e/tests/chat-order.spec.mjs` | **nuovo**, 2 test nel browser con messaggi consegnati in ordine sbagliato |

## 4. CORE ENGINE FREEZE

**Nessuna modifica al motore.** Non toccati `core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema/DB, `repositories`
(esclusi i due file chat elencati, che sono il percorso di lettura/scrittura dei messaggi),
semantica di checkpoint, playback, pipeline di avanzamento. Nessuna migrazione, nessuna colonna
nuova, nessun endpoint nuovo: il `seq` è il `rowid` già presente.

## 5. Test eseguiti (esito reale)

| suite | prima | dopo |
|---|---|---|
| backend `vitest run` | 139 file / 1189 | **139 file / 1191** ✅ |
| frontend `vitest run` | 53 file / 354 | **54 file / 373** ✅ |
| e2e mock (`playwright test`) | 30 | **32** ✅ |
| `tsc --noEmit` backend / frontend | — | **0 errori** ✅ |
| build frontend / backend | — | **OK** ✅ |

Test che coprono la segnalazione:
- `chatStore.test.ts` — «un messaggio VECCHIO arrivato in ritardo va nella sua posizione, non in
  coda» e «il percorso SSE produce lo stesso ordine del fetch», con i **tre messaggi reali** della
  chat austriaca (`seq` 230/231/232);
- `chatTimeline.test.ts` — stessa data/turno con tie-breaker `seq`, determinismo (due esecuzioni e
  input invertito), non mutazione, fallback senza `seq`, messaggi senza data in fondo;
- `chats.test.ts` — `seq` uguale ai `rowid` del DB, presente nel payload di rotta e nell'evento SSE;
- e2e — con il mock che consegna i messaggi in ordine sbagliato, il DOM mostra
  `nota turno 3 → «Arrendetevi» → risposta turno 4` e l'intestazione del thread indica la data del
  messaggio più recente (8 set 1815), non quella dell'ultimo consegnato.

## 6. Limiti

- **`chat_message` non è durevole in `simulation_outbox`**: una notifica SSE persa durante
  un'assenza **non viene ritrasmessa** al rientro. L'ordine ora è corretto, ma un messaggio
  potrebbe non arrivare affatto finché non si riapre la chat (che rilegge dal server, ordinato).
  Rendere l'evento at-least-once è un intervento separato (outbox), non necessario per l'ordine.
- **Il momento esatto di consegna non è ricostruibile** a posteriori: `created_at` è il timestamp di
  scrittura, non quello di consegna. Per questo l'ordinamento non lo usa come chiave primaria.
- **`lastMessage` dell'elenco chat dal server** (payload `ChatSummary`) resta calcolato
  sull'inserimento: finché l'elenco non viene riletto dopo un caricamento thread, la riga di
  anteprima può mostrare il testo del messaggio inserito per ultimo. Nel thread (dove si legge la
  conversazione) l'ordine e l'ultimo messaggio sono quelli della timeline.
- **Turni/dati incoerenti già nel DB** (i 2 casi «data cresce, turno cala»): vengono ordinati per
  data, che è la chiave scelta; l'anomalia resta visibile nei dati storici e non è stata
  corretta a monte (sarebbe una riscrittura di `chat_messages`).
