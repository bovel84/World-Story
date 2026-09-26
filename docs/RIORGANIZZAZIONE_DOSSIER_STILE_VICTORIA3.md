# World Story — un dossier da cancelleria: sfide fuori, sezioni dense

**Versione:** 1.5, 26 settembre 2026.
**Stato:** **V01–V05 consegnate, e D-1 risolta** — il piano è completo e la sua
unica decisione aperta è chiusa: `ObjectsBoard` vive nel pannello **Forze**
(`DECISIONE_D1_OBJECTSBOARD.md`). Il dossier ha quattro sezioni dense, è un
documento di stato puro (31 blocchi, nessun blocco interattivo), le sfide stanno
in Questioni e la sala operativa in Forze.
Il codice consegnato è su `frontend/src/`: nessuna modifica al motore.
**Destinatari:** sviluppatori e LLM esecutori; ogni scelta marcata «obbligatoria» è un
contratto.
**Mandato dichiarato:** **solo frontend. Il motore non si tocca.** Le pressioni, le crisi
e le opzioni di risposta continuano a nascere nel motore: questo piano cambia **dove**
si leggono e si decidono, non **come** si calcolano.
**Rapporto con gli altri piani:** prosegue `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md`
(D01–D05, D07 consegnate; D06 in attesa di decisione) e
`COERENZA_DOSSIER_ANNO_NAZIONE.md` (N01–N08). Quelli hanno deciso *dove* sta una cifra,
*quanto* se ne capisce, *di quando* e *di chi* è. Questo decide **la forma del mobile**:
da schedario a otto ante a cancelleria con lente di attenzione, stile Victoria 3.
Questo piano **risponde alla decisione di prodotto che teneva ferma D06** (§7).

> **Le due decisioni dell'autore (2026-09-26).**
> 1. **Le «Sfide del momento» escono dal dossier nazionale.** Le pressioni con le opzioni
>    di risposta (radio + «Decidi») non stanno più fra le cifre di stato: vanno in un
>    pannello a parte, raggiungibile dalla barra comandi, con il numero delle questioni
>    aperte come distintivo.
> 2. **Meno sezioni, più dense.** Le otto sezioni oggi a scheda si riorganizzano in
>    **quattro**: Situazione, Regno, Tesoro, Stato maggiore.

---

## Indice

1. Diagnosi: cosa c'è davvero oggi (misure)
2. Perché lo stile Victoria 3 è la risposta giusta a questo dossier
3. Le quattro sezioni: cosa resta e dove va
4. Il pannello «Questioni»: casa nuova delle sfide
5. Invarianti obbligatorie (V1–V6)
6. Le fasi (V01–V05)
7. Il rapporto con D06: la decisione presa qui
8. Criteri di completamento e verifica
9. Cosa NON fare

---

## 1. Diagnosi: cosa c'è davvero oggi

Numeri misurati sul codice (`frontend/src/`, 2026-09-26), non letti dall'intenzione dei
commenti.

### 1.1 Dove stanno le sfide oggi

Le «Sfide del momento» sono le pressioni di pace del motore
(`PeacetimePressures.ts`, 16 tipi, di cui solo 2 militari — misura già registrata in
`DIREZIONE_CIVILE_DEL_GIOCCO.md`). Nel dossier **compaiono due volte**:

1. nella lista unica della sintesi (`nationalSynthesis.ts`), come voci fra crisi,
   scadenze e impegni — lettura sola;
2. nel `<details>` «Registro completo: crisi, sfide e impegni»
   (`NationDock.tsx:203–232`), dove sono **interattive**: radio per l'opzione, bottone
   «Decidi», costo/incasso in miliardi.

Il `<details>` del registro è **l'unica superficie interattiva chiusa in un
richiudibile** del dossier: il test-contratto di D07 difende «nessun blocco interattivo
in un richiudibile» e questa è la sua unica eccezione voluta (dichiarata in D05). Il
piano la risolve non silenziando il test ma **togliendo il blocco dal dossier**.

Fatti misurati sul flusso dei dati:

- le pressioni e `onResolvePressure` entrano nel dossier come props da
  `DeskContent.tsx:472–475`, che le riceve da `GameScreen.tsx:251` e `:489`
  (`nation.nationalPressures`, `nation.resolvePressure`);
- la divisione evidenziate/dossier è `splitPressuresByAttention` (`pressureWindow.ts`),
  già usata anche da `strategicBriefing.ts` (`:170`): **il briefing compatto legge già
  le stesse sfide con la stessa regola** — un pannello separato non inventa nulla;
- le ultime sfide chiuse (`recentPressures`) e lo storico fanno già parte dello stesso
  blocco: si spostano con lui, non si ricostruiscono.

### 1.2 Le otto sezioni, misurate

Conteggio meccanico (script che spezza il file su `{active === '<sezione>'}` e conta i
`<DossierBlock`, non i tag): **33 blocchi `DossierBlock` su 8 schede**, più 5
richiudibili `<details>` (di cui 2 in Situazione: il registro completo e il quadro per
dominio).

| Sezione | Blocchi | `<details>` | Note |
|---|---|---|---|
| Situazione | 6 | 2 | sintesi, indicatori, crisi+sfide+impegni (nel registro), strategie delle potenze, decisioni richieste |
| Governo | 2 | 0 | quadro del governo, consiglio dei ministri |
| Progetti | 1 | 0 | progetti e processi |
| Cassa | 5 | 0 | quadro economico, tesoreria e debito, flussi mensili, composizione, pressione militare |
| Risorse e industria | 5 | 0 | quadro, magazzino, direttive attive, risorse naturali, capacità produttive |
| Armamenti | 8 | 3 | oggetti del paese (ObjectsBoard, interattivo), forze, quanto hai/produci, arsenale, peso dei domini, produzione in corso, produzione e acquisti |
| Conoscenze | 3 | 0 | tecnologie, capitale umano, investimento nel popolo |
| Politiche | 3 | 0 | assetto istituzionale, politica fiscale (interattiva), coesione interna |

`NationDock.tsx` è oggi di **1.188 righe** (contate, non stimate).

Due osservazioni che la tabella rende evidenti:

- **Armamenti da sola ha più blocchi (8) di Governo, Progetti, Conoscenze e Politiche
  civili messe insieme** (2 + 1 + 3 + 3 = 9 blocchi per tutta la dimensione civile non
  economica). La misura di `DIREZIONE_CIVILE_DEL_GIOCCO.md` — «lo sbilanciamento è
  tutto nella presentazione» — è ancora vera dopo D01–D07.
- **Governo e Progetti sono sezioni-anticamera:** 2 e 1 blocchi. Un giocatore che apre
  Progetti trova un blocco solo: la scheda esiste per ricordargli dove cliccare, non
  per dirgli qualcosa che non saprebbe altrove. Questo è il contrario di «denso».

### 1.3 Cosa chiede attenzione: due posti, una regola

Oggi «cosa devo fare» vive in due punti della stessa scheda Situazione: la lista unica
della sintesi (lettura) e la card «Decisioni richieste» (scorte, manutenzioni, con
«Prendi atto»). I4 («una sola lista di cose da fare») è rispettata per la lista ma
l'**azione** è divisa in due.

Il modello Victoria 3 che l'autore ha indicato risponde esattamente a questo: una lente
centrale con le cose che chiedono attenzione (con scadenza), e pannelli di stato che
**non pretendono di essere gestiti**, solo letti.

---

## 2. Perché lo stile Victoria 3 è la risposta giusta a questo dossier

Non è un restyling: è la conclusione naturale di D01–D07.

D01 ha reso vero «una cifra, un posto». D03–D05 hanno costruito la sintesi e messo il
dettaglio a richiesta. Quello che resta è la **cornice**: otto ante identiche in cima
allo schermo, dove l'anta «Progetti» e l'anta «Armamenti» sembrano avere lo stesso peso
— e nella pratica lo hanno: `NATION_SECTIONS` le elenca senza gerarchia.

Victoria 3 organizza la stessa materia così: pochi pannelli di governo (Politica,
Economia, Diplomazia, Forze armate), ciascuno denso, e **fuori** dai pannelli una lente
con le cose che chiedono una decisione (eventi, questioni con scadenza). Il giocatore
non «governa» dentro i pannelli: li legge. Governa dalla lente e dagli ordini.

Per World Story la traduzione è diretta, e non inventa nulla:

- la **lente** esiste già come dato: `splitPressuresByAttention` decide quali sfide
  meritano attenzione; la lista unica della sintesi (`nationalSynthesis.ts`) ordina già
  crisi → scadenze → impegni → attenzioni. Manca solo la **casa**;
- la **barra comandi** (`CommandRail.tsx`) accetta già moduli con distintivo (`badge`):
  il numero di questioni aperte è il badge esatto che la lente di V3 mostra in cima allo
  schermo — e il codice lo supporta **già**, senza lavoro nuovo;
- i **pannelli densi** sono il raggruppamento dei 33 blocchi misurati in 4 sezioni:
  nessuna cifra nuova, nessuna cifra persa (I6 resta un contratto).

---

## 3. Le quattro sezioni: cosa resta e dove va

Mappatura **obbligatoria** dalle 8 sezioni attuali alle 4 nuove. «Resta» significa che
il blocco non si muove dalla sua sostanza; «→ X» indica la nuova casa. Nessun blocco
sparisce.

### 3.1 Situazione (era Situazione, alleggerita)

| Blocco attuale | Sorte |
|---|---|
| Sintesi nazionale (lista unica) | **Resta** — è la prima cosa (I3) |
| Indicatori di tenuta | **Resta** |
| Registro completo → Crisi della nazione | **Resta**, ma esce dal `<details>`: le tre strade del collasso non sono «dettaglio a richiesta», sono lo stato |
| Registro completo → Sfide del momento | **Esce dal dossier** → pannello Questioni (§4) |
| Registro completo → Impegni della partita | **→ Stato maggiore** (sono rapporti con l'esterno, non stato interno) |
| Decisioni richieste (scorte, manutenzioni) | **Resta** — è azione di rifornimento, non una sfida del motore; se fonderla nella lista unica come voci azionabili si decide in V02 **misurando** su una partita reale quanto la card e la lista si sovrappongono |
| Strategie delle potenze | **→ Stato maggiore** |
| Quadro d'insieme per dominio (`<details>`) | **Resta** |

### 3.2 Regno (Governo + Politiche + Conoscenze)

La dimensione civile, un'unica sezione densa — la correzione definitiva dello
sbilanciamento misurato in `DIREZIONE_CIVILE_DEL_GIOCCO.md`.

| Da | Blocchi |
|---|---|
| Governo | Quadro del governo; Consiglio dei ministri |
| Politiche | Assetto istituzionale; Politica fiscale (interattiva: resta **fuori** da ogni richiudibile); Coesione interna |
| Conoscenze | Tecnologie sbloccate; Capitale umano; Investimento nel popolo |

8 blocchi. Nome alternativo accettabile: «Società». La scelta del nome è di prodotto,
il contenuto no.

### 3.3 Tesoro (Cassa + Risorse + Progetti)

Tutta la materia economica: il denaro, le cose, i cantieri.

| Da | Blocchi |
|---|---|
| Cassa | Quadro economico; Tesoreria e debito; Flussi mensili; Composizione del bilancio |
| Risorse | Quadro di risorse e industria; Magazzino materiale; Direttive attive; Risorse naturali; Capacità produttive e territoriali |
| Progetti | Progetti e processi (i cantieri sono materia economica) |
| — | «Pressione militare» (oggi in Cassa): **→ Stato maggiore** (I1: stava in Cassa solo perché parla di soldi, ma è una cifra *dello* sforzo bellico) |

10 blocchi. È la sezione più densa: se la prova sul campo la mostrerà troppo lunga, la
suddivisione interna in due gruppi («Denaro» / «Materie e cantieri») è ammessa **senza
una quinta scheda** — due `<h3>` nella stessa sezione, non due ante.

### 3.4 Stato maggiore (Armamenti + estero)

| Da | Blocchi |
|---|---|
| Armamenti | tutti e 9 i blocchi, invariati; la legenda «Come si legge l'arsenale» resta il `<details>` che D07 ha consegnato |
| Situazione | Impegni della partita; Strategie delle potenze |
| Cassa | Pressione militare |

11 blocchi. Il nome dichiara che qui c'è tutto ciò che riguarda la forza e l'esterno:
è il posto dove un giocatore che **non** vuole fare la guerra sa di non dover guardare
— e quello che la vuole sa dove trovare tutto insieme.

### 3.5 La regola che resta

`nationDock.ts` si aggiorna così: `NATION_SECTIONS` diventa
`['situazione', 'regno', 'tesoro', 'statoMaggiore']` con le stesse tre invarianti
(apertura su Situazione; una sezione attiva; navigazione che non muta il mondo). La
navigazione interna (`operatingPicture → onOpenSection`, i rimandi delle metriche di
D01) viene rimappata sulle nuove sezioni **con lo stesso meccanismo**: il quadro per
dominio apre «Regno» per governo/popolo, «Tesoro» per economia/risorse, «Stato
maggiore» per forze armate.

---

## 4. Il pannello «Questioni»: casa nuova delle sfide

**Cosa contiene.** Esattamente ciò che oggi è il blocco «Sfide del momento», spostato
così com'è:

- le pressioni attive, divise da `splitPressuresByAttention` (evidenziate in scena, le
  altre raggruppate nello stesso pannello — il comportamento P2 già in essere);
- per ciascuna: interna/esterna, gravità, finestra temporale, chi preme, le opzioni con
  costo/incasso, il bottone «Decidi» (`onResolvePressure`, invariato);
- le ultime sfide chiuse, in un `<details>` (storico, non interattivo: il `<details>`
  qui è corretto).

**Dove vive.** Nuovo valore `'questioni'` in `ActiveModule` (`stores/moduleState.ts`) e
nuova voce nella barra comandi, con **distintivo = numero di pressioni attive** — il
campo `badge` di `RailItem` esiste già e già mostra «99+» sopra le tre cifre: è lavoro
di montaggio, non di invenzione. Il pannello si monta in `DeskContent.tsx` come gli
altri moduli (`orders`, `advisor`, `news`…), con le stesse props che oggi vanno al
dossier (`nationalPressures`, `recentPressures`, `onResolvePressure`, `pressureBusy`):
nesssuna chiamata nuova, nessun dato nuovo.

**Cosa resta nel dossier.** La lista unica della sintesi **continua a elencare** le
sfide aperte come voci (lettura sola), con l'azione minima che oggi è «la prima opzione
del motore»: il collegamento porta al pannello Questioni. La regola I4 non cambia:
una sola lista. Cambia dove si **decide**, non dove si **sa**.

**Il test di D07 viene aggiornato, non silenziato.** «Nessun blocco interattivo in un
richiudibile» smette di avere l'unica eccezione dichiarata in D05: nel dossier non c'è
più nessun blocco interattivo richiudibile, e l'eccezione si **cancella** dalla
costante — come da metodo, le eccezioni si dichiarano e si eliminano, non si
moltiplicano.

**Nome della voce.** «Questioni» (le *questions* della Prussia in V3) è la proposta;
«Sfide» e «Decisioni» sono alternative di pura etichetta.

---

## 5. Invarianti obbligatorie (V1–V6)

Valgono per ogni fase. Non sostituiscono I1–I7 del piano D: **le estendono**. Dove una
fase di questo piano entrasse in conflitto con una invariante D, il conflitto va
dichiarato e risolto nel piano, non nel codice.

**V1 — Il dossier è un documento di stato; le risposte stanno in Questioni.** Nel
`NationDock` non resta nessuna lista di pressioni con opzioni. Le voci-sfida della
sintesi portano al pannello, non lo replicano.

**V2 — Quattro sezioni, non otto, non tre.** La mappatura di §3 è obbligatoria. Se un
blocco non trova posto, il posto è sbagliato: si corregge la sezione, non si aggiunge
una quinta scheda (regola ereditata da §8 del piano D).

**V3 — Nessuna metrica e nessun blocco perduti.** Ognuno dei 33 blocchi di §1.2
compare nella mappatura di §3. Il confronto è meccanico: l'elenco dei blocchi prima e
dopo coincide, cambia solo la colonna «sezione».

**V4 — Nessun blocco interattivo in un richiudibile, senza eccezioni.** Nel dossier:
politica fiscale e ObjectsBoard restano visibili; il `<details>` del registro sparisce
con il registro stesso. Nel pannello Questioni: le opzioni di risposta sono sempre
visibili; solo lo storico è sotto `<details>`.

**V5 — Il pannello Questioni usa i dati che il dossier già riceve.** Stesse props,
stesso read model. Se una fase sembra richiedere un dato nuovo dal motore, la fase è
sbagliata e va riprogettata (regola ereditata da §8 del piano D e dal confine misurato
in `COERENZA_DOSSIER_ANNO_NAZIONE.md` §5).

**V6 — Ogni invariante ha un test-contratto.** Con guardia contro il falso verde, come
da metodo: un test che conta blocchi deve fallire se il parser non trova nulla
(`expect(found).toBeGreaterThan(N)`).

---

## 6. Le fasi

Cinque fasi, in ordine di dipendenza. Ognuna consegnabile da sola, con la sua PR e il
suo Quality Gate.

### V01 — Il pannello «Questioni» esiste e il dossier si alleggerisce — *consegnata*

**Cosa.** Aggiungere `questioni` ad `ActiveModule` e alla barra comandi (badge =
pressioni attive). Creare `QuestionsPanel.tsx` che monta `PressuresBlock` con le props
già disponibili in `DeskContent`. Togliere «Sfide del momento» dal registro completo
del dossier; il `<details>` resta con **Crisi** e **Impegni** fino a V02/V03 (ridotto,
non vuoto: I6 vieta di far sparire impegni e crisi prima che abbiano la nuova casa).
Le voci-sfida della sintesi puntano al pannello.

**Attenzione.** Il dossier senza sfide deve comunque aprirsi uguale per chi non ha
pressioni attive: lo stato vuoto («Nessuna sfida aperta») vive solo nel pannello,
non nel dossier. Il badge è visibile **solo** quando ci sono questioni aperte (il
componente rail lo mostra già solo se `> 0`).

**Verifica.** Test-contratto nuovo (`questionsPanel.test.ts`): il dossier non contiene
più «Sfide del momento»; il panello sì; il badge della rail corrisponde a
`pressures.length`. I test D esistenti restano verdi **tranne** quello che difende
l'eccezione-registro: si aggiorna cancellando l'eccezione, e il test deve continuare a
contare i blocchi (guardia contro il falso verde).

> **Consegnata** — 11 test in `questionsPanel.test.ts`, più gli aggiornamenti a
> `nationDockSingleSource.test.ts` (l'eccezione D05 si **cancella**, con una guardia
> nuova: il parser deve trovare almeno un `<details>`), `nationalContext.test.ts`
> (la voce nuova e il distintivo) e `moduleState.test.ts` (il modulo nuovo).
> Suite: 47 test verdi sui file toccati, 101 verdi sui vicini, tsc pulito, build
> 187 moduli verde.
>
> La misura ha trovato **due cose che l'analisi manuale non aveva visto**:
>
> 1. **Il test-contratto, scritto ingenuo, colpiva la nota che spiega il
>    cambiamento.** Cercare «Sfide del momento» ovunque nel sorgente fallisce
>    contro il commento che dice *dove sono finite*: la frase è sparita come
>    card, non come parola. L'invariante va scritta sull'**artefatto** (`title="Sfide
>    del momento"`, `<PressuresBlock`), non sulla stringa — è la stessa lezione di
>    D02: «il test deve vedere il tono, non l'assenza di un difetto».
> 2. **`ActiveModule` ha due dichiarazioni parallele**: una in `stores/moduleState.ts`
>    (canonica) e una in `components/Shell/CommandRail.tsx` (localmente
>    ri-dichiarata per non importare dallo store). Aggiungere il modulo ha
>    richiesto di toccarle **entrambe** — una seconda verità in miniatura, dello
>    stesso tipo che il piano D ha combattuto sulle cifre. Non si risolve in V01
>    (è cosmetico e rischioso da toccare adesso): si dichiara qui come pulizia
>    candidata di V05.
>
> Le props `pressures`/`recentPressures`/`onResolvePressure`/`pressureBusy`
> **restano** nella firma di `NationDock`: la prima serve ancora al read model
> della sintesi (la lista unica elenca le sfide), le altre sono ora inerte ma
> dichiarate, e cadranno in V05 se nessuno le usa più.

### V02 — Crisi e Decisioni in superficie, nella nuova Situazione — *consegnata*

**Cosa.** «Crisi della nazione» esce dal `<details>` e diventa un blocco della
sezione Situazione (sotto gli Indicatori di tenuta). «Decisioni richieste» resta in
Situazione; misurare se fondere le sue azioni nella lista unica come voci azionabili o
tenerla come card — la misura è: quante volte, su una partita reale, la lista unica e
la card dicono la stessa cosa (si esegue su `world-story.db`, non si deduce).

**Attenzione.** Crisi fuori dal richiudibile significa che una partita finita mostra il
blocco-endgame in apertura di dossier: corretto (è lo stato), ma va verificato
l'`EmptyState` per le partite dove il motore non ha ancora valutato la tenuta.

**Verifica.** Test: in Situazione non esiste più `<details>` che contenga blocchi con
azioni; la sezione aperta per default contiene: sintesi, indicatori, crisi, decisioni,
(nell'ordine) e nient'altro di interattivo.

> **Consegnata** — `crisisSurface.test.ts` (4 test), più l'aggiornamento di
> `questionsPanel.test.ts`: il contratto di V01 era «le sfide non sono più nel
> registro», non il **titolo** del registro, che V02 ha ridotto ancora («impegni»).
> Un test scritto sul titolo esatto si rompe alla fase successiva per il motivo
> sbagliato — lezione gemella di quella di V01 (scrivere sull'artefatto, non sulla
> stringa). Suite: 800 test verdi (91 file), tsc pulito.
>
> **La misura ha smentito la premessa della fase, e la fase è cambiata.** Il testo
> diceva «misurare se fondere le azioni di *Decisioni richieste* nella lista unica».
> La misura dice che non c'è nulla da fondere, per **due** ragioni indipendenti:
>
> 1. **I dati non esistono.** `mandate_decisions` è **vuota** in tutte le partite del
>    database reale (`backend-nest/data/world-story.db`); le partite sono tutte al
>    turno 1–2, con al più 1 pressione attiva e zero impegni. La sovrapposizione
>    lista↔card, su ciò che esiste, è zero.
> 2. **La duplicazione vera è un'altra.** `strategicBriefing.ts` (:290–307) elenca
>    **già** mandati e manutenzioni, con le stesse etichette della card «Decisioni
>    richieste» (`.slice(0, 6)`, ma la voce c'è). Quindi la card non duplica la
>    *lista* della sintesi: duplica il *briefing* — che è un'altra superficie.
>    Fonderla nella lista della sintesi aggiungerebbe una **terza** copia, non ne
>    toglierebbe una.
>
> Decisione conseguente: **la card resta**, e il problema vero (tre superfici per la
> stessa informazione: briefing, sintesi, card) si dichiara come pulizia di V05, dove
> `strategicBriefing` e `nationalSynthesis` vengono riconciliati. Fonderla adesso
> sarebbe stato riscrivere il briefing con i dati che non ci sono.

### V03 — Le otto sezioni diventano quattro — *consegnata*

**Cosa.** Rinominare `NationSection` in `situazione | regno | tesoro | statoMaggiore`;
spostare i blocchi secondo §3; rimappare le etichette (`NATION_SECTION_LABEL`), lo store
e i rimandi di D01 (`onClick` delle metriche-rimando, `onOpenSection` del quadro per
dominio). Impegni, Strategie delle potenze e Pressione militare cambiano sezione come
da mappatura.

**Attenzione.** Questa è la fase che tocca più codice (1.188 righe di `NationDock.tsx`
per lo più riordinate) e **zero dati**: neppure una metrica cambia valore, tono o
hint. I test D01 (una cifra un posto) e D02 (toni e rapporti) devono restare verdi
**senza modifica**, salvo l'aggiornamento dei nomi di sezione che compaiono nei
rimandi («vedi Cassa» → «vedi Tesoro»): le STRINGHE dei rimandi fanno parte del
contratto D01 e vanno aggiornate nello stesso PR.

**Verifica.** Test-contratto nuovo: l'insieme dei blocchi per sezione coincide con §3
(elenco esplicito nel test, con guardia sul totale = 33 blocchi); `nationDock.test.ts`
dello store aggiornato alle 4 sezioni; E2E `country-clarity.spec.mjs` aggiornato dove
apre sezioni per nome.

> **Consegnata** — mappatura finale: **Situazione 3, Regno 8, Tesoro 10, Stato
> maggiore 11 = 32 blocchi** (il 33esimo era «Sfide del momento», a Questioni da
> V01). Test nuovo `dossierSections.test.ts` (5 test) con la mappa **esatta** — non
> solo «ci sono i blocchi attesi», ma «nessun blocco imprevisto» — e la guardia sul
> conteggio per sezione. D01/D02 verdi: le uniche modifiche sono i **nomi** di
> sezione (`SUMMARY_PAIRS`, `SECTIONS`), esattamente il caso previsto dal piano.
> Suite: 67+25 file verdi, 551+254 test, tsc pulito, build 187 moduli verde. E2E
> aggiornati (`modules.spec.mjs`: 8 tab → 4; `country-clarity`, `materiel-clarity`,
> `op-objects`, `map-p4-gameplay`).
>
> **Difetti trovati dalla misura, non dall'analisi:**
>
> 1. **Il compilatore non basta a proteggere una ricomposizione di testo.** Il
>    riordino è stato fatto con uno script sul sorgente; la prima passata ha
>    **perso** il blocco «Progetti e processi» (il suo corpo era finito in Tesoro
>    ma senza il `<DossierBlock>` che lo intitola) e ne aveva una copia orfana in
>    più. `tsc` era verde: il JSX era sintatticamente valido, e solo il test di
>    mappatura lo ha visto. È l'esempio che giustifica il test-contratto: una
>    perdita silenziosa di contenuto che nessun altro strumento intercetta.
> 2. **Un E2E era già rotto prima di V03.** `op-objects.spec.mjs` cercava ancora
>    `aria-label="Sala di governo"`, il titolo che D07 aveva rinominato in «Oggetti
>    del paese: esercito, impianti, cantieri, marina». Non è una regressione di
>    questo piano, ma un test che nessuno eseguiva più: va annotato perché mostra
>    che gli E2E, se non girano nella CI, si scollegano dal codice senza avvisare.
>
> Le props `recentPressures`/`onResolvePressure`/`pressureBusy` di `NationDock`
> restano inerte: la pulizia è di V05.

### V04 — Voci di sezione e densità finale — *consegnata*

**Cosa.** Intestazioni e descrizioni delle 4 sezioni riscritte per dire cosa
contengono (pattern già usato in D05: «il titolo dice cosa c'è dentro»); la sezione
Tesoro ottiene i due gruppi tipografici «Denaro» / «Materie e cantieri» se la
suddivisione di §3.3 risulta necessaria alla prova reale.

**Verifica.** Apertura manuale (screenshot in PR) delle 4 sezioni su una partita
`europa_1815` e una `modern_world_provinces`: stessa densità percepita, nessuna
sezione vuota.

> **Consegnata** — una voce di una riga (`.nation-section-voice`) apre **Regno**,
> **Tesoro** e **Stato maggiore**: un testo in corsa che dice che cosa contiene la
> sezione («La dimensione civile della nazione…», «Tutta la materia economica…»,
> «La forza e l'estero…»). **Situazione è esclusa**: apre già con la sintesi (I3), e
> una voce sopra il giudizio sarebbe rumore. Tesoro è diviso in due gruppi
> tipografici (`<h3 class="nation-group-head">`): **Denaro** e **Materie, industria
> e cantieri** — due intestazioni, **non** due schede nuove (la regola «niente
> quinta scheda» di §9).
>
> Il test `sectionVoice.test.ts` difende anche che la voce sia **solo testo**:
> nessuna cifra al suo interno (sarebbe una card travestita).

### V05 — Pulizia finale e chiusura di D06 — *consegnata*

**Cosa.** Aggiornare i due piani precedenti (annotazioni «Consegnata» e rimandi a
questo piano); cancellare il `<details>` «Registro completo» se ancora presente;
verificare che `OperatingPictureBoard` resti il solo quadro d'insieme (test di D06,
che esiste già come criterio C5).

**Verifica.** Criteri C1–C8 rivisti in §8, tutti verdi contemporaneamente.

> **Consegnata** — tre pulizie:
>
> 1. **Le props inerte del dossier sono uscite.** `recentPressures`,
>    `onResolvePressure` e `pressureBusy` non erano più usate da nessuna riga di
>    `NationDock.tsx` (misurato: zero occorrenze): tolte da `NationDock/types.ts` e
>    dal passaggio in `DeskContent`. `pressures` **resta**: la lista unica della
>    sintesi le legge ancora. Esse servono, ora, solo al pannello Questioni.
> 2. **Le definizioni doppie sono state unificate.** `ActiveModule` era dichiarato
>    in `stores/moduleState.ts` **e** in `CommandRail.tsx`; `RailItem` in
>    `nationalContext.ts` **e** in `CommandRail.tsx`. Due elenchi paralleli degli
>    stessi moduli: aggiungerne uno richiedeva di ricordarsi di entrambe (V01 l'ha
>    dovuto fare a mano). Ora `CommandRail` importa i tipi canonici.
> 3. **D06 è chiusa** con un'annotazione nel piano D: la decisione di prodotto è
>    stata presa, `OperatingPictureBoard` è l'unica superficie del quadro d'insieme
>    (montato una volta sola, verificato), `ObjectsBoard` resta nel dossier per la
>    lettura e il suo spostamento completo è la *decisione aperta D-1*.
>
> Il `<details>` del registro era già stato ridotto a «impegni» in V02 e vive ora
> in Stato maggiore.

---

## 7. Il rapporto con D06: la decisione presa qui

D06 aspettava una decisione di prodotto: **fondere `ObjectsBoard` nella sintesi o
lasciarlo superficie a sé**. Le due decisioni dell'autore del 2026-09-26 la risolvono
senza nominarla:

- il dossier diventa documento di stato (decisione 1: le sfide escono perché sono
  *azioni*, non stato);
- `ObjectsBoard` è interattivo (D07 lo ha misurato: crea reparti, dà ordini) —
  quindi **non è un blocco del dossier per la stessa ragione**.

**Decisione registrata:** `ObjectsBoard` resta nel dossier **solo** finché serve al
giocatore leggere cosa possiede (esercito, impianti, cantieri, marina). Spostarlo del
tutto in un pannello proprio è una decisione **ulteriore**, da prendere dopo V03,
quando Stato maggiore avrà la sua forma definitiva: questo piano la elenca come
*decisione aperta D-1* e non la esegue. Regola del metodo: quando un vincolo rende
impossibile una fase, si dichiara, non si allarga il mandato.

> **Correzione (2026-09-26, misurata).** La prima stesura di questo paragrafo diceva
> che «le sue azioni sono già disponibili anche dal modulo Ordini». **È falso**, e la
> misura lo smentisce: il modulo Ordini (`ActionsPanel`) non riceve nessuna delle 12
> azioni di `ObjectsBoard` e non nomina reparti o formazioni. `raise_formation`,
> `procure` e `trade` — creare reparti, comprare equipaggiamento, commerciare — sono
> raggiungibili **solo** da `ObjectsBoard`; le azioni di reparto e gli ordini anche dal
> `ProvinceInspector` sulla mappa. La frase era una deduzione, non una misura: la
> diagnosi completa e le opzioni sono in `DECISIONE_D1_OBJECTSBOARD.md`.

---

## 8. Criteri di completamento e verifica

Il piano è completo quando, **contemporaneamente**:

| # | Criterio | Prova |
|---|---|---|
| C1 | C1–C8 del piano D ancora verdi | suite esistenti |
| C9 | Nessuna lista di pressioni dentro `NationDock.tsx` | test V1 |
| C10 | La barra comandi ha la voce Questioni con badge = pressioni attive | test V1 + screenshot |
| C11 | Quattro sezioni, mappatura conforme a §3 (32 blocchi) | test V3 con guardia |
| C12 | Nessun blocco interattivo in un richiudibile, **zero eccezioni dichiarate** | test D07 aggiornato |
| C13 | Nessuna metrica con valore/tono/hint modificato da questo piano | diff dei test D01/D02 |
| C14 | Mobile e a11y verdi | `npm run test:a11y`, `hudMobileLayout` |

---

## 9. Cosa NON fare

**Non aggiungere una quinta scheda.** Ereditato dal piano D: se Tesoro è troppo denso,
si suddivide tipograficamente, non si riapre lo schedario.

**Non silenziare il test dell'eccezione.** Il `<details>` delle sfide si elimina
togliendo il blocco, non allentando la guardia.

**Non duplicare le sfide.** Se la sintesi le elenca e il pannello le risolve, il
pannello non le ri-elenca «in sintesi»: dentro Questioni le sfide si vedono per
intero o non si vedono.

**Non chiedere dati nuovi al motore.** Badge, divisione evidenziate/dossier, finestre,
opzioni, storico: tutto già pubblicato. Se manca qualcosa, è una decisione separata
(§5 del piano N insegna).

**Non rinominare senza rimappare.** Cambiare «Cassa» in «Tesoro» dentro i rimandi di
D01 fa parte della stessa PR di V03: un rimando che dice «vedi Cassa» e porta altrove
è un difetto nuovo, non un dettaglio.

---

## Appendice — Cronologia delle decisioni

| Data | Decisione |
|---|---|
| 2026-09-24 | Piano D: sintesi + dettaglio a richiesta (D01–D07) |
| 2026-09-25 | Piano N: coerenza anno/nazione (N01–N08); D06 bloccata su decisione di prodotto |
| 2026-09-25 | Direzione civile: pari dignità alla scheda civile (M01–M03) |
| 2026-09-26 | **Questo piano: sfide fuori dal dossier (pannello Questioni); otto sezioni → quattro; D06 risolta come «decisione aperta D-1»** |
| 2026-09-26 | **V01 consegnata**: il modulo `questioni` nella barra comandi (distintivo = sfide attive), `QuestionsPanel`, il dossier senza «Sfide del momento», i test-contratto |
| 2026-09-26 | **V02 consegnata**: la crisi in superficie (fuori dal richiudibile); la misura ha mostrato che «Decisioni richieste» non va fusa (i dati non ci sono, il briefing la duplica già) |
| 2026-09-26 | **V03 consegnata**: le quattro sezioni (Situazione 3, Regno 8, Tesoro 10, Stato maggiore 11 blocchi); `dossierSections.test.ts`; il test di mappatura ha intercettato un blocco perso nella ricomposizione |
| 2026-09-26 | **V04 e V05 consegnate**: voce alle tre sezioni dense e due gruppi tipografici in Tesoro; props inerte rimosse; `ActiveModule`/`RailItem` a definizione unica; D06 chiusa. **Piano completo** |
| 2026-09-26 | **D-1 risolta (opzione B)**: la sala operativa `ObjectsBoard` esce dal dossier e vive nel pannello **Forze** (`ForcesPanel.tsx`, modulo `forze`). Il dossier scende a 31 blocchi, zero interattivi. La misura ha smentito la premessa «le azioni sono già nel modulo Ordini» |
