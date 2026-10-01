# WS-MINISTER-UX-08 — Correzione dell'esperienza richiesta

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch da creare**: `feat/ws-minister-ux-08-correzione-tavola`
**Base dichiarata**: `main` @ `6d42ab3` (PR #150 — UX-07 — mergiata)
**Roadmap di riferimento**: `docs/roadmaps/raw-roadmap-pi-20260930.md`
**Contratti già fissati**: `docs/implementation/WS-MINISTER-UX-00-report.md` §3

---

## Obiettivo

Le fasi **UX-01…UX-07 non soddisfano ancora l'esperienza richiesta**. Questo task
**corregge il risultato attuale** partendo da difetti concreti, già verificati sul
codice reale. Non è una fase nuova: è la correzione di ciò che è stato consegnato.

Le sei correzioni qui sotto sono **tutte frontend** (più il contratto della memoria
nel client). **Nessun tocco al motore.**

---

## CORE ENGINE FREEZE (intatto)

Non modificare: `backend-nest/src/core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema, repository.

Se ti accorgi che serve toccare il freeze: **fermati e documenta il blocco**.

---

## FASE 1 — VERIFICA SUL CODICE REALE (prima di modificare)

Conferma ogni difetto citando **file e riga**. Non assumere. Punti di partenza
verificati (usali come pista, ma **riverifica**):

- `frontend/src/components/Game/GovernmentOffice.tsx` — righe ~274-323: `act.roads`
  usato come sorgente unica per **tutte** le sedie.
- `frontend/src/components/Game/SeatTable.tsx` — righe ~155-167: l'atto precede
  grafici/mappe; `onCompare` legato ad `act.roads`.
- `frontend/src/components/Game/TreasuryActPanel.tsx` — pannello dell'atto.
- `frontend/src/components/Game/ministerMemory.ts` — righe ~88-131, ~209-229: la
  cache è indicizzata **solo per `gameId`** (manca ramo e mandato).

---

## LE SEI CORREZIONI

### 1. L'evidenza richiesta deve occupare subito la parte principale della tavola

- **Sintomo**: `TreasuryActPanel` precede **sempre** grafici e mappe; l'atto sta in
  cima anche quando la conversazione ha chiesto un grafico o una mappa.
- **Comportamento desiderato**: ciò che la conversazione chiede (la direttiva di
  presentazione) **occupa subito la parte principale**. Il pannello dell'atto
  compare **quando è pertinente alla decisione**, non per default.
- **Test**: con direttiva `focus` su grafico/mappa, l'evidenza richiesta è la
  visualizzazione principale; l'atto non la precede. Senza direttiva, resta il
  comportamento di sicurezza di UX-01.

### 2. Collega confronti e proposte al ministro aperto e alla conversazione

- **Sintomo**: `act.roads` del **Tesoro** è usato come sorgente per **tutte** le
  sedie (`GovernmentOffice.tsx` righe ~274-323). Un confronto alla Sanità mostra
  strade del Tesoro.
- **Comportamento desiderato**: confronti e proposte derivano **dalla sedia aperta**
  e dalla conversazione corrente. Niente `act.roads` globale.
- **Test**: un confronto richiesto alla Sanità non mostra strade del Tesoro; il
  confronto appartiene alla sedia e alla proposta discussa.

### 3. Togli i piani dimostrativi con date fisse dalla presentazione ordinaria

- **Sintomo**: nella presentazione ordinaria compaiono piani con **date fisse**
  (es. riferimenti a «1° gennaio»), non legati alla partita.
- **Comportamento desiderato**: il piano deve **derivare dalla proposta discussa** e
  dalla **data di gioco** corrente. Nessuna data fissa, nessun piano dimostrativo.
- **Test**: il piano non contiene date fisse; con date di gioco diverse il piano
  cambia di conseguenza; se manca il dato, resta dichiarato mancante.

### 4. Correggi lo scope della memoria anche nel client

- **Sintomo**: `ministerMemory.ts` persiste con chiave **solo `gameId`**
  (riga ~212/229). Ramo e mandato **non** entrano nella chiave.
- **Comportamento desiderato**: lo scope client è **partita + ramo + mandato**,
  come il server. La cache **non deve reinserire** ricordi di **altri rami** né
  del **futuro** (oltre la data di gioco).
- **Test**: un ricordo di un altro ramo non riappare; un ricordo del futuro viene
  scartato; cambiando mandato cambia lo scope. Il rewind non fa riemergere il futuro.

### 5. Alleggerisci la grafica

- **Comportamento desiderato**: **una** visualizzazione principale, **pochi**
  supporti pertinenti, **testo leggibile**, **fonti nei dettagli** (non in primo
  piano). L'**azione di ordine** si sposta dalla **singola domanda** alla
  **proposta concreta**.
- **Vincolo**: non ridisegnare le fasi; alleggerire ciò che è sovraccarico.
- **Test**: una sola visualizzazione principale per risposta; le fonti stanno nei
  dettagli; l'ordine nasce dalla proposta concreta.

### 6. Verifica una conversazione completa col provider reale

Percorso da verificare **dall'inizio alla fine**:

> obiettivo del Presidente → chiarimento → grafico → territorio → alternative →
> proposta modificata → decisione → **riapertura con memoria**

- Usa l'harness con provider reale già esistente (`e2e/playwright.real.config.mjs`,
  `e2e/real-chat-shot.mjs`) e i mock dove appropriato.
- **Consegna una demo** di questo percorso **e screenshot** che mostrino
  **effettivamente** il grafico o la mappa **richiesti** nella parte **visibile**
  della tavola.
- **Distingui** nel report: verifiche **con mock** vs verifiche con **provider
  reale**; requisiti **completati** vs **ancora aperti**.

---

## COSA NON FARE

- Non toccare `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
  `TurnPipelineService`, `SessionStateStore`, schema o repository.
- Non introdurre numeri di gioco nuovi né motori nuovi.
- Non allentare o disattivare test per farli passare.
- Non toccare JEV né il repo `jev`.

---

## TEST

Mantenere **verdi** i test esistenti. Aggiungere test mirati per **ognuno** dei
sei punti. Testare soprattutto **funzioni pure / read model**.

**Test rosso = ri-esegui, non rilassare.** Un fallimento da timeout su macchina
carica è **flaky**. **Mai** alzare la soglia o disattivare il test. Se un test
fallisce per colpa tua, correggi il **codice**, non il test.

---

## QUALITY GATE

Eseguire **realmente**: backend test · frontend test · `tsc --noEmit` (backend e
frontend) · build backend · build frontend · E2E compatibili.

**Non dichiarare "verde" ciò che non è stato eseguito.**

---

## DELIVERABLE (obbligatorio)

Creare `docs/implementation/WS-MINISTER-UX-08-report.md`, in quest'ordine:

1. problemi trovati (causa reale, **file e riga**)
2. correzioni applicate (i sei punti)
3. file modificati
4. conferma **CORE ENGINE FREEZE** intatto
5. test eseguiti (esito reale)
6. risultati — **mock vs provider reale**, requisiti **completati vs aperti**
7. limiti residui
8. proposte per la fase successiva

Più: **screenshot** che mostrano il **grafico o la mappa richiesti** nella parte
**visibile** della tavola.

> Questo file è il **documento di consegna**: verifica deterministica di chiusura.
> **Non rinominarlo e non ometterlo.**

---

## CRITERIO DI SUCCESSO

Il task è completo **soltanto se**:

- i **sei** difetti sono corretti **e** provati (test + screenshot);
- la demo della conversazione completa è consegnata, con la distinzione
  **mock / provider reale** e **completato / aperto**;
- gli screenshot mostrano **davvero** il grafico o la mappa richiesti;
- core engine congelato, nessun motore nuovo, **nessun test allentato**;
- suite verdi: backend, frontend, `tsc`, build.

---

## ORDINE DI LAVORO

1. `git fetch`; verifica l'HEAD del branch e dichiara la base reale.
2. Leggi i report UX-00..UX-07: **non riscrivere** ciò che è già fatto.
3. Verifica sul codice reale i **sei** difetti (file + riga).
4. Correggi i punti 1-5, con test.
5. Esegui la verifica completa col provider reale (punto 6) e produci demo + screenshot.
6. Regression suite completa + build.
7. Report finale, con **mock vs reale** e **completato vs aperto**.

Commit piccoli e coerenti, in italiano. **Push** sul branch.
La PR la apre la direzione.
