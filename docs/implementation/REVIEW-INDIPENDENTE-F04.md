# Revisione indipendente — F04 (Save/Load/Rewind e chat sicuri per ramo)

> Reviewer read-only sul codice consegnato; trascrizione fedele e verificabile.
> Revisore ≠ implementatore: la sessione di revisione non ha scritto le
> micro-consegne F04, si limita a verificarle e a correggere il difetto trovato.

## VERDETTO: **ACCETTABILE** (un difetto corretto in questa sede: M-1)

Il DoD «hash semantico dei sottosistemi restaurati uguale al checkpoint scelto»
e «una risposta tardiva non muta il ramo nuovo» è verificato da test e call
path. Il riesame ha trovato **un difetto reale e circoscritto** (M-1), corretto
con test rosso→verde.

## Perimetro verificato (F04 µ1–µ4)

| Audit | Invariante / DoD | Esito |
|---|---|---|
| A05/A08 (C12) | `content_hash` su save e checkpoint; restore legittimo → `session.semanticHash() === content_hash` scelto; snapshot manomesso → rifiuto **prima** di mutare la sessione (§9.4.1) | ✅ `semantic-hash.test.ts` (5); verifica post-restore presente |
| A05/A08 (C05/C08) | restore crea ramo figlio nella stessa transazione; head aggiornato; errore a metà → nessuna collezione/ramo mutati | ✅ `branch.test.ts` |
| A06/A08 (C17) | outbox del ramo abbandonato archiviato, mai ripubblicato | ✅ `branch.test.ts` (pending→published) |
| C17 | restore E1 dopo riavvio (sessione ricostruita dal DB) | ✅ `branch.test.ts` |
| A06/A08 (C08) | risposta tardiva con revisione/ramo cambiati → `ContextChangedError`, nessuna scrittura né broadcast | ✅ `chat-fence.test.ts` |
| A06 | chat durante un run (anche in pausa) → 409 esplicito, nessuna scrittura | ✅ `sendChatMessage` e advisor; **M-1** per `continueChat` |

Call path verificati: `GamePersistenceService.loadFromSave` (pre-validazione
hash → staging RAM → transazione unica → `archivePendingOutbox` →
`restoreEconomicSnapshot`), `game-session.rewind` (resta sul ramo corrente,
`loadFromSave` archivia comunque l'outbox), `assertFenceValid`
(`hasActiveRun()` **prima** del confronto ramo/revisione).

## Difetto trovato e corretto — M-1

**Sintomo.** `DiplomacyService.continueChat` («Lascia che parlino», route
`POST /:id/chats/:chatId/auto`) non applicava la politica 409 esplicita
all'inizio: con un run attivo (anche solo in pausa) eseguiva **fino a 8
chiamate provider pagate** (2–4 scambi × selezione interlocutore + replica) e
falliva soltanto al write-back, quando `generateChatReply` chiama
`assertFenceValid`. `sendChatMessage` invece rifiutava subito.

**Impatto.** Nessuna corruzione di stato (il write-back era già protetto), ma
credito provider sprecato e politica di rifiuto incoerente con il passo 3 di
F04 («politica esplicita: 409, nessuna mutazione del contesto congelato»).

**Correzione.** `this.ctx.assertNoActiveRun()` all'inizio di `continueChat`,
prima di qualunque generazione (speculare a `sendChatMessage`).

**Prova rosso→verde** (`chat-fence.test.ts`, nuovo caso):
`«Lascia che parlino» durante un run sospeso: 409 senza chiamare il provider`.
Prima: `chatCalls` 2→3 (una chiamata sprecata) → rosso. Dopo il fix: il rifiuto
precede la generazione (`chatCalls` invariato) e `messageCount === 0` → verde.

Nessun motore chiama `continueChat` (unico chiamante: la route): la guardia non
tocca il percorso interno di simulazione.

## Osservazioni residue (non bloccanti, fuori dal DoD verificato)

1. `ensureChat` / `archiveChat` / `unarchiveChat` / `markChatRead` mutano lo
   stato chat durante un run senza 409. Non c'è costo LLM e non toccano il
   prompt già congelato, ma mutano la collezione `chats` che il checkpoint
   cattura. `ensureChat` è però usato **anche dal motore** durante i run
   (`startChat`), quindi un divieto va imposto a livello di route
   (origine `player`), non nel servizio: rimandato come scelta di prodotto.
2. Route di lettura/selezione ramo assente (documentata in F04): richiede F06/U02.
3. Evento SSE dedicato di branch-replacement rimandato: il client lo ricava
   dalla risposta del restore e dal flush outbox.
4. Il rewind (§12) resta sul ramo corrente: limite dichiarato, estenderlo è una
   decisione di archivio.

## Comandi e risultato

```bash
cd backend-nest && npx vitest run tests/chat-fence.test.ts   # 5/5 (1 rosso→verde)
npm --prefix backend-nest test                               # 118 file, 992/992 verdi
cd backend-nest && npx tsc --noEmit                          # OK
git diff --check                                             # pulito
```

DB temporaneo in `os.tmpdir()`, provider stub, nessuna rete, nessun credito
LLM reale.

## Decisione

**F04: ACCETTABILE** ai fini della revisione indipendente; il difetto M-1 è
corretto e coperto da test. Restano le osservazioni residue sopra (nessuna
bloccante per il DoD).
