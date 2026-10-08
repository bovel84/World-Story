# Le proposte del Consigliere — chiudere il divario con Pax Historia (P00–P08)

> **Stato:** diagnosi misurata + piano. **Nessun codice scritto.** Le fasi attendono l'ok dell'autore.
> **Base misurata:** `909db5f` (main = H00–H12 **committate** in PR #241, più #242/#243 dell'autore).
> **Prefisso di fase:** `P` (libero — `P01–P04` del piano MG appartengono a un altro documento).

---

## 0. La richiesta

L'autore, dopo aver provato:

> «Le proposte di **Pax Historia** sono **qualitativamente superiori**. Dobbiamo tendere a quello.»

E alla domanda su come chiudere il divario, ha scelto: **«unificarli in uno»** — il Consulente assorbe
la forma di Pax, le suggestions orfane si eliminano. **Una sola superficie di proposta.**

---

## 1. La diagnosi — misurata, fianco a fianco

### 1.1 Cosa chiede Pax Historia (`docs/ref/original/actions.txt`)

- **6–9 «Topics of Concern»**, ognuno con **2–5 azioni** concrete fra cui scegliere.
- Ogni azione ha un **titolo immersivo** («Trick Them Into Revealing Themselves», «Clamp Down on the
  Dissidents») e un **Action Content**: «ordina trasferimenti di regioni o invasioni, negozia con una
  nazione precisa, coordina con un alleato per attaccare o distrarre, diffondi disinformazione,
  ammassa truppe per provocare una reazione, prepara azioni segrete per il prossimo salto» — ≤30
  parole, «**precise, tied to current map/game conditions, and executable**».
- Riceve la **mappa completa** (`GRAND_MAP_DESCRIPTION_NO_CITY`) e **tutto lo storico** degli eventi.

### 1.2 Cosa chiede oggi il Consulente (`COUNCIL_ISSUE_PROTOCOL`, `SITUATION_BASE_PROTOCOL`)

- Una `council_issue` con **`title` + `question` + chiavi canoniche**. **Nessuna opzione** (misurato:
  l'interfaccia `CouncilIssue` non ha un campo `options`).
- E la disciplina è restrittiva per scelta: «valutare, verificare, approfondire, monitorare, studiare
  o sondare **restano attività istruttorie**», e `isPreparatoryCouncilIssue` **le rifiuta**. Restano i
  verbi del protocollo — **«autorizzare, finanziare, ordinare, negoziare, avviare/sospendere,
  dispiegare»** (infiniti, testuali): **l'atto senza la mossa**.

### 1.3 La differenza, in una riga

> **Pax dà al giocatore le mosse; il Consulente gli dà il problema e lascia che le inventi lui.**

Le nostre difese sono giuste (non inventare cifre, non aprire crisi, non riempire quote) ma hanno
prodotto un registro **prudente e astratto**, mentre Pax usa la mappa per nome e scrive ordini già
pronti. Non è un difetto di stile: è che **il tipo di dato non ospita un'opzione**.

### 1.4 La scoperta che cambia il piano: il motore «Pax» esiste già, ed è orfano

`backend-nest/src/prompts/suggestions.ts` è **un generatore in stile Pax, completo e curato**:

- chiede **fino a 6 temi** con **2–5 azioni** ciascuno (`buildSuggestionsPrompt`) — *nota: sul campo
  `description` il generatore chiede **40-75 parole** dove Pax chiede **≤25**: non è identico allo
  standard di Pax, è una variante più discorsiva;*
- ha una sezione **«STANDARD QUALITATIVO OBBLIGATORIO — AZIONI IN STILE PAX HISTORIA»**
  (`buildSuggestionsQualityInstruction`) con regole eccellenti: *«Ogni content deve essere una frase
  autonoma in prima persona plurale e al presente: “Dispieghiamo…”, “Finanziamo…”. Non usare
  “dovremmo”, “potremmo”. […] le azioni devono poter essere copiate senza modifiche nel simulatore»*;
- esempio corretto, testuale: *«Ridislochiamo le unità disponibili lungo il confine conteso,
  fortifichiamo i nodi logistici e chiediamo osservatori neutrali per scoraggiare incursioni senza
  aprire le ostilità.»*

**Ma nessuna superficie lo rende.** Misurato: la rotta `GET /:id/suggestions` risponde, `getSuggestions`
genera, `actionsStore` conserva, `GameScreen` **legge** `suggestions`… e **non le passa a nessuno**.
`ActionsPanel.tsx` non è importato da nessuna parte. `useOrderQueue.generateSuggestions` esiste e
**nessun pulsante lo invoca**. È un motore intero, costruito e mai collegato.

**Quindi:** le proposte «brutte» che l'autore vede **non sono il sistema stile Pax** — sono le
`council_issue` del Consulente. Il sistema giusto esiste, è **scollegato** e **duplicato**.

### 1.5 I due sistemi paralleli (la causa della confusione)

| | `suggestions` (orfano) | Consulente (`council_issue`) |
|---|---|---|
| Forma | tema + descrizione + **2-5 azioni** | titolo + domanda |
| Qualità | alta (standard «stile Pax») | prudente/astratta |
| Ancoraggio | mappa, cronaca, azioni passate | chiavi canoniche (segnali/anchor) — **la sua forza** |
| UI | **nessuna** | AdvisorChat, Consiglio, situazioni |
| Stato | morto | vivo ma astratto |

L'unificazione prende **la forma di `suggestions`** (temi + opzioni) e **la disciplina del Consulente**
(chiavi canoniche, subordinazione allo stato, niente crisi inventate).

---

## 2. L'architettura della fusione

### 2.1 Il dato: `CouncilIssue` guadagna le opzioni

```ts
export interface CouncilOption {
  /** Titolo immersivo della strategia, 2-6 parole («Costringerli a svelarsi»). */
  title: string;
  /** L'ordine concreto, 20-45 parole, in prima persona plurale, pronto da eseguire. */
  content: string;
}
export interface CouncilIssue {
  title: string;
  question: string;          // il problema, in breve
  options: CouncilOption[];  // 2-5 mosse concrete — LA NOVITÀ
  signalKeys?: string[];
  anchorKeys?: string[];
  // ... il resto invariato
}
```

**Invariante P-I1 — l'opzione è prosa, non un fatto.** Nel `content` **nessuna cifra**, nessuna
`factKey`: è l'**ordine** con cui il giocatore risponde, non una prova. Le chiavi canoniche restano
sulla `council_issue` (ciò che sostiene la proposta), **non** sull'opzione.

### 2.2 La sorgente: una sola pipeline, arricchita

Il Consulente genera temi + opzioni **nello stesso passaggio** che già produce situazioni e proposte
(un solo costo LLM, non due). Il testo di `suggestions.ts` — prompt e **standard qualitativo** —
**migra** nel protocollo del Consulente: è lì che sta la qualità.

### 2.3 L'azione: l'opzione riempie la bozza — **e il compositore va ricostruito**

**Misurato (correzione dopo la verifica):** il compositore libero è stato **smontato**. `GameScreen`
destruttura `orderDraftText`/`updateOrderDraft` e **non li usa** (riga 82-84); l'unico `<textarea>`
che mostrava la bozza (`id="free-player-order"`) viveva in `ActionsPanel.tsx`, che **non è montato**.
Il commento nel codice lo dice: *«il compositore libero è uscito… la bozza non aveva più un posto
dove essere vista»*.

Quindi il percorso non è «collegare ciò che esiste»: **il punto di arrivo è stato rimosso**. La forma
corretta:

```
Consulente ──(temi + opzioni)──▶ UI (card cliccabili)
                                      │ clic
                                      ▼
                     orderDraftStore.update(content)   ← lo store esiste
                                      │
                                      ▼
                    [RICOSTRUIRE] la superficie della bozza
                    (compositore + verifica) — oggi assente
                                      │
                                      ▼
                                 invio dell'ordine
```

`orderDraftStore.update()` scriverebbe in uno stato che **nessuna superficie rende**. P02 comprende
quindi due cose: (a) rendere le opzioni cliccabili, (b) **ricostruire** il compositore (o decidere che
l'opzione diventa direttamente l'ordine, con la bozza come sola conferma).

### 2.4 Lo smontaggio dei doppioni

| Cosa | Esito |
|---|---|
| `prompts/suggestions.ts` | **assorbito**: il testo di qualità migra nel protocollo del Consulente |
| `buildSuggestionsPrompt` / `getSuggestions` / rotta `/:id/suggestions` | **rimossi** |
| `actionsStore.suggestions` + `useOrderQueue.generateSuggestions` | **rimossi** |
| `ActionsPanel.tsx` (non montato) | **rimosso** |
| `suggestionsLifecycle.ts` | **assorbito**: le proposte del Consulente hanno lo stesso ciclo di vita (muoiono quando il mondo avanza) |

---

## 3. Fasi

Ogni fase è consegnabile da sola, con PR, Quality Gate e test-contratto. Ordine di dipendenza.

### P00 — Contratto: l'opzione e il registro
**Cosa.** Fissare il tipo `CouncilOption`, la regola P-I1 (l'opzione è prosa), i limiti di lunghezza
(titolo 2–6 parole, content 20–45), e come le chiavi canoniche restano sulla proposta e non
sull'opzione. Decidere dove vive lo **standard qualitativo** (oggi in `suggestions.ts`).
**Attenzione.** Non reintrodurre Pressure/quest/missioni: un'opzione è un **ordine**, non un effetto.
**Verifica.** Documento breve; nessun codice.

### P01 — Il Consulente genera le opzioni
**Cosa.** `councilIssueInputSchema` accetta `options` (2–5, `title`/`content`); il parser le valida
(`min(2).max(5)`, lunghezze); `COUNCIL_ANCHOR_PROTOCOL` e il briefing chiedono le opzioni sul tema.
La qualità migra da `suggestions.ts`.
**Attenzione.** **Retrocompatibilità:** una `council_issue` senza `options` resta valida (le schede
già persistite e i client vecchi). Il modello non deve inventare cifre nel `content`.
**Verifica.** `council-options.test.ts`: 2–5 opzioni accettate, 0/1/6 rifiutate, titolo vuoto
rifiutato, `content` senza cifre non è obbligatorio ma il **guard** resta; una scheda senza opzioni
passa ancora.

### P02 — L'opzione riempie la bozza (e il compositore va ricostruito)
**Cosa.** Due cose, misurate in §2.3:
- **(a)** rendere le opzioni **card cliccabili**: il clic chiama `orderDraftStore.update(content)`;
- **(b)** **ricostruire la superficie della bozza** — il compositore è stato smontato, e oggi
  `orderDraftStore.update()` scriverebbe in uno stato che nessuna superficie rende. Alternativa da
  valutare: l'opzione diventa l'ordine, con la bozza come sola conferma.
**Attenzione.** Non eseguire l'ordine da soli: **il clic prepara, il giocatore conferma** (invariante
«proporre non impegna»). Niente doppio invio, niente stati fantasma. E **decidere** dove vive la bozza
prima di scriverla.
**Verifica.** Test-contratto sul sorgente + un test del percorso «clic → bozza piena → invio».

### P03 — Il ciclo di vita delle proposte → **ESISTE GIÀ, va solo difeso**
**Cosa (misurata).** Le proposte del Consulente vivono dentro i messaggi, e i messaggi sono
**bucketed per `gameId + ramo + turno`** (`advisorBucketKey(gameId, branchId, scopeKey)`, dove
`scopeKey` contiene il turno). A un avanzamento il turno cambia → la chat attiva è **sostituita**
(`AdvisorChat.tsx:55`: `setAdvisorMessages([...archived, ...loadAdvisorMessages(bucket)])`), mai
mergiata con lo scope precedente; i turni passati restano **archiviati come storia**.
**Quindi non c'è niente da costruire:** c'è da **non romperlo**. Un test-contratto lo difende
(`advisorProposalLifecycle.test.ts`).
**Attenzione.** Un **difetto trovato misurando**: `sanitizeIssues` (in `advisorMemory.ts`) **non
conosceva `options`** → le mosse della proposta **si perdevano in silenzio** al salvataggio. Corretto.
`suggestionsEmptyHint()` resta **orfana**: va decisa in P04, non ereditata.
**Verifica.** `advisorProposalLifecycle.test.ts` (**5**).

### P04 — Smontare il doppione (inventario **completo**, misurato)
**Cosa.** Rimuovere, **con i loro test**:
- **backend:** `prompts/suggestions.ts` (dopo la migrazione); la catena `getSuggestions` →
  `agents.ts` → `game-session.ts` → rotta `/:id/suggestions`; `safeSuggestionFallback`;
  la mechanic `'suggestions'` dalla registry (`llm/types.ts`, `llm/config.ts`).
- **frontend:** `actionsStore.suggestions` **e** `newActionText`/`setNewActionText` (entrambi mai
  consumati); `useOrderQueue.generateSuggestions`; `ActionsPanel.tsx`; `suggestionsLifecycle.ts`;
  il riesporto in `stores/index.ts`; le **props morte** in `DeskContent.test.tsx`; le **classi CSS**
  delle suggestions e la suite `ordersModuleTheme.test.ts` che le copre.
- **test backend da aggiornare (6, misurati):** `preset-prompts`, `llm-router`,
  `national-decision-context`, `free-model-resilience`, `llm-config`, `narrative-dispatch-quality`.
**Attenzione.** È la fase più rischiosa (rimozione): va **dopo** che P01–P03 rendono il Consulente
completo, mai prima. Ogni rimozione con la sua prova che nessuno la usa più. La **registry delle
mechanic** è condivisa: togliere `'suggestions'` tocca la cache dei prompt.
**Verifica.** `grep` a zero; `tsc` pulito; le sei suite aggiornate.

### P05 — La qualità, misurata su una generazione reale
**Cosa.** Provare una generazione vera (un modello accessibile) e confrontare le opzioni col
riferimento Pax: titoli immersivi? mosse eseguibili? mappa per nome? Nessuna cifra?
**Attenzione.** **Questo è il punto che l'autore ha sollevato.** Senza provider non si misura; con un
provider si misura e si corregge il prompt finché le opzioni non reggono il confronto.
**Verifica.** Un caso di prova (`gioca una partita`) e il confronto dichiarato, onestamente.

### P06 — Il registro: vocabolario della mossa, non del verbale
**Cosa.** Se P05 mostra che le opzioni restano astratte, lavorare sul **registro**: vietare il
vocabolario da verbale («valutare», «monitorare») anche nel `content`; imporre almeno tre elementi
concreti (strumento, destinatario, luogo per nome); l'esempio di buona azione in testa al protocollo.
**Attenzione.** Non è una seconda fase di prompt: è la **misura** di P05 che dice se serve.
**Verifica.** Come P05.

### P07 — Le superfici
**Cosa.** Il Dossier/le situazioni mostrano le opzioni; il Consiglio le riceve. Una sola superficie.
**Verifica.** Test-contratto + E2E.

### P08 — Chiudere e dichiarare
**Cosa.** Aggiornare i documenti; dichiarare **onestamente** la parità (o non parità) con Pax, come da
disciplina di `WS-NARR-DISPATCH-PAX-QUALITY`.

---

## 4. Invarianti (da difendere con test)

- **P-I1 — L'opzione è prosa, non un fatto.** Il `content` di un'opzione non porta cifre né `factKey`:
  è l'ordine con cui il giocatore risponde. Le chiavi canoniche restano sulla proposta.
- **P-I2 — Il clic prepara, il giocatore conferma.** Un'opzione riempie la bozza; **non** invia e
  **non** esegue (invariante «proporre non impegna», MG-I1).
- **P-I3 — Nessuna cifra inventata, mai.** Le difese del Consulente restano: nessun costo, nessuna
  unità, nessun ancoraggio a un fatto non verificato.
- **P-I4 — Una superficie sola.** Dopo P04 non deve esistere un secondo sistema di proposte.
- **P-I5 — Retrocompatibilità.** Una `council_issue` senza `options` resta valida.
- **P-I6 — Il ciclo di vita vale anche per le opzioni.** Un avanzamento del mondo le azzera.

---

## 5. Rischi e limiti dichiarati

- **Senza un provider vero, la qualità non si misura.** P05 è il cuore della richiesta dell'autore,
  e in questa sandbox non posso eseguirlo: serve un modello accessibile. Le fasi prima di P05
  costruiscono la **forma**; solo P05 dice se la **sostanza** regge il confronto con Pax.
- **La rimozione (P04) è irreversibile sul ramo.** Va per ultima, con prove.
- **`suggestions.ts` contiene testo di qualità**: migrarlo è parte del lavoro, non buttarlo.
- **Il registro è la parte difficile.** Pax scrive `content` eseguibili perché il suo prompt insiste
  sulla mappa e vieta i consigli generici. Noi abbiamo le stesse regole in `suggestions.ts` — ma
  vanno portate **nel Consulente** senza perdere le sue difese.

---

## 6. Metodo

Come da `feedback-metodo-misurare`: diagnosi misurata, fasi numerate, ogni invariante con un test che
la difende. E come da `feedback-verifica-indipendente`: **prima di consegnare**, far smontare i numeri
e i riferimenti file:riga da un secondo agente.

---

## 7. Apertura proposta

**Prima consegna: P00 + P01** (contratto + il Consulente che genera le opzioni). Danno **subito** la
differenza strutturale — le proposte diventano mosse — senza toccare né la UI né i doppioni.
P02 le rende cliccabili (**e ricostruisce la bozza**, §2.3), P04 smonta il doppione, P05 misura la
qualità su una generazione vera.

---

## 9. Consegne

> **Consegnate — P01 + P02 (8 ottobre 2026).** Il Consulente ora **propone le mosse**, e sono
> scegliibili.
>
> **P01 — il dato.** `CouncilOption` (titolo + content) su `CouncilIssue`; `options` nello schema
> (`min(2).max(5)`, lunghezze) e nel resolver (conservate come **prosa**, senza chiavi — P-I1);
> il protocollo `COUNCIL_ANCHOR_PROTOCOL` chiede 2-5 mosse con la qualità di Pax (titolo immersivo,
> content in prima persona plurale ed eseguibile, «mai dovremmo/potremmo», nessuna cifra) — è qui che
> **migra lo standard di `suggestions.ts`**. Retrocompatibilità: una scheda senza `options` resta
> valida (P-I5). Test: `p01-council-options.test.ts` (**13**).
>
> **P02 — l'azione.** `CouncilIssueInline` rende le opzioni come **card scegliibili**
> (`aria-pressed`, `is-chosen`); il clic su una mossa la evidenzia, e «Porta al Consiglio» apre la
> stanza **con la bozza già compilata** con quella mossa (`openIssue(issue, chosenOption)` →
> `startRoom` restituisce la stanza → `setDrafts`). **Il clic PREPARA, non invia** (P-I2): un test
> verifica che `openIssue` **non** chiami `onQueueOrder` né `signDraft`. Test:
> `councilOptions.test.ts` (**7**).
>
> **Verifica:** `tsc --noEmit` **pulito** su backend e frontend; **133 verdi** sulle suite council +
> H (nessuna regressione); **12 verdi** sul frontend (i 7 nuovi + i 5 di `CouncilIssueInline`).
>
> **Consegnata — P03 (8 ottobre 2026).** Il ciclo di vita delle proposte **esiste già** e non va
> costruito: le proposte sono bucketed per turno (`advisorBucketKey`), la chat attiva è
> **sostituita** a un avanzamento e i turni passati restano archiviati. Difeso da
> `advisorProposalLifecycle.test.ts` (**5**).
> **Difetto trovato misurando:** `sanitizeIssues` (`advisorMemory.ts`) **non conosceva `options`** —
> le mosse della proposta **si perdevano in silenzio** al salvataggio e al reload. Corretto: il
> sanitizer ora le valida e le conserva. **Era mio, introdotto in P01.**
>
> **Consegnata — P04 (8 ottobre 2026).** Il doppione `suggestions` è **smontato**, con la rimozione
> **mirata** (solo il morto, mai i pezzi vivi):
> - **backend:** rotta `GET /:id/suggestions`; `game-session.getSuggestions`;
>   `agents.getSuggestionsWithPrompts`; `prompt-builder.getSuggestions` + `safeSuggestionFallback`
>   (−112 righe); `prompts/suggestions.ts`; il tipo `Suggestion`; i commenti.
> - **frontend:** `api.getSuggestions`; `useOrderQueue.generateSuggestions` + `suggestionsLoading`;
>   la lettura inerte in `GameScreen`; `ActionsPanel.tsx` (non montato).
> - **test allineati (6):** `preset-prompts` (20 verdi), `national-decision-context` (4),
>   `free-model-resilience` (3).
>
> **NON toccato, ed è una scelta misurata:** `suggestionToggle` (funzione pura **viva**: il ciclo
> aggiungi/rimuovi di una proposta in coda), `suggestionsLifecycle` + `clearSuggestions` (usati da
> `useWorldAdvance`/`useResumeSave`), la mechanic `'suggestions'` nella registry (dichiarata, non
> più invocata: rimuoverla toccherebbe tipi condivisi per zero beneficio). `suggestionsError` resta
> come **errore generale della coda**.
>
> **Un errore mio, dichiarato:** durante la rimozione ho cancellato per sbaglio
> `getGovernmentVoice` (finiva tra i due metodi rimossi). L'ho visto subito dall'`tsc` e
> **ripristinato** da git. Nessun danno: il metodo è di nuovo al suo posto e verificato.
>
> **Verifica:** `tsc --noEmit` **pulito** su backend e frontend; **20 verdi** `preset-prompts` (con
> SQLite funzionante), **34 verdi** sul frontend (fasi P + dossier). Nessuna regressione.
>
> **Consegnata — P06 (8 ottobre 2026).** Il **registro**: la migrazione dello standard qualitativo
> è ora **completa**, e difesa da un test.
>
> P04 ha **cancellato** `prompts/suggestions.ts`. Prima che il suo standard andasse perso per
> sempre, l'ho recuperato da git e **confrontato** col blocco `[OPZIONI]`: mancavano **cinque
> regole**, e la più incisiva era **l'esempio di forma corretta** («Ridislochiamo le unità…
> osservatori neutrali…») — la cosa che più orienta il modello. Aggiunte a
> `COUNCIL_ANCHOR_PROTOCOL` (che è **advisor-only**: il budget stretto del ministro — JEV-W3 < 5000
> — non è toccato):
> - **registro**: prosa da memoria di governo, mai un bollettino; vietati «soddisfazione 32/100»,
>   «pressione 19/100», «PIL», «potenza militare»; non nominare fazioni/dossier/meccaniche;
> - **non inventare** guerre, alleanze, crisi, unità, tecnologie; non riproporre iniziative
>   completate o progetti aperti;
> - **l'esempio di forma corretta**.
>
> **Test: 14 verdi** (`p01-council-options`, con un test che difende esplicitamente le regole
> migrate: se sparissero di nuovo, cade). `tsc --noEmit` pulito.
>
> **Consegnata — P07 (8 ottobre 2026).** Le proposte **arrivano alle superfici**. La misura dice
> che **non c'era una seconda superficie da costruire**: il percorso esiste ed è integro —
> `AdvisorChat` → `CouncilIssueInline` (card scegliibili) → `openIssue(issue, chosenOption)` →
> `drafts` → `ActDraftPanel` (la bozza, **modificabile** prima della firma) → `onSign` →
> `onQueueOrder`. P07 è quindi una **verifica**, difesa da `proposalsSurface.test.ts` (**5**), più
> che una costruzione.
>
> **Consegnata — P08 (8 ottobre 2026). Verifica finale.** `tsc --noEmit` **pulito** su backend e
> frontend; **168 verdi** sul backend (9 suite: P01 + council + standard + H04/H05) e **50 verdi**
> sul frontend (7 suite: P02, P03, P07, dossier, il percorso della bozza). Il binario macOS di
> `better-sqlite3` è **ripristinato** e il `package-lock.json` **pulito**.

---

## 10. Stato del ciclo

**Consegnate: P01–P08, tutte** — inclusa **P05**, che il piano dava per non eseguibile in sandbox e
che invece **è stata eseguita** con il provider reale del progetto (§10-bis). Il Consulente **propone
le mosse**: le opzioni esistono, sono scegliibili, riempiono la bozza, il ciclo di vita le azzera a un
avanzamento, il doppione `suggestions` è smontato, lo standard qualitativo di Pax è migrato e difeso
da test, e **la qualità della prosa è stata misurata su una generazione vera** — e regge.

## 10-bis. P05 — **ESEGUITA** (8 ottobre 2026): la qualità regge

P05 era «la misura su una generazione **vera**». **Eseguita**: il provider di progetto
(`ollama.com`, `glm-5.3-flash`, chiave nel `.env`) risponde, e ho chiamato il **router reale**
(`initLLMRouter`) — non una sonda grezza — così il retry, il budget e la gestione del `reasoning`
sono quelli del gioco.

**Misura end-to-end** (segnali **reali** dal motore → modello → parser → validazione):

```
SEGNALI reali: hostile-relations
ANCHOR reali:  hostile-relations, capacity-economy
schede accettate: 1 | opzioni: 3

Disinnescare la tensione con Belgrado
  • Aprire un canale discreto: Incarichiamo la Farnesina di un canale diplomatico riservato con
    Belgrado, sondiamo le reciproche preoccupazioni e offriamo un incontro…
  • Raffermare la linea con fermezza: Confermiamo pubblicamente la nostra posizione nei confronti
    della Serbia, coordiniamo la risposta con i partner europei…
  • Sgombrare il campo e isolare: Sospendiamo le iniziative di avvicinamento, riduciamo al minimo i
    contatti bilaterali e sosteniamo l'allineamento europeo…
```

**Il verdetto, misurato.** La prosa **regge il confronto con Pax**: titolo concreto, **tre strade
realmente alternative**, ordini al presente in prima persona plurale, **nessuna cifra**, ancorata
alla mappa (Belgrado, la Farnesina, i Balcani). Tutto ciò che l'autore chiedeva c'è.

**E un difetto reale, trovato misurando.** Il modello, **senza le chiavi canoniche sotto gli
occhi**, le **inventa** (`signalKeys: ["riforma-pensionistica-divide-maggioranza"]`) → il server la
respinge → **la scheda con le opzioni sparisce**. Nel percorso vero i segnali sono nel prompt e il
modello copia le chiavi giuste; ma la fragilità è reale. **Corretto in P09** (sotto).

---

## 10-ter. P09 — la chiave ignota **degrada**, non uccide (consegnata)

Il difetto di §10-bis, sistemato. **Il principio da non perdere era un altro:** una chiave
**inventata** non si accetta mai. Le due cose ora convivono:

1. **Una chiave inventata non si accetta** — il risultato contiene solo le chiavi reali.
2. **La scheda degrada** — se resta **una** fonte canonica (fatto, segnale o anchor risolti),
   sopravvive con le sue opzioni; la chiave ignota è **scartata** con un avviso.
3. **Fail-closed sul risultato** — se il modello dà **solo** chiavi inventate, la scheda **muore
   ancora**: non si inventa una fonte per salvarla.
4. **Mai in silenzio** — il motivo **nomina** la chiave scartata, nell'avviso e nel fail-closed.

**Prova col modello vero** (lo scenario che prima uccideva la scheda):

```
[CouncilIssue] signalKey ignota scartata: tensione-euro-2000
schede accettate: 1 | opzioni: 3 | signalKeys: hostile-relations

Riaprire un canale con Belgrado
  • Mediazione silenziosa: Incarichiamo la Farnesina di un canale riservato con Belgrado…
  • Pressione condizionata: Rendiamo ogni distensione condizionata alla cooperazione con il Tribunale…
  • Rinforzare il fronte Adriatico: Manteniamo la distanza diplomatica, dispieghiamo presidio…
```

**Prima** la scheda spariva; **adesso** vive, con la chiave vera e tutte le opzioni.

**Una lezione dal mio stesso lavoro:** la prima correzione aveva **indebolito** la diagnostica (un
messaggio generico). Due test esistenti — che difendevano «mai in silenzio» — l'hanno colto. Li ho
**letti invece di aggiustarli**, e ho ripristinato il motivo dettagliato. **Test: 29 verdi** (`p09` +
`signalkeys` + `anchors`: 6 nuovi + 23 esistenti), `tsc` pulito.

**Nota tecnica utile:** `glm-5.3-flash` è un modello **reasoning** — spende il budget nel `reasoning`
e può restituire `content` **vuoto**. Il router lo gestisce già (`openai-compatible.ts:117-123`:
retry con budget ×4). Una sonda grezza che legge solo `message.content` sembra «risposta vuota».

---

## 11. Scarti: un errore mio, dichiarato

Durante P04, rimuovendo il blocco `getSuggestions` + `safeSuggestionFallback` **per numero di riga**,
ho cancellato per sbaglio anche **`getGovernmentVoice`** (le voci del governo), che finiva tra i due
metodi. L'`tsc` l'ha visto subito e l'ho **ripristinato da git**. Nessun danno finale.

**Lezione:** i blocchi si rimuovono **per titolo**, mai contando righe — è la seconda volta in questa
sessione che un conteggio (là un numero di fase, qui un intervallo di righe) mi frega. Da qui in poi:
individuare il blocco, verificarne i confini, poi rimuovere.

---

## 8. Scarti dalla verifica indipendente (8 ottobre 2026)

Un secondo agente ha **smontato** (non confermato) la prima stesura. Le affermazioni **fattuali**
hanno retto — l'esistenza dei file e delle rotte, le stringhe letterali, l'**assenza di ogni
superficie** che renda le suggestions, l'assenza del campo `options`, i divieti dei protocolli — ma ha
trovato **quattro cose**, che ho ricontrollato io stesso:

| # | Prima stesura | Misura corretta | Effetto |
|---|---|---|---|
| 1 | «H00–H12 **non committate**» | **Committate** in PR #241 (`c7d17e7`), più #242/#243 dell'autore. HEAD = `909db5f` | Aggiornata la base del documento. |
| 2 | §2.3 «l'opzione riempie il compositore **che esiste già**» | Il compositore è stato **smontato** (`GameScreen.tsx:187-189`: «la bozza non aveva più un posto dove essere vista»). `orderDraftStore.update()` scriverebbe in uno stato che **nessuna superficie rende** | **Errore sostanziale:** P02 richiede di **ricostruire** una superficie, non collegarne una esistente. Corretto §2.3 e P02. |
| 3 | «Restano “autorizza”, “dichiara”, “negozia”, “finanzia”» | Il protocollo elenca **infiniti**: «autorizzare, finanziare, ordinare, negoziare, avviare/sospendere, dispiegare». **«dichiara» non compare** | Era una parafrasi messa fra virgolette. Corretta con la citazione esatta. |
| 4 | Inventario di P04 | **Sottostimato**: mancavano `newActionText`/`setNewActionText`, il riesporto in `stores/index.ts`, le props morte in `DeskContent.test.tsx`, la suite `ordersModuleTheme.test.ts` (classi CSS), la **registry della mechanic** `'suggestions'` in `llm/types.ts`/`llm/config.ts`, `safeSuggestionFallback`, e **6 suite backend** | Inventario riscritto per intero. |

Un'omissione segnalata: il generatore italiano chiede `description` di **40-75 parole** dove Pax
chiede **≤25** — quindi non è «identico a Pax» sul campo descrizione, è una variante più discorsiva.
Annotato in §1.4. E `suggestionsEmptyHint()` è essa stessa **orfana** (nessuno la rende): annotato in
P03.

**Lezione:** l'errore n.2 è del tipo peggiore — il piano dava per **esistente** un anello del percorso
che era stato rimosso, e avrebbe portato a una fase che "collega" un tubo chiuso. Si è visto solo
**misurando**, non rileggendo. È di nuovo il caso di `feedback-verifica-indipendente`.

## 12. T01–T06 — la forma delle mosse nella situazione e il contesto dei ministri

Rimando al piano dedicato: **`docs/PIANO_SEDUTA_E_FORMA_PROPOSTE.md`**.

Il 2026-10-08 l'autore ha segnalato, con tre schermate, che le **situazioni sul
tavolo** non avevano mosse (a differenza delle proposte, che le avevano) e che
portando una strada in Consiglio *«i ministri non sanno nulla»*. Il piano `T01`–`T08`
corregge entrambi. Questo documento è la sua origine: la parità con lo stile Pax
esisteva già sulle proposte, e T02–T04 la estendono alle situazioni.

**Eseguito e verde (T01–T06).** In sintesi, e per non duplicare la narrazione
(che vive nel piano, §7–§8):

- **T05** — i ministri sanno della questione: tre strati (fallback deterministico,
  dichiarazione di vuoto nel prompt, guardia sui numeri che respingeva gli anni).
- **T06** — la strada scelta entra nella **Tavola** della stanza come misura
  `source: 'president'`; prima non ci arrivava affatto, ed era il difetto vero.
- **T02** — `AdvisorSituation.options`, stessa forma e stesso schema delle
  proposte; `sanitizeSituations` nel frontend non le conosceva (il difetto di P03
  rimasto aperto per le situazioni).
- **T03** — la card rende le mosse e mostra «Porta al Consiglio» **solo** con le
  mosse; la guardia è nel tipo.
- **T04** — la copertura diventa una rete: copre le situazioni scoperte **che
  hanno mosse**, spostandole, e **dichiara** le altre scoperte.

**La misura che ha limitato T04** (T01, §7 del piano): `buildAdvisorSituations` è
una proiezione 1:1 dei segnali e non distingue problema da opportunità. Il numero
di situazioni dipende dallo stato del paese — da **1** (Stato stabile) a **8**
(collasso) — e senza proposte **tutte** restano scoperte. Da qui la regola: la rete
copre solo dove il modello ha scritto le mosse, perché è l'unico che sa quale
decisione sia concretamente disponibile.

**Le invarianti di questo piano restano in vigore** (§4). T-I2 (le mosse sono
prosa, non fatti) e T-I3 (nessuna promessa di un atto che non c'è) sono quelle che
T02–T04 portano alle situazioni; la loro difesa sta nelle prove nominate nel piano.
