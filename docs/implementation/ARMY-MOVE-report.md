# REPORT — ARMY-MOVE (le truppe non si muovono)

Base: `main` = `3a11c26`. Riferimento utente: turno 5-6, 02/04/1816, Confederazione Germanica —
«Le truppe non si muovono».

---

## 1. Problema trovato (causa reale sul codice)

### Il percorso completo ordine → LLM → `move_unit` → `applyUnitChange` → mappa

1. Il giocatore accoda un **testo** (`queueAction`): non esiste alcun comando UI
   «seleziona unità → destinazione» (verificato: il frontend non ha alcuna azione di movimento
   strutturata; l'unico percorso è il testo dell'ordine).
2. `TurnPipelineService.processActionBatchUnlocked` costruisce il prompt e chiama l'LLM;
   il prompt istruisce a emettere **sempre** `move_unit` per un ordine di movimento accettato.
3. Il modello risponde; i `mapChanges` degli eventi passano da `applyMapChanges` →
   `WorldMutationService.applyUnitChange`, che risolve unità (`UNIT_TYPES` = battalion, army,
   fleet, missile, **mobilization** — una formazione in via di costituzione è già spostabile) e
   destinazione (`resolveMovementRegion`: id esatto → nome esatto → prefisso/inclusione univoca →
   città/porto con quel nome in una sola provincia), paga `movementCost`/`payMovement`
   (cibo, carburante, denaro: **non blocca**, registra carenze) e sposta l'oggetto tra le regioni.
4. Rete di sicurezza: `reconcileAcceptedMoves` completa il movimento se l'LLM ha dichiarato
   l'ordine «accepted» senza emettere `move_unit`, usando gli intenti estratti dal testo da
   `parseMovementOrder` (fase `captureMovementIntents` a inizio turno).

### Evidenza del blocco reale (log di produzione, turno 5, 1816-04-02)

```
[GameSession] move_unit non applicato: destinazione non risolta {
  destinazione: 'Confederazione Germanica',
  origine: 'Confederazione Germanica',
  unità: 'Battaglione federale di fanteria del Sud'
}
```

Il modello **aveva** emesso `move_unit`, ma la destinazione coincideva con la regione di partenza:
su questa mappa (243 regioni = **paesi**) «Monaco di Baviera» è una città dentro la
Confederazione Germanica, non una regione di confine. `applyUnitChange` scartava il movimento
con il solo `console.warn` e `return []`: **nessuna nota al giocatore**, che leggeva invece la
narrativa «la Dieta ordina il dirottamento del battaglione verso Monaco di Baviera». Verifica sul
salvataggio: l'unità è ancora in `…_DEU` con `metadata.status = forming`.

### Blocchi silenziosi inventariati (tutti in `applyUnitChange` + recupero)

| # | Condizione | Comportamento precedente | Visibile al giocatore? |
|---|---|---|---|
| 1 | `requestedType` non in `UNIT_TYPES` | `return []` | no |
| 2 | unità non identificata in modo univoco | `console.warn` + `return []` | no |
| 3 | destinazione non risolta / distrutta | `console.warn` + `return []` | no |
| 4 | **destinazione = regione di partenza** | `console.warn` + `return []` | no (caso reale) |
| 5 | geometria della destinazione assente (`regionCenter` null) | `return []` **senza alcun log** | no |
| 6 | scorte insufficienti (`payMovement.covered=false`) | `console.warn`, il movimento avviene | no |
| 7 | ordine di movimento accettato ma nessun intento estratto (`parseMovementOrder` = 0) | nessun `move_unit`, nessun recupero | no |
| 8 | intento estratto ma non applicato (fingerprint/destinazioni concorrenti/…) | `continue` | no |

Difetti del parser deterministico che generavano i casi 7-8:
- la **città come destinazione non era riconosciuta** (`regionMentions` non aveva il ramo
  oggetti/città che `resolveMovementRegion` usa): «Sposta il battaglione a Vienna» → 0 intenti,
  mentre lo stesso ordine affidato all'LLM poteva muovere l'unità — la rete di sicurezza era
  **più debole del percorso principale**;
- nessuna **motivazione**: il parser restituiva solo un array vuoto, senza dire perché.

## 2. Correzione applicata

**a) Parser deterministico più capace e sempre motivato** — `src/utils/movement-orders.ts`:
- nuova `analyzeMovementOrder()` che restituisce `{ intents, block? }` con codice e **messaggio
  italiano** (`negated`, `no_destination`, `ambiguous_destination`, `no_unit`, `ambiguous_unit`,
  `not_owned`, `origin_mismatch`, `unknown_words`); `parseMovementOrder()` ora è un thin wrapper
  (stessa semantica, un solo parser);
- `regionMentions()` riconosce anche le **città/porti** con un indice nome-oggetto → regioni
  costruito una volta per ordine, **solo se univoco** (stessa regola di `resolveMovementRegion`);
  nessuna euristica nuova, nessun motore parallelo.

**b) Blocchi espliciti, alla fonte** — `src/game/WorldMutationService.ts`: i casi 2, 3, 4, 5 ora
producono anche una nota nazionale leggibile (`pushNationalNote`), con il testo che spiega cosa è
successo e perché (incluso «su questa mappa un reparto si sposta in un'altra regione, non dentro
la propria»). Il caso 5 non è più muto nemmeno nel log.

**c) Attribuzione lato turno** — nuovo modulo puro `src/game/movementNotices.ts`
(`buildMovementNotices`): per ogni ordine **accettato/parziale** confronta la posizione reale
dell'unità con l'origine dell'intento. Se l'unità non si è mossa → motivazione (blocco del parser
o «la destinazione X non è stata raggiunta nel periodo»); se si è mossa con
`metadata.logistics.covered === false` → avviso «scorte insufficienti»; unità rimossa → nessuna
nota (esito legittimo). `GameSession.movementNotices()` la alimenta con `acceptedActionIds`
(stessa regola già usata dal recupero: ID autorevole, testo legacy solo se univoco) e
`TurnPipelineService` (+ `PlaybackService` per il percorso in pausa) le versa in
`pendingNationalNotes`, drenate da `advanceWorldState` → **dispacci del turno**.

Le note non contraddicono mai il modello su un ordine **respinto**: intervengono solo su esiti
accettati/parziali.

## 3. File modificati

- `backend-nest/src/utils/movement-orders.ts` — `analyzeMovementOrder`, `MovementBlock`, città.
- `backend-nest/src/game/movementNotices.ts` — **nuovo**, puro.
- `backend-nest/src/game/WorldMutationService.ts` — note esplicite sui 4 scarti silenziosi.
- `backend-nest/src/game-session.ts` — `acceptedActionIds`, `movementNotices`, export nel ctx.
- `backend-nest/src/game/TurnPipelineService.ts` — note dopo il recupero (3 righe).
- `backend-nest/src/game/PlaybackService.ts` — stesse note nel percorso in pausa.
- `backend-nest/tests/movement-orders.test.ts` — **nuovo**, 12 test.
- `backend-nest/tests/stage2.test.ts` — 2 test di integrazione (dipendenza `move_accepted`).

## 4. CORE ENGINE FREEZE

`core/simulation/**` **non toccato**. Le modifiche sono in `utils/`, `game/` e nel turn pipeline:
nessun nuovo motore di movimento, nessuna seconda verità. Riuso completo di `applyUnitChange`,
`move_unit`, `movementCost`/`payMovement`, `reconcileAcceptedMoves`, `resolveMovementRegion`.
L'unica aggiunta allo stato è il canale già esistente `pendingNationalNotes`.

## 5. Test eseguiti (esito reale)

`tests/movement-orders.test.ts` (12 test): spostamento verso una regione; **città come
destinazione** (Vienna); mobilitazione in formazione spostabile (`plannedType`); motivazioni
(`no_destination`, `negated`, città interna, `not_owned`, `ambiguous_unit` e riferimento generico
univoco); ordine non di movimento → nessun blocco; `parseMovementOrder` ≡ `analyzeMovementOrder.intents`;
note: intento non applicato, destinazione = origine, nessuna nota se l'unità si è mossa o è stata
rimossa, scorte insufficienti, blocco riportato, esito non accettato senza note.

`tests/stage2.test.ts` (2 nuovi, integrazione su sessione reale con provider stub):
1. ordine «Sposta il Battaglione Sud in Polonia» **accettato senza `move_unit`** → dopo il turno
   l'unità **non è più** in DEU, **è in** POL con `metadata.previousRegionId = …_DEU`;
2. ordine senza destinazione riconoscibile → l'unità resta in DEU **e** i dispacci del turno
   contengono «Movimento non eseguito» + la motivazione.

Suite backend completa: **138 file / 1178 test verdi** (erano 137/1164 dopo MILITARY-REACTION:
+14). Frontend non toccato in questa PR. Quality gate completo (frontend, tsc, build, e2e)
eseguito a livello di branch prima del merge.

## 6. Limiti residui

- **Nessun comando UI diretto** (seleziona unità → destinazione): resta il testo dell'ordine. La
  correzione rende affidabile e spiegato il percorso testuale, non aggiunge un controllo grafico.
- **Omonimie in lingua italiana**: «Monaco» è il nome della regione del Principato di Monaco,
  mentre la città bavarese è memorizzata come «Munich». Un ordine «a Monaco» continua a risolvere
  il Principato (comportamento **preesistente**, non introdotto qui) e ora, se lo spostamento non
  avviene, il giocatore legge il motivo. Servirebbe un dizionario di alias italiani delle città
  (proposta, fuori ambito).
- Il parser resta **conservativo**: due formazioni con lo stesso prefisso («Battaglione Sud» /
  «Battaglione Nord» in un ordine che dice solo «il battaglione») vengono rifiutate con
  `ambiguous_unit` invece di sceglierne una. È una scelta esplicita: meglio una spiegazione che un
  movimento sbagliato.
- Il costo del movimento **non blocca** (come prima): scorte insufficienti producono un avviso,
  non un rifiuto.
- Le note del turno viaggiano in `pendingNationalNotes` → dispacci: non sono ancora agganciate
  alla singola card dell'ordine nella UI (l'attribuzione per decisione è la Parte 4).
- Spostamenti con destinazioni concorrenti nella stessa azione vengono ignorati dal recupero: il
  turno ora lo dice, ma la scelta resta al modello.
