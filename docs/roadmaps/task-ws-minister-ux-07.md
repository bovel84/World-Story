# WS-MINISTER-UX-07 — Verifica completa e rifinitura

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch da creare**: `feat/ws-minister-ux-07-verifica-completa`
**Base dichiarata**: `main` @ `02ad9ad` (PR #149 — UX-06 — mergiata)
**Roadmap di riferimento**: `docs/roadmaps/raw-roadmap-pi-20260930.md` (§WS-MINISTER-UX-07)
**Contratti già fissati**: `docs/implementation/WS-MINISTER-UX-00-report.md` §3

---

## Obiettivo

Chiudere il ciclo del ministro con una **verifica completa** e la **rifinitura** dei
difetti già dichiarati come residui nelle fasi precedenti, senza allentare alcuna
invariante e senza toccare il motore.

UX-07 **non è una fase di costruzione**: è **verifica + rifinitura**. Non si
introducono meccaniche nuove, non si aggiungono numeri, non si crea un motore.

---

## CORE ENGINE FREEZE (intatto, come UX-06)

Non modificare, salvo bug critico dimostrato e documentato:

- `backend-nest/src/core/simulation/**`
- `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`
- schema/database, repositories
- semantica checkpoint, simulation run, `useSimulationPlayback`
- pipeline di avanzamento del tempo

UX-07 è **solo frontend** sopra le rotte già esistenti. Se ti accorgi che serve
toccare il freeze: **fermati e documenta il blocco** nel report, senza procedere.

---

## FASE 1 — VERIFICA SUL CODICE REALE (prima di modificare)

Ispeziona i file e **conferma** i difetti qui descritti. Non assumere: verifica.
Cita nel report, per ciascuno, il file e la riga reale dove il difetto vive.

---

## LAVORO

### A. I tre difetti rinviati dalle fasi precedenti (correggere)

Difetti **già documentati** nei report precedenti. Vanno chiusi qui.

**A1 — Markdown grezzo nelle frasi del ministro.**
- **Dove è dichiarato**: `WS-MINISTER-UX-00-report.md` §8 e `WS-MINISTER-UX-05-report.md` §10.
- **Sintomo**: il modello emette Markdown (`**grassetto**`, `*corsivo*`, liste) e la
  chat del ministro lo mostra **crudo**, con gli asterischi visibili.
- **Comportamento desiderato**: rendere il Markdown del ministro in **testo formattato**
  (grassetto/corsivo/liste) senza mostrare i marcatori, **oppure** ripulirlo; purché
  il messaggio resti leggibile e non si perda il contenuto. Vale per la chat **e**
  per le frasi mostrate nel fascicolo/briefing.
- **Vincolo**: niente HTML arbitrario; sanitizzare. La resa non deve introdurre
  chiamate LLM.
- **Test**: caso con `**grassetto**`, `*corsivo*`, una lista e un testo con asterischi
  legittimi (es. `2*3` non deve diventare corsivo). Funzione pura preferibile.

**A2 — L'evidenza «dove va la spesa» mostra il saldo invece della voce pertinente.**
- **Dove è dichiarato**: `WS-MINISTER-UX-03-report.md` §7 e `WS-MINISTER-UX-04-report.md` §8.
- **Sintomo**: quando la conversazione parla di **spesa**, la tavola mette in evidenza
  il **saldo totale** del bilancio, non la **voce pertinente** alla spesa discussa.
- **Comportamento desiderato**: l'evidenza evidenziata deve essere **la voce** che la
  conversazione sta discutendo (es. sanità, opere, riserva); il saldo resta
  disponibile ma non è l'evidenza principale di una frase sulla spesa.
- **Vincolo**: la scelta resta **deterministica e locale** (nessuna nuova chiamata LLM);
  le fonti dei numeri non cambiano — si cambia **cosa viene evidenziato**, non il dato.
- **Test**: dato un discorso sulla spesa in una voce, la selezione punta a quella voce
  e non al saldo; con dati mancanti, resta dichiarato il dato mancante.

**A3 — Layout mobile tagliato.**
- **Dove è dichiarato**: ricorrente negli screenshot a `390×844` di tutte le fasi.
- **Sintomo**: su mobile la seduta del ministro risulta **tagliata** (contenuti oltre
  il bordo, elementi non raggiungibili, chat compressa).
- **Comportamento desiderato**: a `390×844` la seduta è **usabile**: chat raggiungibile,
  tavola raggiungibile, pulsanti non tagliati, nessun contenuto fuori schermo. La
  verifica va fatta **prima/dopo** con screenshot comparabili.
- **Vincolo**: nessun ridisegno delle fasi precedenti; solo rifinitura di quanto è
  tagliato/irraggiungibile.

### B. Copertura di verifica richiesta dalla roadmap

Verificare almeno **Tesoro**, **Sanità/Istruzione** e **Guerra**, **includendo un caso
con dati mancanti**. Usare gli harness e i test esistenti, aggiornandoli per il
comportamento intenzionalmente nuovo **senza allentare le invarianti**.

Copertura essenziale da dimostrare (test o verifica documentata nel report):

1. **schema delle direttive** — le direttive di presentazione rispettano lo schema;
   riferimenti invalidi vengono rifiutati (non crashano, non passano).
2. **eventi fuori ordine** — un evento tardivo/duplicato non rompe lo stato.
3. **isolamento dei ministri** — le sedie non si scambiano stato né memoria.
4. **persistenza e rewind** — la memoria resta (UX-05) e il rewind la **pota**:
   una decisione futura non compare nel passato.
5. **fonti dei numeri** — ogni numero mostrato dichiara la sua origine
   (`misurato · conti nazionali`); il dato mancante resta **DATO MANCANTE**.
6. **ordini duplicati** — doppio clic / tentativi ripetuti producono **un solo atto**.
7. **percorso di firma ed esito** — conversazione → bozza → firma → registro → tempo →
   esito verificato; la UI distingue sempre *atto in attesa* ed *effetto applicato*.

### C. Accessibilità e comportamento dello streaming

Da verificare **e** rifinire se difettoso:

- navigazione da **tastiera**, gestione del **focus**, **reduced motion**;
- lettura dello streaming **senza annunciare ogni token** (screen reader: non deve
  vocalizzare token per token);
- **autoscroll durante lo streaming**: segue il fondo **solo se il giocatore lo sta
  già leggendo**; chi risale la cronologia **non** deve essere riportato in basso;
- la **tavola mantiene il focus** durante gli aggiornamenti e permette di **fissare
  un'evidenza** per continuare a leggerla.

### D. Latenza e numero di chiamate LLM

- Misurare **latenza** e **numero di chiamate LLM** dei percorsi verificati.
- Ove possibile: **una risposta per testo e presentazione**; **nessuna chiamata
  aggiuntiva** per ciascun grafico o movimento della mappa.
- Riportare i numeri reali misurati nel report (con il metodo usato).

---

## COSA NON FARE

- Non toccare `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
  `TurnPipelineService`, `SessionStateStore`, schema o repository.
- Non introdurre nuove meccaniche economiche, nuovi numeri, nuovi motori.
- Non creare memoria nuova fuori da UX-05, né storage nuovo.
- Non allentare o disattivare test per farli passare.
- Non toccare JEV né il repo `jev`.

---

## TEST

Mantenere **verdi** i test esistenti. Aggiungere test mirati per A1, A2, A3 e per i
punti di copertura non ancora coperti. Testare soprattutto **funzioni pure / read
model** — niente snapshot enormi.

**Test rosso = ri-esegui, non rilassare.** Un fallimento da timeout (es.
`military-warfront-integrity.test.ts` test 50, 5000ms) su macchina carica è **flaky**:
si ri-esegue. **Mai** alzare la soglia o disattivare il test.

**Se un test fallisce davvero per colpa tua**, correggi il **codice** — non il test.

---

## QUALITY GATE

Prima della PR, eseguire **realmente**:

- backend test (`vitest`)
- frontend test (`vitest`)
- `tsc --noEmit`
- build backend
- build frontend
- E2E compatibili con l'ambiente

**Non dichiarare "verde" ciò che non è stato eseguito.**

---

## DELIVERABLE (obbligatorio)

Creare `docs/implementation/WS-MINISTER-UX-07-report.md`, in quest'ordine:

1. problemi trovati (causa reale, con file e riga)
2. correzioni applicate (A1, A2, A3 + eventuali difetti emersi in B/C)
3. file modificati
4. conferma **CORE ENGINE FREEZE** intatto
5. test eseguiti (esito reale, numeri)
6. risultati — **misure reali** di latenza e chiamate LLM
7. limiti residui (cosa resta aperto e perché)
8. proposte per fasi successive

Più: **screenshot comparabili prima/dopo** (desktop, tablet, mobile) per A1, A2, A3.

> Questo file è il **documento di consegna**: l'autopilot lo cerca su `origin/main`
> per stabilire, in modo deterministico, che il task è chiuso.
> **Non rinominarlo e non ometterlo.**

---

## CRITERIO DI SUCCESSO

Il task è completo **soltanto se**:

- A1, A2, A3 sono corretti **e** provati (test + screenshot prima/dopo);
- la copertura B è dimostrata, **incluso il caso con dati mancanti**;
- accessibilità e streaming (C) sono verificati, con le rifiniture necessarie;
- le misure di latenza/chiamate LLM (D) sono riportate con numeri reali;
- core engine congelato, nessun motore nuovo, **nessun test allentato**;
- suite verdi: backend, frontend, `tsc`, build.

---

## ORDINE DI LAVORO

1. `git fetch`; verifica l'HEAD del branch e dichiara la base reale.
2. Leggi i report UX-00..UX-06: **non riscrivere** ciò che è già fatto.
3. Verifica sul codice reale i difetti A1, A2, A3 (file + riga).
4. Correggi A1, A2, A3 con test.
5. Copertura B (Tesoro, Sanità/Istruzione, Guerra, caso con dati mancanti).
6. Accessibilità e streaming (C).
7. Misure di latenza/chiamate LLM (D).
8. Regression suite completa + build.
9. Screenshot prima/dopo e report.

Commit piccoli e coerenti, in italiano. **Push** sul branch. La PR la apre la direzione.
