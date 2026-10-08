# Piano — La forma delle proposte e il contesto dei ministri

> **Stato:** **T01–T08 eseguiti, più T04-ter** (2026-10-08). T08 (verifica
> indipendente) ha trovato **quattro errori reali**, tutti corretti (§9). Una
> misura successiva ne ha trovati **altri tre**, tutti nello stesso punto: la
> chiusura del difetto del 16:43. **La causa vera era nel repair mirato**, che era
> l'unico punto del sistema a chiedere proposte **senza** mosse — e non costava
> nulla correggerlo, perché quella completion si paga già (§8, T04-ter).
> **Rischio residuo dichiarato:** una sola mossa nel repair scarta la proposta
> (limite 2-5 di P01): allentarlo è una scelta dell'autore.
> **Origine:** misura del 2026-10-08 su tre schermate della partita dell'autore
> (preset *millennium*, Palestina, 2000) e sul codice in `backend-nest` e
> `frontend`.
>
> **Le tre schermate, decodificate.**
>
> | ora | cosa mostra |
> |---|---|
> | 16:40 | Seduta del Consiglio su «Gerusalemme: mandato per lo statuto finale». Il ministro degli Esteri apre con: *«Presidente, non ho nulla da portare al consiglio in questo momento. Chiedimi quello che vuoi.»* |
> | 16:41 | La card del Consulente: titolo immersivo, domanda concreta, **tre mosse** scritte come ordini, e il pulsante **«Porta al Consiglio»**. |
> | 16:43 | «Situazioni sul tavolo»: titolo, sintesi, e il solo pulsante **«Approfondisci»**. **Nessuna mossa.** |
>
> **La richiesta dell'autore, in due parti.**
> 1. *«Se scelgo una qualsiasi strada da portare in consiglio, i ministri non sanno nulla.»* → un difetto.
> 2. *«Preferisco che le proposte da portare sul tavolo siano in questa forma»* → 16:41, non 16:43.

---

## 1. La misura

### 1.1 Il formato che l'autore vuole esiste già — ma solo su una delle due strade

Il percorso `council_issue` (P01/P02) è **esattamente** la forma del 16:41:
`CouncilIssue.options` (`{title, content}`, 2–5 mosse), la card cliccabile in
`CouncilIssueInline.tsx`, il clic che riempie la bozza via `openIssue(issue,
chosenOption)`. Difeso da `councilOptions.test.ts` e `proposalsSurface.test.ts`.

La strada delle **situazioni** — quella del 16:43 — non ha mosse, e non può
averle:

- `AdvisorSituation` (`frontend/src/services/api.ts:2088`) ha
  `{id, title, summary, signalKeys?, evidenceKeys?, kind?, importance?}`.
  **`options` non esiste.**
- `advisorSituationInputSchema` (`AdvisorSituations.ts:40`) non lo accetta.
- `AdvisorSituationsPanel.tsx` rende titolo, sintesi e **un solo** pulsante.

Quindi il 16:43 non è un difetto di resa: è una **capacità assente**. L'autore
vede due forme diverse perché due forme diverse esistono.

### 1.2 Il difetto: perché i ministri «non sanno nulla»

La frase dello screenshot è **letteralmente** nel codice, in due punti.
Misurata con una prova eseguibile su `renderMinisterOpening` (sonda poi
rimossa):

```
(a) sedia senza voci di dossier + situazione senza fatti verificati
    → "Presidente, non ho nulla da portare al consiglio in questo momento."
(b) sedia senza voci di dossier + situazione CON fatti verificati
    → "Presidente, partiamo dal dato disponibile: Tensione sociale 48/100. …"
```

Il percorso, per intero:

1. `GovernmentOffice.openIssue` → `startRoom(rapporteur, issue)` → la stanza si
   apre. **La `CouncilIssue` arriva correttamente ai ministri** via
   `councilContext` → `sourceIssue` → `MinisterDialogue` → `[SOURCE ISSUE]`.
   *Questa parte funziona.*
2. Ma la situazione del 16:43 **non è una `CouncilIssue`**: è un
   `AdvisorSituation`, senza mosse. Quando la si porta al tavolo, la bozza nasce
   vuota e i ministri non hanno nulla da leggere.
3. `MinisterChat.briefingFor` (`:98`) inietta nel prompt, quando la sedia non ha
   voci: *`'Non hai nulla da portare al consiglio in questo momento.'`*
4. `renderMinisterOpening` (`MinisterOpening.ts:239-241`): se il modello non
   risponde entro 12 s, o se la sua prosa è respinta, e `verifiedFacts` è vuoto,
   ricade su `fallbackFirstMessage(seat, items)` con `items` vuoto →
   **il saluto vuoto del 16:40**.

### 1.3 Il difetto nascosto: la prosa buona viene respinta

`validateMinisterOpening` rifiuta ogni numero che non sia già nell'elenco
verificato. Misurato:

```
prosa su Gerusalemme senza cifre          → true   (accettata)
la stessa prosa con «dopo il 1967»        → false  (respinta)
la stessa prosa con «la risoluzione 242»  → false  (respinta)
```

Un anno storico o un numero di risoluzione **non sono cifre del motore**: sono
identità. La guardia, giusta per i bilanci, qui respinge la prosa più naturale
di un ministro degli Esteri — e la sostituisce col saluto vuoto. Le due cose si
sommano: il modello scrive bene, il validatore lo boccia, il fallback dice
«non ho nulla».

### 1.4 Il vincolo materiale

L'apertura ha **12 secondi** (`renderMinisterOpening`, `timeoutMs = 12_000`) e
**nessuna seconda chiamata LLM**. Non è un difetto da correggere: è una scelta
giusta (una seduta non deve restare appesa). Il piano la rispetta.

---

## 2. Le invarianti

Valgono per tutte le fasi. Le sigle `T-I…` sono citate nei test.

- **T-I1 — Il motore non parla per il giocatore.** Le mosse sono prosa
  preparata, mai un'azione eseguita: il clic prepara la bozza, la firma resta
  l'unico atto. (Eredita `P-I2`.)
- **T-I2 — Le mosse sono prosa, non fatti.** Nessuna chiave, nessuna cifra,
  nessun effetto dentro una mossa. `options` non è mai una fonte canonica.
- **T-I3 — Una questione porta sempre qualcosa da discutere.** Se una
  situazione arriva al Consiglio, i ministri ricevono titolo, domanda e fatti;
  **mai** la frase «non hai nulla da portare» quando una questione è sul tavolo.
- **T-I4 — Il fallback non mente.** Una risposta deterministica non deve
  dichiarare che non c'è nulla quando il motore ha una situazione in mano.
- **T-I5 — Retrocompatibilità.** Una proposta senza opzioni e una situazione
  senza mosse restano valide e rendono com'erano. (Eredita `P-I5`.)
- **T-I6 — Le cifre del motore restano intoccabili.** Si allarga la guardia ai
  **non-numeri** (anni, risoluzioni); i numeri misurati restano verificati come
  oggi.

---

## 3. Le fasi

### T01 — Misurare la forma delle mosse nella situazione *(nessun codice)*

**Perché prima.** T02–T04 toccano lo schema di una scheda che il modello emette
e il server valida. Prima di allargarlo, misuro **quante** situazioni il
Consulente produce davvero e **quante** restano senza proposta.

**Cosa.** Uno script di misura che, su un preset reale in briefing mode, conta:
situazioni emesse, situazioni coperte da almeno una `council_issue`
(`withAdvisorBriefingCoverage`), situazioni scoperte
(`uncoveredAdvisorSituations`). Numeri, non impressioni.

**Consegna.** I numeri in §5 di questo documento, misurati. Se le situazioni
scoperte sono zero, T04 scende di priorità e resta solo come rete.

**Prova.** Nessuna (è una misura). Il risultato si scrive nel documento.

---

### T02 — La mossa entra nella situazione *(backend)*

**Cosa.** `AdvisorSituation.options?: CouncilOption[]` (lo stesso tipo delle
proposte), con la **stessa forma**
di `CouncilIssue.options` (`{title, content}`), **stesso schema** (2–5, titolo
2–80, contenuto 10–400).

**Dove.** I cinque posti dello standard — la lezione di H02/H03: una cosa nuova
vive in cinque posti, o non è standard.

1. il tipo e lo schema (`AdvisorSituations.ts`);
2. il prompt del Consulente: la sezione `[OPZIONI]` di
   `COUNCIL_ANCHOR_PROTOCOL` è già scritta e di qualità — si **riusa**, non si
   riscrive una seconda;
3. il trasporto (`serializeAdvisorResponse`, `parseAdvisorSituations`);
4. la memoria del Consulente (`frontend/src/components/Game/advisorMemory.ts`:
   `sanitizeIssues` conosce
   `options`; `sanitizeSituations` **no** — è lo stesso difetto già corretto per
   le proposte in P03);
5. la specifica in `docs/STANDARD_FILONI_PRESET.md` se tocca i filoni, altrimenti
   in questo documento.

**Prova (`T-I2`, `T-I5`).** Una situazione **senza** `options` resta valida e
rende come oggi. Una situazione con `options` le conserva al round-trip. Una
mossa con una chiave dentro (per esempio `signalKey`) **perde la chiave** e la
scheda vive: le mosse sono prosa, e la chiave non raggiunge il motore comunque.
(Vedi §8: la prima versione rendeva la scheda morta, ed era un errore — più
severo del principio P09 «degrada, non uccide» che diceva di applicare.)

---

### T03 — La card della situazione mostra le mosse *(frontend)*

**Cosa.** `AdvisorSituationsPanel.tsx` rende le mosse come
`CouncilIssueInline.tsx` già fa: card cliccabili, `aria-pressed`, titolo e
contenuto. E accanto — **solo se la situazione ha mosse** — il pulsante
«Porta al Consiglio», che chiama lo stesso `openIssue`.

**Il punto delicato.** Una situazione **senza** mosse non deve mostrare un
pulsante che porta al Consiglio: sarebbe la promessa di un atto che non esiste
(`T-I3`). Resta «Approfondisci», come oggi.

**La scelta di progetto.** Le mosse della situazione **preparano la stessa
bozza** delle proposte: un solo percorso, non due. Il compositore e la firma
restano quelli.

**Prova (`T-I1`, `T-I5`).** Il clic su una mossa **non** invia nulla: nessuna
chiamata al server dentro il gestore; passa a `onOpenIssue`. La situazione senza
mosse rende esattamente come prima (guardia contro il falso verde: si confronta
il markup con e senza `options`).

---

### T04 — La copertura diventa una rete, non una speranza *(backend)*

**Perché.** `withAdvisorBriefingCoverage` **misura** le situazioni scoperte ma
non fa nulla per coprirle. Se T01 mostra che restano scoperte, quelle schede
arrivano al tavolo senza proposta — cioè nella forma del 16:43.

**Cosa.** In briefing mode, per ogni situazione scoperta, il server emette una
`council_issue` **derivata dalla situazione stessa**: titolo della situazione,
domanda dalla sintesi, opzioni dalle mosse della situazione (o, se assenti,
nessuna opzione — mai inventate).

**Il limite.** Le opzioni si prendono **solo** da quelle che il modello ha già
scritto nella situazione. Il server non inventa mosse: le sposta di posto.
Se la situazione non ha mosse, la proposta nasce senza opzioni — ed è
onesto (`T-I2`, `T-I5`).

**Prova (`T-I3`).** Per ogni situazione del briefing, o esiste una proposta che
la copre, o la copertura lo dichiara. Nessuna situazione arriva al tavolo senza
che il sistema sappia di non averla coperta.

---

### T05 — Il ministro con una questione sul tavolo non dice «non ho nulla» *(backend)*

**È il difetto dello screenshot 16:40.** Tre correzioni, in ordine di
profondità.

**(a) Il fallback guarda la situazione.** `renderMinisterOpening`
(`:239`) sceglie fra due rami: i fatti verificati, o il saluto vuoto. Manca il
terzo ramo: **c'è una situazione in seduta**. Se `brief.situation` esiste, il
fallback apre **dalla situazione** — titolo e domanda — anche senza cifre. Il
saluto vuoto resta solo quando non c'è né fatto né situazione.

**(b) Il prompt non dichiara il vuoto.** `MinisterChat.briefingFor` (`:98`)
inietta *`'Non hai nulla da portare al consiglio in questo momento.'`* quando la
sedia non ha voci — **anche dentro una seduta**. La riga va condizionata: se la
stanza porta una `sourceIssue` o una `sourceSituation`, non si dichiara il
vuoto. È la correzione più piccola e la più visibile.

**(c) La prosa con un anno non si respinge.** `validateMinisterOpening` respinge
`1967` e `242` (misurato in §1.3). La guardia si stringe: resta severa sui numeri
**misurati** (bilanci, scorte, prontezza) e non tocca gli identificatori —
gli anni a quattro cifre e i riferimenti a risoluzioni e articoli.

**Prova (`T-I3`, `T-I6`).** Una seduta con situazione e senza fatti **non**
produce il saluto vuoto. Una prosa con «dopo il 1967» è accettata; una prosa con
«il debito è al 100%» quando il motore dice 110% è **ancora respinta**.

---

### T06 — La bozza che nasce da una situazione ha un contenuto *(frontend)*

**Cosa.** Quando si porta al Consiglio una situazione **con** una mossa scelta,
la bozza si compila con quella mossa — come già accade per le proposte
(`openIssue(issue, chosenOption)`). Quando si porta una situazione **senza**
mosse, la bozza si compila col **testo della situazione**: titolo, sintesi e
domanda diventano il punto di partenza che i ministri leggono.

**Perché conta.** È il secondo pezzo del «i ministri non sanno nulla»: anche con
T05 fatto, una bozza vuota non dà loro nulla da discutere.

**Prova.** Una bozza che nasce da una situazione senza mosse non è mai vuota: ha
il testo della situazione.

---

### T07 — Il registro delle fasi in `docs/` *(documentazione)*

**Cosa.** `docs/PROPOSTE_CONSIGLIERE_PARITA_PAX.md` è il documento della parità
Pax. T02–T06 ne sono il seguito: le stesse mosse, sulla strada delle situazioni.
Si aggiunge una sezione **§12 — Le situazioni prendono le mosse (T01–T08)** con
i rinvii, così chi legge il documento della parità trova dove finisce.

Aggiornare `docs/STANDARD_FILONI_PRESET.md` **solo** se T02 tocca davvero i
filoni: se le mosse restano nel Consulente e non nel preset, non si tocca.

---

### T08 — Verifica indipendente *(nessun codice)*

**Cosa.** Far smontare il lavoro da un secondo agente: le prove difendono davvero
le invarianti, o sono scritte per passare? I numeri di T01 sono citati o
aggirati? Il metodo dell'autore lo chiede prima di consegnare — e ha già trovato
quattro errori reali.

**Consegna.** Gli errori trovati, in una sezione di questo documento, come in
`PROPOSTE_CONSIGLIERE_PARITA_PAX.md` §11.

---

## 4. Ordine e confini

**L'ordine.** T01 (misura) → T02 (il tipo) → T03 (la card) → **T05 (il
difetto)** → T06 (la bozza) → T04 (la rete) → T07 → T08.

T05 è il difetto che l'autore ha visto e si può correggere **subito**, anche
prima di T02: le tre correzioni non dipendono dalle mosse. Se l'autore vuole una
correzione sola e immediata, è T05.

**Cosa NON entra nel piano.**

- **Non** si costruisce una seconda superficie per le mosse: la card delle
  proposte esiste (`CouncilIssueInline`), si riusa.
- **Non** si allunga il timeout di 12 secondi: una seduta non resta appesa.
- **Non** si aggiunge una seconda chiamata LLM al fallback.
- **Non** si fa scrivere al server le mosse: le scrive il modello, il server le
  valida e le sposta. Un server che inventa mosse sarebbe una fonte di fatti
  falsi (`T-I2`).

**Il rischio dichiarato.** T02 allarga lo schema di una scheda che il modello
emette. Il difetto già visto in P09 — il modello inventa chiavi, il server
rifiuta, la card sparisce — vale anche qui: `options` va aggiunto **conservando**
il comportamento di P09 (la chiave ignota degrada, la scheda non muore).

---

## 5. T05 eseguito — cosa è cambiato

Eseguito il 2026-10-08. `tsc --noEmit` pulito. Prova nuova
`backend-nest/tests/t05-ministri-sanno.test.ts`, **13 prove**, tutte verdi.
Non-regressione sui cinque file che difendevano i punti toccati
(`ws-minister-natural-dialogue`, `p02b-minister-chat`, `ws-minister-ux-02`,
`government-situation-opening`, `government-prompt`): **49 prove verdi**.

### I tre cambi

**T05a — il fallback guarda la situazione.** `MinisterOpening.ts`: la scelta a
due rami (fatti verificati / saluto vuoto) diventa a **tre**, in una funzione
nuova e provabile da sola, `deterministicOpeningReply`:

1. fatti verificati → si parte dal primo fatto *(come prima)*;
2. **situazione senza fatti → si apre dalla situazione**: titolo e domanda;
3. nessuna situazione e nessuna voce → saluto vuoto *(come prima)*.

Il ramo 2 è nuovo, ed è quello che rende impossibile la frase del 16:40 quando
una questione c'è.

**T05b — il dossier non dichiara il vuoto in seduta.** `MinisterChat.ts`:
`briefingFor` accoglie un parametro `inSession`. Dentro una seduta la riga *«Non
hai nulla da portare al consiglio in questo momento»* **non si scrive**, e al suo
posto il ministro legge che la questione è già sul tavolo e va portata dalla sua
competenza, senza inventare cifre. Il parametro lo passa il chiamante vero
(`MinisterDialogue.composeMinisterDialoguePrompt`), che sa della seduta da
`brief.council || brief.sourceIssue`.

**T05c — un anno non è una cifra che misura.** `OpeningNarrative.ts`:
`narrativeNumbersAreVerified` ammetteva solo i numeri già presenti nel materiale
verificato, e respingeva «dopo il 1967» o «la risoluzione 242» — bocciando la
prosa più naturale di un ministro degli Esteri. Ora ammette gli
**identificatori**: gli anni (quattro cifre) introdotti da una parola d'epoca, e
i numeri di risoluzione, articolo, legge, trattato, clausola.

### Il confine, e perché è stretto apposta

Due gruppi di parole, non uno:

- **epoca** (`anno`, `anni`, `nel`, `del`, `dopo`, `prima`, `secolo`, `epoca`)
  ammette **solo** un anno a quattro cifre;
- **documento** (`risoluzione`, `articolo`, `legge`, `trattato`, `decreto`,
  `clausola`, `comma`, `protocollo`) ammette il numero che nomina la clausola.

La ragione è misurata: con un gruppo solo, «dopo il 250» sarebbe passato per una
data. La prova difende il confine da entrambi i lati — `1967` e `242` passano,
`dopo il 250` e `nel 80 per cento dei casi` no, e una cifra di bilancio alterata
resta **respinta**.

### Un errore mio, dichiarato

La prima versione di questa prova pretendeva che `«nel 1867 accadde»` fosse
respinto senza riscontro nel materiale verificato. La prova è caduta, e ad avere
ragione era il **codice**, non il test. Un anno nomina un'epoca: la guardia non è
un fact checker della storia, e fingere che lo fosse sarebbe stato peggio che
ammetterlo. Ho corretto il test, non la guardia — e il motivo è scritto dentro
la prova, dove chi legge lo trova.

### Cosa T05 **non** ha toccato

Le mosse delle situazioni (T02–T04) e la bozza quando nasce da una situazione
senza mosse (T06): il secondo pezzo del «i ministri non sanno nulla». Con T05
fatto, i ministri **sanno della questione**, ma non hanno ancora le mosse da
discutere. È il prossimo passo naturale.

---

## 6. T06 eseguito — la strada scelta entra nella stanza

Eseguito il 2026-10-08. Prova nuova
`frontend/src/components/Game/t06-strada-scelta.test.ts`, **10 prove**, verdi.
Suite frontend **intera**: **174 file, 1475 prove, zero rosse**. `tsc --noEmit`
pulito.

### La misura ha cambiato il piano — in peggio

Misurando prima di scrivere, ho trovato un difetto **più grave** di quello
descritto nel piano originale. Il piano diceva: «quando si porta una situazione
senza mosse, la bozza si compila col testo della situazione». Vero, ma non era
il problema.

Il problema vero: **la strada scelta non arrivava ai ministri.** I ministri
leggono la Tavola, non il testo della bozza —
`councilRun` → `projectCurrentDecision(current.sharedBoard)`. E
`projectCurrentDecision` proietta la **Tavola della discussione**
(`room.sharedBoard`), che una stanza appena aperta ha **vuota**.

Quindi, portando una mossa in Consiglio:
- la bozza riceveva il testo della mossa *(P02, già fatto)*;
- la Tavola restava vuota;
- i ministri ricevevano `currentDecision` con `measures: []`;
- e rispondevano «non ho nulla da portare» — **anche con T05 fatto**, perché
  T05 toglie la dichiarazione di vuoto dal *dossier*, ma la Tavola vuota restava.

Il piano diceva che T06 era «la bozza che nasce da una situazione». Era anche
questo, ma il pezzo che contava era un altro.

### I due cambi

**T-B1 — la strada scelta è una misura della Tavola.** `councilRoom.ts`:
funzione nuova `seedChosenRoad(room, chosenOption, messageId)`. Scrive la mossa
come **misura** della Tavola con `source: 'president'` (la provenienza vera: è
il Presidente che ha scelto) e l'obiettivo tratto dal **titolo della questione**,
non dalla mossa — se l'obiettivo fosse la mossa, i ministri discuterebbero la
mossa invece della questione. La scelta entra anche nella cronologia come
**evento** (`kind: 'event'`, nessuna sedia): è un atto del Presidente, non la
battuta di un ministro. Una seconda scelta **sostituisce** la prima: una sola
direzione del Presidente.

**T06 — la bozza non nasce mai vuota.** `councilDraft`: senza misure la bozza
porta la **domanda** della questione e una riga esplicita che il testo si
definirà in seduta. E `GovernmentOffice.openIssue` depone la bozza **sempre**,
non solo quando una mossa è scelta.

### Le prove, e i due rossi che hanno insegnato

Le prove difendono T-B1 (la misura arriva a `projectCurrentDecision` con la
provenienza vera; l'obiettivo è la questione; l'evento non ha sedia; una seconda
scelta sostituisce la prima; seminare non firma e non accoda) e T-I3 (la bozza
vuota porta la questione).

Due prove **preexsistenti** sono cadute, e la lezione vale più del codice:

1. `proposalsSurface.test.ts` pretendeva la riga
   `const room = startRoom(rapporteur, issue)`. L'avevo riscritta come
   `const started = startRoom(...)`. Il test difendeva una **forma** che era
   anche una garanzia: la stanza si apre in un punto solo. Ho rimesso la riga
   nella sua forma originale invece di aggiustare il test.
2. `t06-strada-scelta.test.ts` (mia) pretendeva `...(chosenOption?.content.trim()`.
   Il compilatore ha poi rivelato che `RoomDraft` esige `signatureKey`: la forma
   senza mossa non poteva non averlo. Ho capito che la chiave identifica la
   **preparazione** (e il retry), non la firma — e l'ho data a entrambi i rami,
   semplificando il codice. Il test è stato allineato alla forma migliore.

### Cosa manca ancora

**T02–T04**: le mosse nelle **situazioni**. Con T05 e T06, una questione portata
in Consiglio arriva ai ministri e ha un punto di partenza — ma le situazioni
continuano a non avere mosse da scegliere (il 16:43). È l'ultimo pezzo della
forma del 16:41.

---

## 7. T01 — La misura, e cosa ha cambiato

Misurato il 2026-10-08. Prova permanente:
`backend-nest/tests/t01-situazioni-scoperte.test.ts`, **4 prove**.

**Il limite della misura, dichiarato.** Il database dell'autore **non conserva**
le conversazioni del Consulente: `chats` e `chat_messages` sono **zero righe**.
Una misura sulle sue partite non era disponibile. La misura usa quindi la stessa
forma del fixture standard (Uganda 2000) e varia lo **stato del paese**.

**I numeri** (situazioni = segnali fuori dal dominio decisione):

| stato | segnali | situazioni | scoperte |
|---|---|---|---|
| una crisi sola (carestia, deficit, instabilità, tensione) | 4 | 4 | **4** |
| due vicini ostili + due opere in ritardo | 8 | 8 | **8** |
| Stato stabile e ricco | 1 | 1 | **1** |
| collasso (4 vicini ostili, cassa e scorte a zero) | 8 | 8 | **8** |

**Cosa dicono, e come hanno cambiato il piano.**

1. **Senza proposte, ogni situazione è scoperta.** Non è la copertura a mancare:
   è che nessuno genera le proposte. T04 è quindi necessaria, e la misura non
   l'ha declassata.
2. **`buildAdvisorSituations` non distingue problema da opportunità.** È una
   proiezione 1:1 dei segnali (`situations.map(s => s.signalKeys[0])` è
   esattamente `segnali.map(s => s.key)`) e non ha mai `kind`. Questa è la
   scoperta che ha **limitato T04**: il server deterministico non sa quale
   decisione sia concretamente disponibile su una situazione. Solo il modello,
   scrivendo le mosse, lo dice. Da qui la regola di T04 — la rete copre solo le
   situazioni che hanno mosse, e per le altre la copertura lo **dichiara**.
3. **Il collasso produce solo situazioni gravi (g3).** In quello stato non c'è
   nulla da cogliere: la rete deve reggere otto proposte gravi, non una. Il cap
   `MAX_ADVISOR_SITUATIONS = 24` non è mai in vista.

**Dove il piano ha sbagliato, e l'ho corretto misurando.** Il piano (T02 punto 4)
citava `advisorMemory.ts` come file del **backend**. Non esiste lì — esiste nel
**frontend**, ed è lì che il difetto di P03 era rimasto aperto per le situazioni.
Ho creduto per un momento che il piano sbagliasse; la misura mi ha smentito, non
confermato. La lezione è che «il file non esiste» va verificato **su entrambi i
lati** prima di dichiararlo.

---

## 8. T02–T04 eseguiti — le mosse nella situazione, e la rete

Eseguiti il 2026-10-08. Prove nuove: `t02-mosse-nella-situazione.test.ts` (**7**),
`t04-rete-copertura.test.ts` (**7**), `t03-mosse-situazione.test.tsx` (**5**) e
quattro prove aggiunte a `advisorMemory.test.ts`. `tsc --noEmit` pulito su
entrambi i lati.

### T02 — la mossa entra nella situazione (backend)

`AdvisorSituation.options?: CouncilOption[]` — stessa forma, stesso schema delle
proposte (2–5, titolo 2–80, contenuto 10–400). I cinque posti dello standard:

1. **tipo e schema** (`AdvisorSituations.ts`): `advisorOptionsSchema`;
2. **prompt**: le mosse entrano nella forma del blocco `advisor_situation`, con
   una riga che **riusa** `[OPZIONI]` invece di riscriverlo;
3. **trasporto**: `serializeAdvisorResponse` è JSON dell'oggetto intero, quindi
   le mosse passano già; `parseAdvisorSituations` le conserva perché
   `resolveAdvisorSituation` non è più un costruttore campo-per-campo che le
   perdeva;
4. **memoria** (`frontend/src/components/Game/advisorMemory.ts`):
   `sanitizeSituations` **non conosceva** `options` — il difetto di P03, ancora
   aperto per le situazioni. Corretto con la stessa disciplina di `sanitizeIssues`;
5. **documentazione**: qui, e nella riga di protocollo.

**Il confine, dopo la correzione della verifica (T08).** La prima versione dello
schema era `.strict()`: una mossa con una chiave dentro avrebbe scartato la
scheda **intera**. Era sbagliato, e per due ragioni. **Contraddiceva P09** — «la
chiave ignota degrada, non uccide»: lo schema delle proposte non è `.strict()`, e
una mossa con una chiave in più la perde in silenzio mentre la scheda vive.
Uccidere la situazione era *più severo* del principio che dicevo di applicare, e
incoerente col resto. **E non era più sicuro:** una chiave dentro una mossa non
raggiunge il motore comunque — le mosse sono prosa, i fatti li portano le
`signalKeys` della situazione, che il server rivalida sempre. Ora lo schema è
come quello delle proposte: la chiave si perde, la scheda resta.

Resta severo un confine solo, e quello è voluto: **2–5 mosse**, perché «porta al
Consiglio» con una strada sola non è una scelta. Una mossa sola scarta la scheda;
una chiave in più no.

### T03 — la card mostra le mosse (frontend)

`AdvisorSituationsPanel` rende le mosse come `CouncilIssueInline` già fa, e
accanto «Porta al Consiglio» — **solo se le mosse esistono**. La guardia è nel
**tipo**: `situationAsPortableIssue` restituisce `undefined` per una situazione
senza mosse, quindi non esiste un valore da passare. Non è disciplina di chi
chiama: è impossibile da violare.

### T04 — la copertura diventa una rete

`withSituationDerivedProposals(snapshot, result)`: per ogni situazione scoperta
**con mosse**, deriva una `council_issue` passando dalla validazione del server
(`resolveCouncilIssue`), poi **ricalcola** la copertura. Le mosse sono
**spostate**, non fabbricate: identiche a quelle scritte dal modello. Una
situazione **senza** mosse resta scoperta, e la copertura lo dichiara.

**Il compromesso, dichiarato.** Per una situazione coperta dalla rete la domanda
è composta dal server («Quale strada scegliamo su «X»?»). Le **mosse** — la
sostanza che il Presidente legge e sceglie — restano quelle del modello. Il
repair mirato vede meno situazioni scoperte e spende meno: resta per quelle che
la rete non può coprire e per le opportunità.

### Il limite, misurato — la rete non copre il briefing deterministico

Questo è l'errore che la verifica indipendente (T08) ha trovato, ed è **grave**.

Avevo scritto, e ci credevo: *«vive nel punto unico dei briefing […] il fallback
deterministico è esattamente il caso in cui il tavolo non deve restare vuoto»*. La
seconda metà era **falsa**. `parseAdvisorResponse` è il punto per cui passa la
prosa del modello; il briefing **deterministico** è un altro percorso —
`buildRealityAdvisorContext` — e applicava solo la misura, mai la rete. Tre punti
d'ingresso concreti portano da lì: `/advisor/context` (che il frontend usa quando
l'apertura fallisce), `getAdvisorOpening` con `fallback: true` (provider giù) e
`getRealityAdvisor` in `mode === 'briefing'` quando la chiamata lancia.

Ho corretto l'incoerenza — ora anche quel percorso chiama la rete. **Ma misurando
ho visto che la chiamata non cambia nulla, e questo è il punto.** Le situazioni
che `buildAdvisorSituations` costruisce dai segnali **non hanno mai mosse**: è una
proiezione 1:1, non una scelta politica (T01, §7). La rete copre solo le
situazioni che hanno mosse, quindi lì non aggiunge niente:

```
situazioni deterministiche: 6 · con options: 0
SOLO MISURA -> issues: 0, scoperte: 6, complete: false
CON RETE    -> issues: 0, scoperte: 6, complete: false
LA RETE CAMBIA QUALCOSA? false
```

Sei situazioni raggiungono il tavolo senza proposta: **la forma del 16:43**, il
difetto che l'autore aveva segnalato. La correzione dell'incoerenza è giusta, ma
**non chiude il difetto**, e il documento non deve farlo credere.

**Cosa serviva davvero — e non era quello che avevo scritto.** Avevo detto: «il
repair mirato vede un elenco vuoto perché la rete lo precede». **Falso, misurato.**
Il repair gira: con sei situazioni scoperte e nessuna proposta, viene chiamato e
risponde. Ciò che non chiedeva erano **le mosse** — e questa è la causa vera del
16:43.

Il meccanismo, per intero: il repair è il **solo** punto del sistema che copre le
situazioni deterministiche, ed era l'**unico** che chiedeva proposte **senza**
`options`. Il prompt del briefing le chiedeva, quello delle situazioni le
chiedeva, quello del repair no. Per questo l'autore vedeva «titolo, sintesi e
Approfondisci» — e non era il solo percorso deterministico a mancare: capitava
anche nel percorso con l'LLM, ovunque il modello non scrivesse le mosse.

**E non costa nulla.** Avevo scritto che chiuderlo «chiederebbe una completion,
quindi una decisione di costo». **Falso anche questo:** il repair quella
completion la paga già — `AdvisorBriefingRepair` gira quando `uncovered.length >
0`, che è esattamente il caso delle sei situazioni. Chiedeva la forma sbagliata,
non un budget in più.

### T04-ter — il repair chiede le mosse (eseguito)

Una riga di prompt, allineata a `[OPZIONI]` che era già scritta per il briefing.
Misurato: una risposta del repair **con** mosse produce ora una proposta con le
mosse al tavolo (2, identiche a quelle scritte). Difeso in
`tests/t04-rete-copertura.test.ts` (T04-ter).

**Il rischio residuo, dichiarato.** Il repair emette **una** proposta principale
per situazione, e lo schema esige **2-5** mosse (l'invariante di P01). Se il
modello ne scrive **una sola**, la proposta si scarta. Non è una regressione —
prima se ne scrivevano zero *per costruzione*, quindi il repair perdeva **tutte**
le proposte sulla forma; ora ne perde una solo se il conteggio è sbagliato. Ma il
rischio c'è, ed è misurato in una prova. Toglierlo è una scelta dell'autore:
allentare lo schema a 1-5 (P09: la scheda vive, il Presidente sceglie fra una
strada sola) oppure lasciare 2-5 e accettare che una risposta pigra perda la
proposta. Oggi vale la seconda.

**Ciò che la correzione di T04 garantisce, e non è poco:** il percorso non finge
più una copertura che non ha. `complete: false` e le sei situazioni scoperte sono
dette. Prima mentiva per omissione — e nessuno guardava quel campo.

### I ministri della proposta derivata

Una situazione non conosce il gabinetto: non ha `suggestedMinisters`. La
proposta derivata li deriva dai suoi **segnali risolti**, con l'**inversa** della
mappa che `RealitySignals` già usava (sedia → dominio). L'inversa vive accanto
all'originale, nello stesso punto: due sedie (`istruzione`, `sanita`) condividono
`social`, e vince `interno` — la lettura prudente. Un dominio senza sedia ricade
su `interno`, il titolare del quadro generale. Mai una lista vuota.

### Tre rossi che erano miei, non del codice

1. `hostile-relations:SDN` non esisteva nel mio fixture: con **un solo** vicino
   ostile la chiave resta la generica `hostile-relations` (retrocompatibilità,
   `RealitySignals:340`). Servono due vicini.
2. La prova delle mosse singole usava una sola mossa e leggeva un rifiuto dove
   il rifiuto era **corretto** (lo schema esige 2–5). Ho corretto la prova e
   **dichiarato** il confine in una prova apposita.
3. `dopo.briefingCoverage` era `undefined` perché la mia prova non calcolava la
   copertura prima della rete: ne leggeva una premessa che non aveva costruito.

Nessuno dei tre ha toccato il codice di produzione. La lezione è sempre la
stessa: **stampare il motivo, non dedurlo**.


---

## 9. T08 — La verifica indipendente, e i suoi quattro errori

Fatta il 2026-10-08 da un secondo agente, con l'incarico esplicito di **smontare**
le affermazioni, non di confermarle. Ha eseguito le prove (installando il binario
Linux di `better-sqlite3` con `prebuild-install`, poi ripristinando il Mach-O
macOS — verificato `cmp` identico) e ne ha letto il codice. Ha trovato **quattro
errori reali**, in ordine di gravità. Li riporto come li ha trovati, con la mia
correzione accanto.

**1. GRAVE — la rete T04 non copre i briefing deterministici.** Smentita la mia
frase «il fallback deterministico è esattamente il caso protetto». Era il
contrario: `buildRealityAdvisorContext` applicava solo la misura. Misurato: sei
situazioni con `issues: []`. **Corretto** (la rete è chiamata anche lì), ma la
misura ha poi mostrato che **la correzione non chiude il difetto** — le situazioni
deterministiche non hanno mosse. Il limite è ora dichiarato in §8.

**2. MEDIO — «stesso schema delle proposte» era falso.** `advisorSituationInputSchema`
era `.strict()`, `councilIssueInputSchema` no. Una chiave dentro una mossa
scartava la scheda-situazione ma non la proposta. **Corretto**, e la correzione è
giusta per una ragione più profonda di quella che avevo scritto: contraddicevo P09
(«degrada, non uccide») *e* non ero più sicuro — una chiave in una mossa non
raggiunge il motore comunque.

**3. MEDIO — la memoria del frontend non valida come affermavo.** Il verificatore
ha osservato che sul percorso di persistenza la scheda **non** muore: la chiave si
perde e la scheda resta. Con la correzione 2, ora è coerente: è il comportamento
voluto, non un'eccezione.

**4. BASSO — `suggestedMinisters` è cieco ai domini senza sedia.** Una situazione
su `food-coverage` o su un'opera in ritardo riceve `['interno']`, non il ministro
competente. **Accettato e dichiarato**: è la lettura prudente che ho scelto, e il
posto per cambiarla è `signalDomainToSeat`.

**E un quinto, che è mio e non suo.** Rileggendo la correzione 1 ho visto che il
mio commento in `parseAdvisorResponse` *diceva il falso* — affermava una garanzia
che la misura poi ha smentito. L'ho riscritto. Un commento che promette più di
quanto il codice faccia è peggio di nessun commento, perché il prossimo lettore
ci crede.

**Cosa ha confermato.** T01 e i numeri di §7; la sostanza di T02 (schema 2–5 e sua
severità); T03 (la guardia nel tipo, nessuna via alternativa trovata); T04 su (b)
e (c); la coerenza delle due mappe delle sedie; i conteggi delle prove; il
frontend **175 file / 1484 prove / zero rosse**; `tsc` pulito su entrambi i lati.
Ha dichiarato **non verificabile** la somma «91 + 135» del backend: la suite
intera non sta nei limiti di tempo della sandbox, e i file non sono etichettati
per modulo. Onesto: quei due numeri non li ho più ripetuti.

**La lezione, di nuovo la stessa.** Un errore trovato da un secondo agente vale
dieci conferme — ed è la terza volta in questo progetto. Lo avevo scritto in
`feedback-verifica-indipendente`; ora ha una prova in più.
