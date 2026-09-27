# World Story — piano: timeline, eventi e azioni

**Versione:** 1.3, 27 settembre 2026.
**Stato:** diagnosi completata e corretta da una revisione indipendente. **E01 e S1 consegnate**
(chat con la controparte giusta). **S2, S3, S4 misurate** e in attesa di decisione.
**Destinatari:** l'autore e gli LLM esecutori. Ogni scelta marcata «obbligatoria» è un contratto.
**Obiettivo dichiarato dall'autore:** «la timeline e gli eventi e le azioni devono essere migliorati;
continuo a vedere Pax Historia con eventi migliori dei miei».

> **Il problema in una riga.** Le istruzioni ci sono; mancano tre cose diverse che l'autore
> percepisce come una sola: il **collegamento ordine → notizia** si spezza nel percorso che il
> giocatore usa davvero (il polling HTTP perde il campo); una quota consistente della cronaca è fatta
> di **otto frasi diplomatiche predefinite scritte dal motore**, che duplicano il dispaccio a cui si
> affiancano; e **il giudizio definitivo non è ancora stato giocato** — la correzione «un ordine, una
> notizia» è stata compilata solo nel pomeriggio del 26 settembre.

> **Come leggere questa versione.** La v1.0 di questo piano conteneva **quattro errori di
> sostanza**, trovati da una revisione indipendente e corretti qui. Sono elencati in §8, in chiaro,
> perché un piano che nasconde i propri scarti non è utile a chi lo esegue.

---

## Indice

1. Come è stata condotta la diagnosi
2. Il quesito che va risolto prima di ogni altra cosa
3. I difetti, con la misura che li prova
4. Le invarianti non negoziabili
5. Le fasi (E01–E07)
6. Criteri di completamento e verifica
7. Cosa NON fare
8. Le correzioni rispetto alla v1.0
9. Le quattro segnalazioni dell'autore (27 settembre 2026)
10. Ciò che il piano non può risolvere da solo

> **Consegnato finora.** `backend-nest/src/game/diplomacyNarration.test.ts` (8 test, nuovi),
> `backend-nest/src/prompts/types.ts`, `backend-nest/src/game-session.ts`,
> `backend-nest/src/game/DiplomacyService.ts` e `backend-nest/tests/diplomacy-service.test.ts`
> (3 test aggiunti) — la prima metà di E01 (§5) e la segnalazione **S1** (§9: chat con la
> controparte giusta). Nessun altro file toccato. **S2, S3 e S4 sono misurati ma non corretti.**
>
> **Nota di ambiente.** Per eseguire le suite che aprono SQLite ho ricompilato `better-sqlite3` per
> Linux; il **binario macOS dell'autore è stato ripristinato** al suo posto. Un `npm install` aveva
> anche fatto retrocedere `vite` da 8.2.2 a 5.4.21, rompendo `vitest`: ripristinato dal lockfile.
> Verificare sempre `node -e "require('./node_modules/vite/package.json').version"` dopo un
> `npm install` in questo repo — e riportare `package-lock.json` con `git checkout --`.

---

## 1. Come è stata condotta la diagnosi

Tutto ciò che segue è **misurato**, non dedotto leggendo il codice. Le fonti:

- il database di gioco vivo, `backend-nest/data/open-pax.db` (140 partite, 417 righe in
  `simulation_events`, 12.497 voci in `turn_results.timeline_events`, 175 run), letto **in sola
  lettura** (`mode=ro`, nessuna scrittura);
- il codice di `main` al commit `b4952ef` (26 settembre 2026, 18:18);
- sonde eseguite con `tsx` sulle funzioni pure del motore (`parseIncrementalSimulationResponse`,
  `resolvePeriod`), con i file di prova rimossi dopo l'uso;
- la suite frontend eseguita per intero: **858 test verdi**, 102 file.

**Limite dichiarato.** I test backend che aprono SQLite non girano in questa sandbox
(`better-sqlite3` è un binario Mach-O). Non ho eseguito una simulazione con un provider LLM: le
misure descrivono ciò che il motore ha **persistito**, non ciò che il modello risponde in diretta.

**Le due tabelle non sono la stessa cosa, e questo conta.** Esistono due registri:

| Registro | Chi lo scrive | Chi lo legge |
|---|---|---|
| `turn_results.timeline_events` | il checkpoint del turno | **la Timeline e l'archivio** (`getTimelinePage` → `useWorldTimeline` → `HudBar`) |
| `simulation_events` | il checkpoint del run | il **lettore di sessione** e il polling (`getSimulationRun`) |

Le partite con `simulation_events` sono **36** e contengono **189** voci di cronaca contro **417**
righe di run: le due tabelle divergono già di numero. Le altre **104** partite (12.308 voci di
cronaca) sono **precedenti** a `simulation_events`. Quindi nessun confronto fra le due tabelle è
lecito: le misure vanno sempre fatte **dentro** una tabella, o sulle **stesse** partite.

---

## 2. Il quesito che va risolto prima di ogni altra cosa

**La correzione «ogni ordine produce la propria notizia» è stata compilata solo nel pomeriggio del
26 settembre. Non sappiamo ancora se funziona.**

| Fatto | Valore |
|---|---|
| Commit fase F (autore) | 26/09 **08:25** (`3f457ae`) |
| Merge della PR #120 | 26/09 **10:00** (`d24d895`) |
| Ultimo run reale con esiti | 26/09 **10:08 ora locale** (= 08:08 UTC) |
| Ricompilazione del backend (`dist/`) che contiene F | 26/09 **17:44** |

L'ultimo run reale precede di otto minuti il **merge**, e di **nove ore** la ricompilazione. La
versione del motore in esecuzione durante quell'ultimo run è quella del `dist` *precedente*, che non
conteneva F.

**Perché è il primo punto del piano.** La copertura misurata qui sotto — **62 %** degli esiti con una
notizia collegata — è la fotografia di una build **senza** F. Se F funziona, metà delle fasi che
seguono cambiano di priorità. La prima azione non è scrivere codice: è **giocare un turno** con la
build corrente e rimisurare.

**Attenzione (correzione della v1.0).** La v1.0 affermava che la correzione «non è mai stata
giocata» confrontando l'ora del run (08:08, memorizzata in **UTC**) con l'ora del merge (10:00, in
**+0200**): una differenza di fuso, non di fatto. La conclusione corretta è più stretta ma resta
netta: *l'ultimo run reale è anteriore alla compilazione che contiene F*. **Non è dimostrato che F
non funzioni; è dimostrato che non è stato provato.**

---

## 3. I difetti, con la misura che li prova

### E01 — Otto frasi predefinite scritte dal motore, che duplicano il dispaccio accanto

**Dove.** `backend-nest/src/game/DiplomacyService.ts:353-361` (mappa `openingByKind`, usata a
`:376` per costruire l'headline):

```ts
const openingByKind: Record<string, string> = {
  meeting: group ? 'convoca una riunione multilaterale' : 'chiede una riunione',
  summit: 'propone un vertice',
  negotiation: 'avvia un negoziato',
  conference: 'convoca una conferenza',
  ultimatum: 'apre un confronto su un ultimatum',
  technical: 'propone un tavolo tecnico',
  statement: 'invia una nota diplomatica',
};
```

**Misura, dentro le stesse 36 partite** (per non mescolare epoche diverse):

| Registro | Voci con una delle 8 frasi |
|---|---|
| `simulation_events` (payload del run) | 185/417 = **44 %** |
| `turn_results.timeline_events` (la cronaca) | 66/189 = **35 %** |

Nelle partite più recenti (dal 23/09) la quota sulla cronaca è **8/29 = 28 %**: circa **una voce di
cronaca su tre** è una frase che il motore scrive da sé.

**Il duplicato è dimostrato, non inferito.** Di **185** note diplomatiche, **183** si aprono con
`In seguito a «<titolo>»` — e il titolo citato **è un evento di mondo dello stesso run nel 100 % dei
casi (183/183)**. La nota diplomatica non aggiunge un fatto: commenta un fatto che è **già** una voce
di cronaca, con la stessa posizione ripetuta nel blocco «Reazioni internazionali» dentro il dispaccio
di mondo (`game-session.ts:2171-2185`).

**L'arresto del salto ci cade sopra.** Su 124 run con data di checkpoint: in **90 (73 %)**, quel
giorno contiene una di queste frasi; e in **tutti e 90** i casi quel giorno contiene **anche** un
evento di mondo. La frase non è mai la decisione: le si siede accanto. E in **90 run su 124 (73 %)**
una frase predefinita è l'**ultima** voce della cronaca — cioè l'ultima cosa che il giocatore legge
prima che il tempo si fermi.

**Perché l'autore vede «eventi migliori» altrove.** Con una media di **2,1 voci per turno** (2.307
turni con una sola voce, 2.732 con due, 896 con tre o più), una voce su tre è fissa e ripetuta
identica (`Zimbabwe invia una nota diplomatica`: 12 volte).

**Nota, per non sbagliare diagnosi.** Queste voci **non** sono la cronaca grezza del modello: sono
generate dal motore *a valle*, dalla stessa reazione che ha già prodotto il dispaccio di mondo. Il
canale diplomatico (la chat) è la sede giusta per quella posizione; la cronaca no.

---

### E02 — «L'ordine» non può comparire: il turno svuota la coda che il client legge

**Dove.** `frontend/src/hooks/useFeed.ts:66-74` risolve gli ID leggendo la coda viva
(`useGameStore.getState().pendingActions`). Ma il turno **rimuove quegli ordini** prima di committare:
`TurnPipelineService.ts:752` e `PlaybackService.ts:776` chiamano `removePendingActions`.

**Misura.** Gli ordini collegati (143 distinti, 148 riferimenti) sono presenti in
`simulation_action_outcomes`: **143**. In `pending_actions`: **0**. In `actions` — la tabella che
conserva il testo — ne restano **69**, ma **nessuna query di lettura** la interroga: le sole due
occorrenze in `game.repository.ts:801,832` sono `DELETE`. Il testo dell'ordine sopravvive al turno,
ma il percorso che dovrebbe mostrarlo punta a una coda già vuota. La sezione «L'ordine» in
`EventFeed.tsx:204-209` e `NewsFlash.tsx:55-60` è scritta e testata, e **non può accendersi**.

---

### E03 — Il percorso che il giocatore usa davvero perde il collegamento

**Correzione importante rispetto alla v1.0.** Le due parti di questa fase erano mirate al file
sbagliato. Ecco dove il campo si perde davvero:

| Percorso | Esito |
|---|---|
| `useFeed.ts:149` (refresh cronaca dal DB) | **OK** — legge `ev.sourceActionIds` |
| `useFeed.ts:176` (`publishEventDetails`) | **OK** — passa `detail.sourceActionIds` |
| `useSimulationStream.ts:338-340` (polling del run) | **PERDE il campo** — costruisce `{id, date, headline, detail, source}` |
| `useWorldAdvance.ts:103,113` (HTTP) | **PERDE il campo** — stesso payload ridotto |

**Misura del difetto vero.**

| Grandezza | Valore |
|---|---|
| Voci di cronaca con `sourceActionIds` (tutte le partite) | 62/12.497 = **0,5 %** |
| Voci di cronaca con `sourceActionIds` (partite dal 23/09) | 14/29 = **48 %** |
| `sourceActionIds` in `frontend/src/components/` | **0 occorrenze** |

Dunque: il motore **sta** collegando (48 % nelle partite recenti, contro 0,5 % nello storico), e la
Timeline **non lo mostra**, perché `HudBar.tsx:210-233` non legge il campo — **0 occorrenze in tutti
i componenti**.

**Nota di architettura, anch'essa corretta.** La Timeline di `HudBar` **non** legge da
`useWorldAdvance`: legge dal database, via `useWorldTimeline.ts:100` → `gameApi.timeline()` →
`GET /games/:id/timeline` → `getTimelinePage` → `turn_results`. I due dispatch in
`useWorldAdvance.ts:103,113` alimentano lo **store**, non la Timeline. Sono entrambi da correggere,
ma per ragioni diverse: la Timeline perché non legge il campo che riceve; il percorso HTTP/polling
perché lo butta via prima che lo store lo veda.

**Conseguenza.** Nella Timeline il giocatore vede *quanto* è costato un ordine (delta ed esiti) ma
mai *quale* ordine. La Timeline è anche l'unica superficie del collegamento **senza alcun test**.

---

### E04 — Il percorso compatto non chiede ciò che il motore aspetta

**Misura.** `grep -c` dentro `buildConstrainedSimulationPrompt` (`prompt.ts:103-168`):

| Campo | Protocollo pieno | Protocollo compatto |
|---|---|---|
| `completesProjectId` (chiusura progetto) | richiesto (`prompt.ts:342`) | **0 occorrenze** |
| `commitments` / `commitmentUpdates` | richiesti (`prompt.ts:409-415`) | **0 occorrenze** |

**Questo riguarda il modello che l'autore usa.** Il modello configurato in
`backend-nest/llm.config.json` è `nvidia/nemotron-3-super-120b-a12b:free` (configurazione **locale
non committata**: `HEAD` contiene ancora `glm-5.3-flash`); nei log compare `glm-5.3-flash` 393 volte.
Entrambi cadono nel percorso **compatto** — il primo per `:free`, il secondo per `flash`
(`llm/modelTier.ts:71-88`). Il protocollo compatto è quello che il giocatore usa in pratica, ed è
quello che non chiede né la chiusura dei progetti né gli impegni strutturati.

E gli impegni non arrivano comunque: `parse.ts:430-438` li estrae, ma `agents.ts:110-123` restituisce
un oggetto nuovo **senza i due campi**, mentre `TurnPipelineService.ts:542-545` prova a leggerli.
Misura: `game_commitments` ha **0 righe**, e solo 34 voci su 12.497 menzionano un ultimatum, un
impegno o una promessa.

*Precisazione:* `completesProjectId` **sopravvive** dentro `actionOutcomes` (è nel tipo a
`agents.ts:68`); è il **prompt compatto** a non chiederlo. La perdita in `agents.ts` riguarda solo
`commitments` e `commitmentUpdates`.

---

### E05 — Un ordine `voided` non produce alcuna notizia, e il suo riassunto lo contraddice

**Misura.** Esiti con notizia collegata, per stato:

| Stato | Con notizia |
|---|---|
| `accepted` | 86/139 (62 %) |
| `partial` | 73/119 (61 %) |
| `unresolved` | 30/30 (100 %) |
| `rejected` | 4/6 (67 %) |
| **`voided`** | **0/7 (0 %)** |

La regola esiste ed è scritta — «un ordine respinto o impedito produce comunque la sua notizia»
(`guards.ts:39-45`) — ma il percorso `voided` non la rispetta: `TurnPipelineService.ts:653`
seleziona l'annullamento con `voided.find(r => r.action === item.text)`, cioè con
un'**uguaglianza letterale** del testo dell'ordine.

Peggio: **4 dei 7 riassunti `voided` contengono un verbo di riuscita** («Linea di vendita spot di
carbone e petrolio **avviata**…», «Proposta dell'hub di Barranquilla **accolta** da Brasile…»). Lo
stato dice «non è stato fatto», il testo dice che è stato fatto. Il giocatore non può sapere quale
dei due credere.

---

### E06 — Un run troncato può avanzare il calendario oltre l'ultimo fatto verificato

**Dove.** `TurnPipelineService.ts:343` entra nel playback solo con **almeno due** eventi;
`TurnPipelineService.ts:407` usa `incomplete` soltanto per bloccare la riconciliazione dei movimenti;
`resolvePeriod` (`core/simulation/calendar.ts:70-78`) nel salto **fisso** termina sempre
sull'orizzonte, ignorando `incomplete`.

**Misura (sonda eseguita).** Una risposta NDJSON con **un solo** evento al 5 gennaio e senza record
`complete`:

```
eventi: 1 | incomplete: true | date: [ '2000-01-05' ]
salto FISSO 30gg -> 2000-01-31     <- avanza fino a destinazione
auto-jump 30gg  -> 2000-01-05      <- si ferma al checkpoint
```

Nel percorso auto-jump il motore si comporta correttamente; nel salto a data fissa la stessa
risposta avanza al 31 gennaio. È il difetto che il Playback già evita (`PlaybackService.ts:367`
tratta `incomplete` come `paused_budget`) e che la pipeline ordinaria non ha.

---

## 4. Le invarianti non negoziabili

Valgono per tutte le fasi. Un test che non le difende non è un test di questo piano.

- **I1 — La cronaca appartiene al modello, non al motore.** Il motore può *filtrare* ciò che il
  modello ha scritto, non *sostituirlo* con una frase propria. Le otto frasi di `DiplomacyService`
  sono l'unica eccezione ammessa oggi e questo piano le toglie dalla cronaca.
- **I2 — Una notizia per ordine, sempre.** Un ordine che riesce, fallisce, è respinto, resta impedito
  o non è attuabile produce **la sua** notizia. `voided` incluso.
- **I3 — Il collegamento è per ID, mai per testo.** Il titolo è testo per il lettore, non una chiave.
- **I4 — Stato e riassunto non si contraddicono.** Se l'esito dice `voided`, il testo non contiene un
  verbo di riuscita.
- **I5 — La stessa informazione non compare due volte nello stesso giorno** su due superfici diverse:
  la cronaca racconta, la chat conversa.
- **I6 — Il budget eventi è uno solo**, condiviso da motore, prompt e output. Nessun percorso può
  chiedere più di quanto il motore accetti.
- **I7 — Un run incompleto non avanza il calendario** oltre l'ultimo evento verificato.

---

## 5. Le fasi (E01–E07)

Ogni fase è **consegnabile da sola**, con la sua PR e il suo Quality Gate, in ordine di dipendenza.
La numerazione `E` è libera (verificato: nessun piano esistente la usa; gli altri usano A–D, D-nn,
G-nn, N-nn, V-nn).

---

### E00 — Giocare un turno e rimisurare (prerequisito, non una PR)

**Cosa.** Con la build corrente (che contiene F, compilata il 26/09 alle 17:44) giocare **un turno**
con più ordini in coda e rimisurare: copertura ordine → notizia, voci per turno, quota di frasi
predefinite.

**Perché prima di tutto.** Le fasi E01–E07 poggiano su una fotografia scattata su una build **senza**
F. Se F funziona, la copertura non è più 62 % e le priorità cambiano.

**Attenzione.** Serve una partita **con più ordini nello stesso lotto** (3 o più): è il caso che F
dovrebbe cambiare, ed è il caso che le partite recenti non coprono (9 esiti su 2 run, con 1 e 3
notizie collegate).

**Verifica.** Annotare i numeri di partenza e di arrivo **nello stesso documento**, come si è fatto
per i piani precedenti. Se F non ha funzionato, la fase di riparazione viene **prima** di E01.

---

### E01 — La posizione diplomatica smette di essere una voce di cronaca

**Cosa.** La posizione di una nazione che apre un canale resta **nella chat** (dove ha senso e dove
il giocatore può rispondere) e **dentro** il dispaccio dell'evento che l'ha provocata (il blocco
«Reazioni internazionali» esiste già e funziona). Smette di generare una **seconda** voce di
cronaca con una delle otto frasi di `DiplomacyService.ts:353-361`.

Le otto frasi sopravvivono dove servono davvero — l'**oggetto** della chat e il suo tipo — e
scompaiono dal titolo del dispaccio.

**Attenzione.** Le aperture chat sono eventi diplomatici legittimi (`G21`) e il canale deve restare
apribile: si toglie la *voce di cronaca*, non la chat. Le chat già archiviate non si toccano. Il
blocco «Reazioni internazionali» dentro il dispaccio **non** va rimosso né duplicato: è ciò che rende
visibile la decisione NPC, ed è già al posto giusto.

**Verifica.**
- test che un run con una reazione produca **una sola** voce di cronaca per quel giorno e che la chat
  si apra comunque;
- test-contratto sul sorgente che `DiplomacyService` non scriva più headline di cronaca;
- rimisura su un turno reale: la quota di voci con frase predefinita scende da **28 %** (partite
  recenti) verso zero.

> **Consegnata — la parte che non contraddice una decisione già presa (26/09/2026).**
>
> La misura ha diviso E01 in **due** metà che il piano aveva trattato come una:
>
> | Percorso | Quante voci | Che cosa sono |
> |---|---|---|
> | **automatico** (`reactionChatStarts`) | **132/185 (71 %)** | la controparte reagisce: `kind:'statement'` imposto dal motore, **130/132 (98 %)** con un evento di mondo **dello stesso run** che già porta la stessa posizione |
> | **chiesto dal modello** (`startChat`) | **53/185 (29 %)** | un fatto diplomatico nuovo: riunione, vertice, ultimatum |
>
> Consegnata la **prima** metà. Il canale nasce ancora — il giocatore riceve la notifica e trova la
> chat — ma non produce più una seconda voce di cronaca nello stesso giorno: `reactionChatStarts`
> marca la richiesta con `alreadyNarrated: true` (`game-session.ts:2208-2213`), e
> `openSimulationChats` smista la voce su `suppressedTimelineEvents` invece di `timelineEvents`
> (`DiplomacyService.ts:379-399`).
>
> Il campo è **interno**: il parser dei `startChat` elenca i campi uno per uno e non lo legge, quindi
> il modello non può usarlo per nascondere una notizia. Un test lo difende.
>
> **La seconda metà è una decisione, non una fase.** Togliere dalla cronaca anche i 53 canali chiesti
> dal modello contraddice una decisione già presa e coperta da test — SPEC §G21: «solo aperture chat e
> cambi relazionali esplicitamente committati dal simulatore sono eventi diplomatici». Per quella metà
> il difetto non è il *titolo* («avvia un negoziato» è prosa del motore, non del modello): è che il
> **modello non riceve il titolo** da scrivere, e il motore glielo impone. La correzione giusta è dare
> al modello il titolo della notizia nel `startChat`, non cancellare la riga.
>
> **Verifica eseguita:** 5 test nuovi (`src/game/diplomacyNarration.test.ts`), ognuno provato **anche
> al contrario** — rompendo il codice in due modi diversi il test fallisce in entrambi, quindi non è un
> falso verde; `chats.test.ts` + `diplomacy-service.test.ts` (41 test, i due che esercitano davvero
> questo percorso) verdi; 40 test puri backend verdi; suite backend eseguita a blocchi, tutti i blocchi
> verdi. La rimisura sul turno reale resta la fase **E00**.

---

### E02 — «L'ordine» torna visibile

**Cosa.** Il testo dell'ordine viaggia **con l'esito** (`simulation_action_outcomes` lo conserva già
per `run_id`) e il client lo risolve da lì, non dalla coda viva che il turno ha già svuotato. In
alternativa, e preferibile perché non tocca il protocollo: il dispaccio porta con sé lo **snapshot**
del testo dell'ordine al momento dell'emissione. La coda resta la coda; il dispaccio resta leggibile
anche a distanza di mesi.

**Attenzione.** La regola esistente va mantenuta: **un dispaccio del mondo non finge un ordine** e la
sezione non compare mai vuota (`EventFeed.tsx:210-212`). Se l'ordine non è più ricostruibile, la
sezione resta nascosta — non si inventa un testo.

**Verifica.** Test che dopo un turno completo `actionTextFor` restituisca il testo per un dispaccio
collegato, e `undefined` per uno non collegato. Oggi **non esiste alcun test** su `useFeed` né su
`actionTextFor`: va creato.

---

### E03 — Ogni percorso conserva il collegamento, e la Timeline lo mostra

**Cosa.** Tre parti, una sola PR:
1. `HudBar.tsx:210-233` legge `sourceActionIds` e mostra l'ordine d'origine, come già fanno
   `EventFeed` e `NewsFlash` (oggi: **0 occorrenze** del campo nei componenti).
2. `useSimulationStream.ts:338-340` (polling) e `useWorldAdvance.ts:103,113` (HTTP) includono il
   campo nel payload dello store.
3. Test di parità fra i tre percorsi.

**Attenzione.** La Timeline legge dal **DB**, non dal payload: la parte 1 va verificata sul percorso
`useWorldTimeline` → `gameApi.timeline()`, non su `useWorldAdvance`. Le parti 1 e 2 non si
sostituiscono a vicenda e servono entrambe.

**Verifica.** Test di parità: lo stesso evento costruito dai tre percorsi (SSE, HTTP, polling) porta
lo stesso `sourceActionIds` e produce lo stesso `actionText`. Test che la Timeline mostri l'ordine
quando il campo c'è e non mostri nulla quando manca.

---

### E04 — Il protocollo compatto chiede ciò che il motore aspetta

**Cosa.** `buildConstrainedSimulationPrompt` riceve le due clausole che oggi mancano:
`completesProjectId` per la chiusura dei progetti e `commitments` / `commitmentUpdates` per il
registro degli impegni. Sono già scritte per il percorso pieno (`prompt.ts:342`, `:409-415`): si
condividono, non si riscrivono.

Contestualmente, `agents.ts:110-123` **propaga** i due campi invece di scartarli.

**Attenzione.** Il compatto è il percorso dei modelli deboli: ogni riga aggiunta costa. Le due
clausole vanno aggiunte nella forma più breve che conserva il contenuto, e la misura va fatta sui
caratteri dei due prompt generati, non stimata. Non si allarga il budget in questa fase.

**Verifica.** Test-contratto che **entrambi** i protocolli nominino `completesProjectId` e
`commitments` (etichette condivise, non prosa identica — la trappola già nota). Test che `agents.ts`
restituisca i due campi. Misura dei caratteri dei due prompt prima e dopo.

---

### E05 — `voided` produce la sua notizia, e il testo non contraddice lo stato

**Cosa.** Due parti:
1. L'ordine `voided` produce **la sua** voce di cronaca, come già fanno `accepted` e `partial`. Il
   collegamento si fa per `actionId`, non per uguaglianza letterale del testo
   (`TurnPipelineService.ts:653`).
2. Il riassunto di un `voided` non contiene un verbo di riuscita. O il motore rifiuta il riassunto
   contraddittorio, o lo segnala — ma il giocatore non deve leggere «avviata» accanto a «non
   attuata».

**Attenzione.** Un ordine senza copertura **non è un ordine respinto per volontà politica**: il
primo dice «non c'erano i soldi», il secondo «il governo ha deciso di no». La notizia deve dire
quale dei due. Le sette righe esistenti mostrano che il confine è già confuso.

**Verifica.** Test che un ordine `voided` produca una notizia con `sourceActionIds` non vuoto; test
che un riassunto `voided` con verbo di riuscita venga rifiutato o corretto.

---

### E06 — Un run incompleto non avanza il calendario

**Cosa.** La finalizzazione dei run incompleti diventa **una sola guardia condivisa** da percorso
ordinario e playback. Nel salto fisso, un `incomplete` vero senza chiusura recuperata **non** porta
il mondo a destinazione: si ferma all'ultimo checkpoint valido, e gli ordini non ancora attestati
restano pendenti.

**Attenzione.** `resolvePeriod` è pura e condivisa: il cambiamento va fatto **nei chiamanti**, non
dentro la funzione, altrimenti si altera anche il percorso che oggi è corretto. Il caso
`no_event_found` e il playback non vanno toccati.

**Verifica.** Test a 0, 1 e 2 eventi senza `complete`, per entrambi i protocolli, con chiusura
ausiliaria riuscita e fallita: nessun avanzamento oltre l'ultimo checkpoint valido. La sonda di §3
(E06) è il caso minimo da rendere un test.

---

### E07 — La misura del dispaccio si rispetta

**Cosa.** La misura scelta è una e una sola: **due frasi, 35-60 parole**
(`prompts/immersion.ts:16`, `EVENT_BODY_WORDS`). Misura attuale sui corpi delle partite recenti:
**11/29 = 38 %** dentro la finestra, con una media di **112 parole**.

**Attenzione — e questa è una correzione della v1.0.** Il confronto «112 parole oggi contro 24,6
prima» era **fra popolazioni non omogenee**: lo storico include oltre 8.000 voci con un corpo
segnaposto di poche parole (`Evento ambientale del mondo (turno N).`), che abbassano la media senza
dire nulla sulla qualità. Prima si misura la **distribuzione** delle lunghezze sulle partite
omogenee, poi si decide se è il prompt a chiedere troppo o il modello a eccedere. Non si stringe la
misura in questa fase.

**Verifica.** Distribuzione delle lunghezze prima e dopo, non solo la media; test-contratto che la
misura resti **una** (nessuna seconda formula concorrente nel codice).

---

## 6. Criteri di completamento e verifica

**V1 — La prima verifica è giocare.** La fase E00 precede ogni intervento. Ogni scarto fra la
previsione e la misura va **annotato nel piano**, come si è fatto per i piani precedenti.

**V2 — Nessun difetto si dichiara chiuso senza una misura che lo prova.** Le misure di questo
documento sono le righe di partenza; ogni fase porta la sua riga di arrivo.

**V3 — Ogni invariante ha un test che la difende**, con la guardia contro il falso verde già in uso
nel progetto (un parser rotto non deve far passare il test). Le eccezioni legittime si dichiarano in
una costante, non si silenziano con un filtro.

**V4 — La parità fra percorsi è un test, non una speranza.** SSE, HTTP e polling devono portare lo
stesso `sourceActionIds`; auto-jump, salto fisso e playback la stessa cronaca.

**V5 — Il vocabolario del giocatore.** Il criterio ultimo non è il conteggio delle voci: è che il
giocatore, guardando un turno, veda **la propria azione e la sua conseguenza** sulla stessa riga.
Una misura utile: la quota di voci di cronaca con un ordine collegato **e** il testo dell'ordine
visibile.

---

## 7. Cosa NON fare

- **Non aggiungere guardie al prompt prima di E00 e E01.** Il compatto è già lungo; la causa
  principale delle voci povere non è il prompt, è il motore che scrive le frasi predefinite.
- **Non alzare il budget eventi.** Il tetto c'è per una ragione e il difetto misurato non è di spazio.
  Nota per chi legge il codice: i due `12` di `EventBudget.ts:40` (tetto auto-jump) e
  `prompt.ts:107` (tetto del protocollo compatto) sono **costanti distinte** con semantiche diverse.
- **Non toccare le otto frasi di `DiplomacyService` oltre a ciò che E01 chiede.** Servono per
  l'oggetto della chat e per il tipo di canale.
- **Non rimuovere il blocco «Reazioni internazionali»** dal dispaccio (`game-session.ts:2171-2185`).
- **Non indebolire i test esistenti.** In particolare le guardie di `dispatchSurface.test.ts`,
  `dispatchComposer.test.ts`, `orderCoverage.test.ts` e `modelTier.test.ts`.
- **Non introdurre un generatore di eventi in coda** dopo la risposta del modello: l'invariante G12
  lo vieta, e vale anche per «abbellire» la cronaca.
- **Non confrontare le due tabelle fra loro.** `turn_results.timeline_events` e `simulation_events`
  coprono epoche diverse (104 partite contro 36, 12.308 voci contro 189): ogni misura va fatta
  **dentro** una tabella o sulle **stesse** partite.

---

## 8. Le correzioni rispetto alla v1.0

Una revisione indipendente ha trovato quattro errori di sostanza. Sono qui in chiaro, perché il
piano che li aveva fatti non era utilizzabile senza.

1. **`api.ts:1422` era citata al contrario.** La v1.0 affermava che quella riga «omette il campo»;
   la riga lo **dichiara**. La tesi «i tipi sono incoerenti» cade, ed E03 andava mirata altrove. Il
   difetto vero è nei due percorsi che **buttano via** il campo (`useSimulationStream.ts:338-340`,
   `useWorldAdvance.ts:103,113`), e la Timeline legge dal **DB**, non da `useWorldAdvance`.
2. **La quota delle otto frasi era misurata sulla tabella sbagliata.** La v1.0 diceva «metà della
   cronaca» citando 44 % da `simulation_events` (417 righe) contro una cronaca di 12.497 voci. Il
   numero della cronaca, sulle **stesse** partite, è **35 %**, e **28 %** nelle partite recenti. Il
   difetto resta grave; non era «metà».
3. **Le due date di §2.0 erano su fusi diversi** (UTC contro +0200). La conclusione «la correzione
   non è mai stata giocata» non è dimostrabile così; quella corretta è che l'ultimo run reale
   precede la **compilazione** che contiene F. Il quesito resta il primo del piano, ma con
   l'enunciato giusto.
4. **Numeri minori errati**, tutti corretti: le otto frasi sono a `DiplomacyService.ts:353-361` (non
   356-366); «in tutti e 85 i casi» era **90**; il confronto 112 vs 24,6 parole mescolava popolazioni
   diverse; il totale dei turni con ≥3 voci è **896** (non 876); `classifyModel` è a `modelTier.ts:71-88`
   (non 66-78); il blocco «Reazioni internazionali» è a `game-session.ts:2171-2185` (non
   2182-2202); gli ordini collegati sono 143 distinti (148 riferimenti); la suite frontend impiega
   ~166 s e la configurazione del modello in `llm.config.json` è **locale non committata**.

---

## 9. Le quattro segnalazioni dell'autore (27 settembre 2026)

L'autore ha segnalato quattro cose, tutte verificabili. Tre sono difetti precisi, uno è una
decisione di prodotto. La misura le ha separate.

### S1 — «Gli eventi aprono chat con governi non pertinenti» — **corretto**

**Il filtro esisteva e il percorso principale lo lasciava spento.**
`reactionChatStarts(events, pruneIrrelevant)` aveva default `false`; il percorso **in pausa** lo
accendeva esplicitamente (`PlaybackService.ts:291` → `true`), quello **ordinario** no
(`TurnPipelineService.ts:528`). Due percorsi, due comportamenti: nel turno normale il modello — che
non conosce la geografia — poteva far reagire chiunque.

**Correzione.** Il default diventa `true` (`game-session.ts:2199`). Il filtro scarta davvero (`return
[]`), non riordina.

**Un secondo bug trovato mentre correggevo.** Il contratto delle reazioni valida già `actorId` contro
il `ReactionContext` — la scelta degli attori è **del motore**, non del testo dell'evento. Ma
`canonicalizeEventReactions` filtrava per pertinenza **geografica** usando solo il testo: una
controparte ammessa dal contratto ma non nominata nella frase veniva scartata, **e la sua chat
spariva**. Ora gli attori ammessi dal contratto entrano come seme di pertinenza
(`game-session.ts:2145-2150`).

**Verifica.** 3 test nuovi (`diplomacyNarration.test.ts`), provati al contrario: spegnendo il filtro
fallisce il primo, togliendo il seme fallisce il terzo. `chats.test.ts` (24 test) verde — è la suite
che esercita davvero le aperture chat.

### S2 — «Ho costruito una strada ma le variazioni non si vedono» — **misurato, non corretto**

**Misura.** Su `game_regions`, gli oggetti non-città in tutta la base:

| Tipo | Quantità |
|---|---|
| `construction_site` | **51** |
| `battalion` / `army` / `fleet` / `mobilization` | 30 / 5 / 2 / 17 |
| **opere finite** (`factory`+`port`+`university`) | **19** |
| **`infrastructure`** | **0** |

Dei 51 cantieri: **18 infrastrutture, 15 fabbriche, 11 fortificazioni**, ma **45 su 51 non hanno una
data prevista**. In tutte le partite recenti il giocatore ha **solo** `construction_site`: nessuna
opera è mai diventata operativa.

**La causa, nel codice.** Il meccanismo esiste ed è completo: `start_construction` crea il cantiere,
`complete_construction` promuove l'oggetto al tipo finale (`WorldMutationService.ts:341-380`). Ma
**niente chiude un cantiere alla scadenza**: `metadata.expectedDate` viene scritto
(`construction-progress.ts:13`) e **letto solo dal frontend**, che lo mostra come «Previsione (non
garantita)». Il motore invece, per i **progetti nazionali**, chiude alla data prevista
(`game-session.ts:1582`). Quindi: un cantiere aperto resta aperto per sempre, e il giocatore vede un
cantiere, mai una strada.

**Il rimedio è già scritto per i progetti**: `game-session.ts:1573-1590` chiude un `ongoing_process`
alla scadenza con «Opera completata». La stessa regola va applicata agli **oggetti mappa**, e l'oggetto
promosso va poi pubblicato al client (già possibile: `game_regions.objects` è serializzato).

**Attenzione.** Non si promuove un cantiere con la sola data se il tipo finale non è noto
(`plannedType`): è il campo che dice *cosa* diventa. Un cantiere senza `plannedType` resta aperto e lo
dichiara.

### S3 — «Il mondo non reagisce» — **misurato, non corretto**

**La catena.** `canonicalizeEventReactions` filtra per pertinenza; se **nessuna** reazione sopravvive,
resta solo il blocco narrativo. Il numero delle reazioni è deciso dal **`ReactionContext`**, che il
prompt descrive come «attori e opzioni ammesse dal motore» — cioè il motore *chiude* le reazioni
possibili, non le genera.

**Conseguenza misurata.** L'esito del filtro dipende da quanto è documentato il teatro: in un mondo
povero di relazioni registrate, `crisisRelevantPolityIds` produce un insieme piccolo, il filtro
scarta, e la scena resta muta.

**Attenzione — questa è una decisione, non una correzione.** Allargare il filtro per far parlare più
nazioni riporta il difetto **S1** («chat con governi non pertinenti»): i due sono in tensione diretta.
La scelta non va presa dentro una PR. Le direzioni possibili, da decidere con l'autore:

1. rendere più ricco il **`ReactionContext`** (più attori ammessi dal motore, con causa documentata) —
   è il posto giusto, e non tocca il filtro;
2. dichiarare nel teatro della crisi **anche i vicini di secondo grado** con un rapporto non neutro;
3. lasciare il filtro com'è e accettare che in un mondo senza relazioni registrate il mondo taccia —
   è il comportamento più conservativo.

**Verifica.** Prima di scegliere: misurare, su un turno reale, quante `reactions` arrivano dal modello
e quante sopravvivono al filtro. Oggi quel numero **non è mai stato misurato**.

### S4 — «Le sfide sono non coerenti con il gioco» — **misurato, non corretto**

**Misura.** `generatePressures` promette «sfide a partire dagli indicatori reali della nazione — mai
inventate». Il codice: `bestOf` sceglie la candidata con punteggio più alto **separatamente** per
`internal` ed `external`, e se una categoria non ha candidate usa
`BASELINE_INTERNAL` / `BASELINE_EXTERNAL` (`PeacetimePressures.ts:795-796`).

**I due ripieghi spiegano i conteggi.** Su 444 pressioni in archivio:

| Template | Conteggio |
|---|---|
| `trade-dispute` | **148** |
| `corruption-scandal` | **127** |
| tutti gli altri (11 template) | 169 |

Due template su tredici fanno il **62 %** delle sfide. Non perché siano i più pertinenti: perché sono
i più **permissivi** da attivare, e perché il ripiego li ripropone quando il generatore specifico non
scatta. E il conteggio esclude una spiegazione di qualità: una sfida ricorrente non è una sfida
coerente.

**Stato: 368 attive, 69 scadute, 7 risolte.**

**Direzione.** Il ripiego non deve esistere quando gli indicatori *non* giustificano una sfida: una
nazione con i conti in ordine e nessun vicino ostile può avere **una** sfida, non due per
costruzione. Va verificato, per ogni template, **quale indicatore** lo attiva e con quale soglia, e
il ripiego va reso dichiaratamente un'ultima spiaggia — o rimosso.

**Verifica.** Distribuzione dei template **prima e dopo**, per partita; e quante sfide nascono da un
ripiego invece che da un indicatore.

---

## 10. Ciò che il piano non può risolvere da solo

Due questioni restano **decisioni dell'autore**, non fasi tecniche, e non vanno aggirate:

1. **Che cosa rende un evento «importante».** La misura attuale è una definizione del motore
   (`isDecisiveNpcDecision`: una reazione `counterparty` o una `counterAction`), non un giudizio di
   valore. Se il giocatore vuole fermarsi su svolte che il motore considera contorno — una crisi
   economica, un cambio di governo — quella definizione va ampliata, ed è una scelta di prodotto.
2. **Il confronto con Pax Historia va fatto una volta per tutte, sulle fonti.** Le fonti autentiche
   sono in `docs/ref/original/` (`forward.txt`, `actions.txt`, `userchat.txt`). Il confronto della
   campagna §16 è ancora aperto (G23). Nota di rigore già registrata: in `forward.txt` il limite di
   30 eventi (`:45`) viene poi contraddetto da 25 (`:148`), e il limite «15-25 parole» di
   `actions.txt:13` riguarda i *Topics of Concern*, **non** i dispacci della timeline. Il riferimento
   non va idealizzato: va letto per intero prima di dichiarare che «Pax ha eventi migliori».

---

## Appendice — le misure, verificate una per una

| Grandezza | Valore misurato | Dove |
|---|---|---|
| Voci di cronaca totali | 12.497 | `turn_results.timeline_events` |
| Voci con una delle 8 frasi — **stesse 36 partite** | 66/189 = **35 %** | `turn_results` |
| Voci con una delle 8 frasi — payload del run | 185/417 = **44 %** | `simulation_events` |
| Voci con una delle 8 frasi — partite dal 23/09 | 8/29 = **28 %** | `turn_results` |
| Note diplomatiche che citano un evento **dello stesso run** | **183/183 = 100 %** | testo della nota |
| Arresti del salto con una frase in quel giorno | 90/124 = **73 %**; in **tutti** c'è anche un evento di mondo | `checkpoint_date` |
| Run la cui **ultima** voce è una frase predefinita | 90/124 = **73 %** | `simulation_events` |
| Voci di cronaca con `sourceActionIds` — tutte le partite | 62/12.497 = **0,5 %** | `turn_results` |
| Voci di cronaca con `sourceActionIds` — partite dal 23/09 | 14/29 = **48 %** | `turn_results` |
| `sourceActionIds` in `frontend/src/components/` | **0 occorrenze** | grep |
| Ordini collegati in `pending_actions` | **0**/143 | `pending_actions` |
| Ordini collegati in `actions` (tabella senza letture) | 69/143 | `actions` |
| `voided` con notizia collegata | **0**/7 | `simulation_action_outcomes` |
| `voided` con verbo di riuscita nel riassunto | 4/7 | `simulation_action_outcomes` |
| `accepted` / `partial` con notizia | 86/139 / 73/119 | `simulation_action_outcomes` |
| `completesProjectId` nel protocollo compatto | **0** occorrenze | `prompts/simulation/prompt.ts` |
| `commitments` nel protocollo compatto | **0** occorrenze | `prompts/simulation/prompt.ts` |
| Righe in `game_commitments` | **0** | DB |
| Corpi dentro 35-60 parole (partite dal 23/09) | 11/29 = **38 %** | `turn_results` |
| Voci per turno: 1 / 2 / ≥3 | **2.307 / 2.732 / 896** | `turn_results` |
| Media voci per turno | **2,1** | `turn_results` |
| Run falliti | 31/175 = **18 %** (10 credenziali, 9 `actionId` sconosciuto) | `simulation_runs` |
| Ultimo run reale con esiti | 26/09 **10:08** locali (08:08 UTC) | `simulation_runs` |
| Commit fase F / merge PR #120 | 26/09 **08:25** / **10:00** | git `3f457ae`, `d24d895` |
| Compilazione backend con F | 26/09 **17:44** | `backend-nest/dist/` |
| Suite frontend | **858 test**, 102 file, ~166 s | `vitest run` |

**Nota di lettura.** Le due righe sulle otto frasi non si contraddicono: misurano **due registri
diversi** sulle **stesse** partite. La terza riga (partite dal 23/09) è la più rappresentativa dello
stato attuale, perché è l'unica epoca giocata con le correzioni recenti.
