# World Story — i dispacci come dispacci

**Versione:** 1.0 — 25 settembre 2026
**Stato:** diagnosi misurata; **nessun codice scritto.** Le fasi attendono l'approvazione dell'autore.
**Destinatari:** sviluppatori ed LLM esecutori.
**Rapporto con gli altri piani:** prosegue `SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md` (§5.11, §11.3),
`PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md` (§3.2 punto 8) e `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md`.

> **Richiesta diretta dell'autore:** «lavora sui dispacci generati dalle azioni; grafica e contenuto;
> molto più simile a Pax Historia.»

> **Nota sul mandato.** Tre decisioni sono già state prese dall'autore e questo piano le rispetta:
> i bollettini **restano nella cronaca ma riscritti come notizia**; l'accento va **prima al contenuto,
> poi alla grafica**; la struttura del dispaccio segue **Pax: dispaccio breve**, non le nostre 90-140 parole.

---

## 1. La misura, prima di tutto

Tutto ciò che segue è stato trovato **eseguendo e interrogando i dati reali**, non leggendo il codice.
Fonte: `backend-nest/data/world-story.db`, partita `4f0a941bd41c` (21 dispacci in `simulation_events`,
3 turni in `turn_results`).

| Misura | Valore trovato |
|---|---|
| Dispacci intitolati «Conti nazionali del periodo» | **19 su 21 — 90%** |
| Dispacci con emoji (📊 🏛️ 🔬 🏭 📦 ⛏️ 📜) | 19 su 21 |
| Dispacci contenenti cifre nel corpo | 19 su 21 |
| Titoli con soggetto + verbo + luogo (regola del nostro stesso prompt) | **2 su 21** |
| Dispacci che portano il riferimento all'ordine (`source_action_ids`) | **0 su 21** |

I due soli titoli non contabili sono `Lunga deriva` e `Ultimo avviso`; il loro corpo è di **una frase**
(«Il debito diventa insostenibile.», «La piazza scende in strada.»). Nessuno dei due nomina un attore,
un luogo o una data.

**Turno 1 del 2026-01-20, i dieci eventi per esteso.** Solo il primo è una notizia:

```
Lunga deriva
📊 Quadro nazionale: Repubblica parlamentare; popolazione 59.024.477,2; PIL nominale stimato $2383,4 mld …
🏛️ Governo — Lavoro e sindacati ha la maggiore influenza; Forze armate preme di più: riarmo: portare la spesa …
🔬 Nuova tecnologia sbloccata: Agricoltura meccanizzata — produzione alimentare +35%.
🏭 Magazzino nazionale: Tesoreria 39.2 mld, cibo 10/10, vestiario 4.4/4.4, armamenti 4/4, carburante 3.8/3.8 …
📦 Magazzino al tetto: perduto food 1, clothing 2, weapons 2, fuel 1.3 (capacità di stoccaggio superata).
📜 Scadenza del debito — Debito ereditato 3 anni: 963.1 mld al 8% (scadenza 2029-01-20): rifinanziato …
📜 Scadenza del debito — Debito ereditato 8 anni: 1284.2 mld al 8.4% (scadenza 2034-01-20): rifinanziato …
📜 Scadenza del debito — Debito ereditato 15 anni: 963.1 mld al 8.9% (scadenza 2041-01-20): rifinanziato …
⛏️ Estrazione risorse: 0.469 oil, 0.469 gas, 0.937 bauxite, 0.937 timber, 1.875 fertile_land …
```

Nove righe su dieci sono **contabilità**. Il turno del 2026-04-01 è identico, con un solo titolo in più
che è di nuovo il bollettino. La `narration` del terzo turno è «Il periodo scorre senza scossoni».

### 1.1 La diagnosi, in una frase

**Non è un problema grafico: la cronaca non contiene notizie.** Una partita letta a posteriori racconta
un paese che non fa nulla mentre la sua tesoreria si svuota, e chiama «Ultimo avviso» una riga che non
dice chi è sceso in piazza. La grafica non può salvare un feed che non ha nulla da mostrare.

### 1.2 Il difetto è contro una regola già scritta, e misurata

Il progetto dichiara questa materia vietata in **due punti già presenti nel repository**, il che rende
il difetto un'**incoerenza interna** e non un'opinione estetica:

- invariante §5.11 della SPEC: «*Niente eventi di riempimento: contabilità ordinaria, «nessuna novità»,
  fine mese e avanzamento tecnico non sono svolte della cronaca*»;
- regola del prompt in `prompts/simulation/prompt.ts:228`: «*Mai "Tensioni crescono", "Nuova crisi",
  "Bollettino", "Evento", **una cifra di bilancio** o formule vaghe*».

Il modello non c'entra: quei titoli li scrive il motore a mano. `game-session.ts:3347` compone
`headline: 'Conti nazionali del periodo'` e `PlaybackService.ts:267` e `:626` lo replicano. Il testo
viene da `WorldStateEngine.playerBulletin()`. Le sei famiglie di riga nascono in `NationStateService.ts`
alle righe 259 (tecnologia), 276 (debito), 297 (magazzino), 320 (spreco), 325 (estrazione) e in
`game-session.ts:743` (governo).

### 1.3 La terza lacuna: «Perché è accaduto» non può esistere

Il §3.2 punto 8 del piano maestro pretende che «*il dispaccio esponga ciò che è realmente avvenuto e
"Perché": ordine, fase, quantità impegnate/consumate ed effetti*». Nel `NewsFlash` e nell'archivio la
sezione si chiama proprio **«Perché è accaduto»** — ma `simulation_events` porta
`source_action_ids = []` su **tutti e 21** i dispacci, e il ramo `advanceDate()` non lo valorizza mai
(scrive `source: 'world'` fisso, riga 3347). Un dispaccio non può dire da quale ordine nasce perché
il collegamento non esiste.

### 1.4 Il riferimento, e cosa dice davvero

Il riferimento non va ipotizzato: **i prompt reali di Pax Historia sono già nel repository** in
`docs/ref/original/` — `actions.txt`, `forward.txt`, `userchat.txt`. Da lì, tre regole citabili:

- **`forward.txt`, forma dell'evento:** descrizione **15-25 parole**; «*Avoid generic advice — make
  your action plans precise, tied to current map/game conditions*»; «*NEVER create an event along the
  lines of "Nothing Happened in Region X" and NEVER create an event along the lines of "As the Year
  Starts" or "End of Year Summary"*»; «*Highlight what matters most AND cover the entire world …
  Quality over Quantity … spread 25 events across the year. DO NOT JUST RANDOMLY STOP SIMULATING
  EVENTS IN THE MIDDLE*».
- **`actions.txt`, forma del tema:** 6-9 «Topics of Concern», titolo di una frase, descrizione 15-25
  parole, e **2-5 azioni** per tema, titolo immersivo, contenuto **max 30 parole**.
- **`userchat.txt`, voce:** prima persona, mai drammatico, lunghezza ancorata a quella del giocatore.

**Buona notizia, misurata.** La struttura dei *temi con 2-5 azioni* è **già implementata**: è
`prompts/suggestions.ts` (righe 22, 58, 62, 127 — «da 2 a 5 azioni», descrizioni 40-75 parole, titoli
2-6 parole, divieto esplicito di cifre e bollettini). Il Brainstorm ha già la disciplina di Pax. **La
lacuna è tutta nei dispacci.**

### 1.5 Cosa NON è rotto (verificato, per non allargare il lavoro)

La voce di cronaca nei prompt (`simulation/guards.ts`, la sezione «stile dei dispacci») è già severa e
giusta: vieta etichette di stato, nomi di campi JSON, ID, hashtag. Le categorie dei dispacci
(`dispatchCategory.ts`, 5 categorie deterministiche da parole chiave) funzionano. Il problema non è
l'italiano del modello: è che riceve poco da raccontare e il motore gli mette accanto contabilità.

---

## 2. Le invarianti che questo piano non rompe

1. **Il motore resta la fonte dei numeri.** Nessuna cifra entra in cronaca perché il modello l'ha
   scritta: i bollettini riscritti si compongono dai read model, come già fanno i grafici del
   Consulente (C01).
2. **Una cifra, un posto.** Il bollettino contabile **resta nel Dossier Nazione**, dove le cifre hanno
   già una casa e un tono. La cronaca non diventa una seconda contabilità.
3. **Niente futuro nella memoria.** Riscrivere un titolo non cambia *cosa* è successo: gli stessi
   eventi, con gli stessi ID e la stessa data.
4. **Il tempo resta esplicito.** Nessuna di queste fasi aggiunge un timer o un avanzamento automatico.
5. **Lettura non mutante.** Il «Perché è accaduto» è una lettura; non simula e non ripristina.

---

## 3. Le fasi

Ogni fase è consegnabile da sola, con la sua PR e il suo Quality Gate.

### Fase A — I bollettini diventano notizie (risposta diretta alla decisione dell'autore)

**Cosa.** Le sei famiglie di riga contabile smettono di essere `headline: 'Conti nazionali del periodo'`
e diventano dispacci con **titolo concreto e corpo breve**, composti dal motore (non dal modello) dai
dati che già produce. Esempi di forma, non di testo definitivo:

| riga oggi | diventa |
|---|---|
| `📜 Scadenza del debito — Debito ereditato 3 anni: 963.1 mld …` | «Roma rifinanzia il debito ereditato del 2029» |
| `🔬 Nuova tecnologia sbloccata: Agricoltura meccanizzata …` | «Le campagne adottano l'agricoltura meccanizzata» |
| `📦 Magazzino al tetto: perduto food 1, clothing 2 …` | «I magazzini di Stato traboccano e deperiscono» |
| `🏛️ Governo — Lavoro e sindacati ha la maggiore influenza …` | «Il governo pende verso il lavoro organizzato» |

Le cifre **escono dal titolo** e restano nel corpo **solo quando servono alla storia**, dentro una
frase — la stessa regola già scritta in `prompts/government.ts:74`. Dove una riga non ha una notizia
(per esempio l'estrazione ordinaria di risorse), **non produce un dispaccio**: resta contabilità nel
dossier, come pretende §5.11.

**Attenzione.**
- `advanceDate()` (il salto a tempo puro) e `PlaybackService` **non** devono divergere: oggi scrivono lo
  stesso titolo in tre punti diversi. Va estratta **una sola** funzione di composizione, altrimenti la
  prossima modifica ne dimenticherà una (è già successo: tre copie).
- Il bollettino è anche `events[1]` del `turn_results` **e** la voce del Dossier: cambiare l'uno senza
  l'altro rompe la riconciliazione fra cronaca e dossier.
- Le emoji non vanno cancellate a mano: vanno **spostate**. Il `NewsFlash` e l'archivio hanno già un
  badge di categoria (`dispatchCategory`): è lì che appartiene la distinzione, non in un'emoji nel
  titolo.

**Verifica.** Un test-contratto che legge una partita reale e pretende che **nessun dispaccio** abbia
per headline una delle sei formule contabili, con guardia contro il falso verde (la guardia è che il
parser trovi almeno N dispacci, altrimenti passa perché non ne trova nessuno). Test sui tre punti di
composizione perché restituiscano lo stesso titolo a parità di dati.

---

### Fase B — Il dispaccio ha la forma di Pax

**Cosa.** Allineare la **forma** a `forward.txt`: titolo breve e concreto (già richiesto dal prompt
attuale: massimo 12 parole, ma il modello lo ignora perché non è verificato), corpo breve secondo la
decisione dell'autore, e — soprattutto — **il divieto esplicito delle formule di riempimento** che Pax
enuncia in modo letterale. Le nostre regole attuali vietano le etichette; non vietano ancora
«*Nothing Happened*», «fine anno», «nessuna novità» con la stessa chiarezza.

Il punto delicato è la lunghezza. Oggi `prompts/immersion.ts:1` chiede «due brevi paragrafi», la riga 8
chiede **90-140 parole**, e `prompt.ts:228` chiede «4-6 frasi». Sono tre misure diverse nella stessa
cartella. La decisione dell'autore («fedele a Pax: dispaccio breve») impone di **scegliere una misura
sola** e cancellare le altre, oppure di dichiarare che l'una è il corpo dell'archivio e l'altra la
scheda del lettore.

**Attenzione.**
- **Non copiare il numero di Pax alla cieca.** Pax genera eventi per *un intero mondo simulato* con
  un tetto di 25 per anno; noi generiamo lotti con un budget di 2-6 eventi (`EventBudget.ts`) e il
  dispaccio deve restare comprensibile **senza aver letto i precedenti** (regola già scritta in
  `immersion.ts:8`). Va scelta la misura che serve a questo, e motivata nel documento: è la sola
  discrepanza consapevole rispetto a Pax.
- Il corpo breve non deve svuotare il «Perché è accaduto» della Fase C: sono due campi, non un campo.

**Verifica.** Test-contratto sul sorgente dei prompt: una sola cifra di lunghezza per il corpo del
dispaccio, il divieto di riempimento presente in `simulation/prompt.ts` e in
`simulation/guards.ts` **entrambi**, con guardia sul numero di occorrenze.

---

### Fase C — «Perché è accaduto» dice davvero perché

**Cosa.** Un dispaccio che nasce da un ordine porta il riferimento all'ordine, così il lettore vede
**ordine → esito**, come chiede §3.2 punto 8 del maestro. Oggi la sezione esiste ed è vuota su tutti i
dispacci. Va valorizzato `sourceActionIds` anche nel ramo `advanceDate()` e nel playback, dove il
collegamento si perde.

**Attenzione.**
- La sezione **non deve mai mostrare un ordine inventato.** Se il dispaccio è del mondo e non nasce da
  un ordine del giocatore (come `Lunga deriva`), il «Perché è accaduto» spiega **la causa documentata**
  — non finge un ordine. Un ordine attribuito per errore è peggio di nessun ordine.
- Il collegamento va fatto **per ID**, mai confrontando i testi (regola §6.2 della SPEC).

**Verifica.** Test di integrazione: dato un lotto con tre ordini, ogni `actionOutcome` che genera un
evento lascia `sourceActionIds` non vuoto; e un evento del mondo lascia il campo vuoto **e** la UI non
mostra una sezione vuota.

---

### Fase D — La grafica che mostra bene un dispaccio che ha qualcosa da dire

**Cosa.** Solo dopo A-C. Il dispaccio ha già due rese: la **coda centrale** (`NewsFlash`, navy) e la
**scheda d'archivio** (`EventFeed`, carta editoriale crema). La scheda d'archivio è già la più vicina a
Pax: masthead, kicker «Corrispondenza», filetto, «Perché è accaduto», byline. Va rifinita, non
rifatta: gerarchia del titolo, corpo breve leggibile, badge di categoria coerente con la coda.

La coda centrale è invece il punto debole: un titolo di `clamp(23px, 3vw, 34px)` e `max-width: 24ch`
su un dispaccio di 6 parole lascia un riquadro mezzo vuoto. Con i titoli concreti della Fase B e il
corpo breve di questa fase, va **ricalibrata** — o la coda assorbe la scheda, se l'autore preferisce una
superficie sola.

**Attenzione.**
- Il tema carta (crema) vive per il dispaccio; il navy per la scrivania. La disciplina è già stata
  scritta in C03 e un test la difende (`ordersModuleTheme.test.ts`): **non va rotta** riusando una
  regola condivisa.
- Il contrasto **si misura, non si guarda** (precedente C03: si calcola WCAG su `renderToStaticMarkup`).

**Verifica.** Rapporti di contrasto calcolati, non stimati; test-contratto che il modulo dispacci non
importi regole del modulo ordini; screenshot della coda e della scheda allegati al report.

---

## 4. Una fase separata, dichiarata e non nascosta (decisione di prodotto)

Il §11.3 della SPEC chiede che «*avvisi tecnici, rifiuti di validazione e bollettini economici ordinari
abbiano sezioni/stili separati; non diventano automaticamente notizie importanti*».

La decisione dell'autore («i bollettini restano, riscritti come notizia») **convive** con questa regola
solo se i bollettini riscritti restano **distinguibili**: un dispaccio di contabilità riscritta è una
notizia di servizio, non una svolta. Propongo quindi una **quinta categoria deterministica** in
`dispatchCategory.ts` — oggi sono cinque: `war, diplomacy, economy, politics, society` — chiamata
«Amministrazione», con badge proprio, così il giocatore distingue a colpo d'occhio una svolta politica
da un rifinanziamento.

**Non la incorporo nelle fasi A-D.** È un cambio di prodotto e lo dichiaro come decisione separata, come
il §5 del piano N: se l'autore preferisce che i bollettini riscritti siano notizie come le altre, questa
fase si salta e non cambia nulla delle altre.

---

## 5. Ordine e dipendenze

```
A (bollettini → notizie)   ──►  B (forma Pax)   ──►  D (grafica)
                                    │
C (Perché accaduto)  ───────────────┘
```

A viene per prima perché è **la risposta diretta alla richiesta** ed è verificabile su una partita
reale. B dipende da A solo per il vocabolario dei titoli. C è indipendente da B ma serve a D. D viene
per ultima, quando c'è un dispaccio che merita di essere mostrato bene.

**Rischio dichiarato.** A e B toccano file di prompt e di motore condivisi; C tocca persistenza e
playback. Prima di A va letto `docs/implementation/HANDOFF-LLM.md`, che dichiara i file condivisi e i
proprietari, per non rompere la disciplina di collaborazione del progetto.

---

## 6. Cosa non fa questo piano

Non rifà il pannello Ordini, non tocca il Consulente (già a posto dopo C01-C03), non tocca il Dossier
Nazione (le cui cifre restano dove sono), non introduce librerie grafiche, non tocca il calendario né il
contratto di simulazione. Non dichiara «parità con Pax Historia»: la parità resta quella della campagna
§16 della SPEC, che è un'altra cosa e non è coperta qui.
