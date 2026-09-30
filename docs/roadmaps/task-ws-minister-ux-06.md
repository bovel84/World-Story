# WS-MINISTER-UX-06 — Dalla proposta alla decisione del Presidente

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch**: `feat/ws-minister-ux-06-dalla-proposta-alla-decisione`
**Base dichiarata**: `0b7ae5a` (HEAD di `feat/ws-minister-ux-05-memoria-persistente`;
`main` @ `25a9d89` + l'innesto di memoria di UX-05, ancora **non mergiato**). UX-06
è impilata su UX-05 e verrà riportata su `main` dopo il merge di UX-05.
**Roadmap di riferimento**: `docs/roadmaps/raw-roadmap-pi-20260930.md` (fase UX-06)
**Contratti già fissati**: `docs/implementation/WS-MINISTER-UX-00-report.md` §3
(conversazione / evidenza / ordine / memoria sono oggetti distinti)

---

## Obiettivo

Chiudere il flusso **proposta discussa → bozza concreta → firma del Presidente →
registro → avanzamento del tempo → esito verificato**, senza aggiungere conferme
ridondanti e senza mai far sembrare eseguito ciò che il motore non supporta.

La conversazione **propone**, la tavola **mostra e prepara**, l'ordine **impegna**,
la memoria **ricorda**. Il ministro **non firma**: firma il Presidente.

## Cosa fare

### 1. Dalla strada alla bozza d'atto

La tavola del Tesoro (e, in generale, ogni strada firmabile) offre:

- **«Prepara l'atto»** — trasforma la strada in una **bozza** sul tavolo (testo
  correggibile + dichiarazione d'opera, quando c'è). Non accoda e non spende.
- **«Confronta»** — porta in cima il confronto tra le strade del motore. Non
  modifica cassa né coda.
- **«Modifica proposta»** — il Presidente corregge la bozza prima della firma.

### 2. La firma esplicita

**«Firma e inserisci nel registro»** accoda l'ordine secondo la semantica vigente
(rotta `POST /:id/actions/queue`), con la dichiarazione d'opera quando la distinta
è coperta. Nessuna conferma ulteriore: la firma è l'atto esplicito.

### 3. Onestà sulla capacità del motore

Per ogni strada la tavola dichiara **cosa il motore sa fare**:

- **ordine d'opera supportato** — c'è una dichiarazione coperta: il motore apre il
  cantiere e addebita la cassa;
- **bozza testuale da valutare** — il motore interpreterà la prosa al salto, ma
  non esiste un comando dedicato (es. rimborso titoli: la scadenza è un rollover);
- **funzione assente** — la strada non ha un comando supportato (es. opera con
  distinta scoperta): registrare non produrrebbe l'effetto.

### 4. Lo stato reale, non un flag locale

Lo stato dell'atto — `proposto → preparato → accodato → eseguito | fallito` — va
**ricostruito dai dati disponibili**, non da un flag locale «accolta»:

- `accodato`: la bozza coincide con una voce di `pendingActions`;
- `eseguito` / `fallito`: dall'`history` del turno, dove `outcomeStatus` distingue
  `rejected` (fallito) da `accepted`/`partial` (eseguito);
- `preparato`: la bozza esiste e non è ancora in coda.

Doppio clic, tentativi ripetuti e fallimenti non devono **duplicare** atti: la
chiave d'ordine è il testo della bozza; mentre la richiesta è in volo il pulsante
è disabilitato.

### 5. Nulla di fatto e ordini già accodati

Il **nulla di fatto** resta un esito possibile e **non cancella** ordini già
accodati: chiude la seduta, la coda e il registro restano.

## Freeze

Nessuna modifica al motore: `core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema, repository.
UX-06 è **solo** frontend, sopra le rotte di coda già esistenti
(`/actions/queue`, `/actions/queue/:actionId`). Nessun numero nuovo.

## Verifica richiesta (accettazione)

1. **Flusso completo**: conversazione → confronto → atto → registro → tempo → esito.
2. **Non impegna**: aprire grafici e confrontare alternative non cambia cassa né coda.
3. **Firma esplicita**: solo «Firma e inserisci nel registro» accoda; il ministro
   non firma da sé.
4. **Capacità dichiarata**: una strada senza comando supportato lo dice, e non
   sembra eseguita.
5. **Niente duplicati**: doppio clic e tentativi ripetuti producono un solo atto.
6. **Stato derivato**: la UI distingue sempre *atto in attesa* ed *effetto applicato*.
7. **Invarianti verdi**: `tsc --noEmit`, suite vitest (backend e frontend), build.
   Aggiorna i test esistenti per il comportamento intenzionalmente nuovo **senza
   allentare le invarianti**.

## Deliverable

- Modulo puro della bozza d'atto + pannello della tavola.
- Test: `actDraft.test.ts`, render del pannello, pannello del Tesoro aggiornato.
- Report: `docs/implementation/WS-MINISTER-UX-06-report.md`.
- E2E: aggiornare i flussi P04b/P04e e aggiungere un P06 del flusso completo.

## Consegna

Commit sul branch, poi **push**. La PR la apre la direzione. Messaggi di commit in
italiano, convenzione del repo.
