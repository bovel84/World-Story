# Piano — L'affidabilità delle mappe nel governo

> **Stato:** **M01+M02 e M05 ESEGUITE** (2026-10-09). La mappa compare in una
> partita reale senza fronti, e il Consulente ha imparato a chiederla. **M03**
> (diagnostica del degrado), **M04** (declassata) e **M06** (banco e2e «nudo»)
> restano proposte. Il falso positivo del regex sul testo negato è dichiarato,
> non corretto.
> **Origine:** proposta di revisione dell'autore (parere esterno) + misura diretta
> sul codice di `main` (commit `b8e29b1`, che include già le PR #247 e #248) e su
> una **partita reale** (`open-pax.db`, Corea del Sud, *millennium*).
>
> **La regola di questa sessione.** Il parere esterno è un'ipotesi; qui vale solo
> ciò che è stato **eseguito**. Ogni affermazione sotto ha accanto la prova.
> Dove la misura smentisce — anche una **mia** ipotesi — lo dico in chiaro (§1.5,
> §5).

---

## 1. La misura

### 1.1 Metodo

Le sonde stanno in `frontend/src/ms_measure*.test.ts` (provvisorie, da rimuovere a
fine lavoro) e girano con il runner reale del progetto:

```
cd frontend && ../node_modules/.bin/vitest run src/ms_measure.test.ts
```

**Riproduzione** (le sonde sono state rimosse a fine stesura, come da convenzione
del progetto). L'export delle regioni si rigenera dal DB reale:

```
python3 - <<'PY'
import sqlite3, json
c = sqlite3.connect('backend-nest/data/open-pax.db')
rows = c.execute("select id,name,svg_path,geojson,color,owner from world_regions where world_id='676eb9c10110'").fetchall()
json.dump([{"id":i,"name":n,"svgPath":s or None,"geojson":g or None,"color":col or '#3a3f4b',"owner":o}
           for i,n,s,g,col,o in rows], open('frontend/src/ms_regions.json','w'))
PY
```

Poi si importano `buildMapContextIndex` (`components/Map/mapContext`) e le funzioni
di `components/Game/governmentVisual` come fanno i test esistenti.

Le sonde caricano `frontend/src/ms_regions.json`: un **export statico** delle
**4475 regioni** del mondo *Millennium Dawn — 2000*, coerente col database reale
ma non letto dal DB a ogni esecuzione. Ogni regione è ricostruita svuotando i
campi non necessari alle grandezze misurate (popolazione, PIL, oggetti, confini,
metadati); per conteggio, proprietario e geometria è equivalente, ma **non è lo
stato di gioco completo** — è una ricostruzione. Da quest'export si costruisce
`buildMapContextIndex` con `units: []`, `fronts: []`. Giocatore: **Corea del Sud**
(`KOR`), **61 regioni** possedute, **una sola** relazione ostile in uscita
(`PRK`, 25 regioni). La partita reale (`9d11ac128185`, `world_revision` 4) ha
**zero fronti** (misurato: `game_operational_objects` ha 243 oggetti — navi,
impianti, unità, flotte, personale — nessuno di tipo `front`).

### 1.2 La catena, in un colpo d'occhio

Perché compaia una scheda sotto un messaggio, servono **quattro** cose, in
sequenza, e ognuna può interrompere il flusso:

1. `visualSnapshot` esiste → altrimenti `GovernmentMessageVisuals` rende `[]`
   senza nemmeno provare (`GovernmentMessageVisuals.tsx:13`);
2. `message.visualRequest` esiste (o `evidence` mappa) → altrimenti
   `resolveGovernmentVisuals` esce vuoto quando non ci sono fronti
   (`governmentVisual.ts:113`);
3. almeno un riferimento geografico **risolve** su un ID canonico → altrimenti
   niente carta;
4. la geometria è disegnabile → altrimenti riepilogo testuale.

### 1.3 Le affermazioni del parere esterno, una per una

| # | Affermazione | Esito | Prova |
|---|---|---|---|
| a | Senza fronte verificato o richiesta geografica risolvibile, il Consulente non genera card | **CONFERMATA** | sonda A: 0 card |
| b | «Fammi vedere la mappa» è riconosciuto ma questo non basta a individuare i territori | **CONFERMATA** | sonda B: intento `true`, ma `contextRegionIds` è `undefined` senza una direttiva mappa precedente |
| c | Oltre 20 regioni la mini-mappa diventa riepilogo testuale | **CONFERMATA, e peggio** | sonde C, G, I, J: tre esiti diversi, uno dei quali è il vuoto |
| d | `resolveGovernmentVisuals()` è il punto dove si interrompe | **CONFERMATA** | `governmentVisual.ts:79`, ramo `:113` |
| e | Un controllo su `GameScreen.tsx` può bloccare tutte le schede | **NON È LA CAUSA PRINCIPALE** | ipotesi mia, **smentita**: §1.5 |

### 1.4 Le prove numeriche

**A — richiesta generica senza segnali → nessuna card.**

```
MEASURE A generic request → 0 cards
```

`resolveGovernmentVisuals({ visualRequest: {requested, signalKeys: []} }, snap)`
con `fronts: []` non ha né fronti (`:93`) né `checkedIds` (`:101`) né
`visualRequest.regionIds` (`:106`); il ramo diplomatico (`:117`) richiede le
chiavi `hostile-relations…`, che qui non ci sono. Esito: `[]`.

**B — i ministri e il Consulente riconoscono la frase, ma non portano territori.**

```
MEASURE B intent recognized = true, but councilRoom passes contextRegionIds=undefined …
```

`isGovernmentMapRequest('Mostrami la mappa del nostro paese')` → `true`
(`governmentVisualRequest.ts:13`). Ma in `councilRoom.ts:282` la chiave
`contextRegionIds` è presa **solo** da una direttiva mappa precedente nello
stesso scope (filtro a riga 278); in una seduta normale non esiste. Stessa cosa
nel Consulente (`AdvisorChat.tsx:160`): `contextRegionIds` è `undefined` se
`previous` non aveva già una mappa dello stesso scope. Quindi `GovernmentMapRequest` nasce con
`signalKeys` (dalla `sourceIssue`, tipicamente `conflict:…`) e **senza**
`regionIds`. La frase del Presidente viene capita, ma non porta territori.

**C — il tetto delle 20 regioni ha TRE facce, e una uccide la richiesta.**

Misurato (`MAX_MAP_REGION_IDS = 20`, `presentation.ts:65`):

*C-1 — una richiesta del modello con 61 id viene uccisa, non ridotta.*

```
MEASURE G parsed directive: {"op":"focus","evidence":"mappa","regionIds":[ …20 id… ],"invalidRegionIds":true}
MEASURE G directive with 61 ids → cards = 0
```

`presentation.ts:253-259`: `regionIds` viene **troncato** a 20 (`.slice(0, 20)`,
riga 256) **e** `invalidRegionIds` diventa **`true`** perché `length > 20`
(riga 259). In `governmentVisual.ts:88` `if (maps.some(d => d.invalidRegionIds))
return [];` → **zero carte.** I due strati si contraddicono: uno taglia a 20,
l'altro dichiara «più di 20 = non valido».

*C-2 — una richiesta canonica viva mostra la scheda, ma in forma testuale.*

```
MEASURE I live 61-region request → cards = 1 | regionIds = 61
MEASURE I model preview = null (textual) | regions = 61
```

Una `visualRequest` con 61 id **validi** produce **una** card, ma
`governmentVisual.ts:181` la manda al riepilogo testuale:
`bounded = source !== 'front' && regions.length > 20` → `preview: null`. La card
non elenca i nomi: `GovernmentVisualCard.tsx:30` sopra le 20 regioni rende il
solo testo «61 territori canonici», con la legenda dei proprietari.

*C-3 — dopo un ricaricamento, quella stessa richiesta sparisce del tutto.*

```
MEASURE J reload with 61 ids   → visualRequest kept = NO (dropped)
MEASURE J reload with 20 ids   → visualRequest kept = yes
```

`readGovernmentVisualMetadata` (`governmentVisualRequest.ts:41`) valida
`regionIds` con il tetto di 20 e, se lo supera, **scarta l'intera
`visualRequest`**. Quindi una mappa già mostrata **sparisce al reload**. Le note
di stile #247/#248 promettevano una scheda mappa inline: sopra le 20 regioni
quella promessa non è mantenuta, e su tre strade diverse.

**E — la geometria NON è il problema.** La mia ipotesi di partenza era che 61
regioni fossero troppo estese o mal coordinate per essere disegnate. La misura la
smentisce:

```
MEASURE E n=4:  paths=4/4   span=8.77
MEASURE E n=20: paths=20/20 span=8.84
MEASURE E n=61: paths=61/61 span=8.84
MEASURE F KOR paths ok = 61 empty = 0  bounds span = 8.84
```

Il territorio completo della Corea si disegna: 61 path su 61, nessuno vuoto,
estensione ~8,8° (nessun antimeridiano, che scatterebbe sopra 184°). **A
nascondere la mappa è il tetto, non la geometria.**

### 1.5 La correzione di una mia ipotesi, dichiarata

Avevo ipotizzato che `militaryAvailable === false` (la snapshot militare non
allineata, `GameScreen.tsx:130-133`) bloccasse **tutte** le schede, comprese le
richieste esplicite già risolte, per via di un `return []` che cadeva dal ramo
fronti. **La misura smentisce l'ipotesi:**

```
MEASURE H explicit request, militaryAvailable=true  → cards = 1
MEASURE H explicit request, militaryAvailable=false → cards = 1
```

La riga 93 è una **guardia**, non un `return []`:
`if (snapshot.militaryAvailable !== false) for (const key of keys) {`, e la riga
94 fa `continue` su ogni chiave che non inizi con `conflict:`. Con `signalKeys:
[]` (o senza `conflict:…`) il corpo del ciclo non produce nulla, quindi **niente
può essere bloccato** da quella guardia. Una richiesta esplicita con `regionIds`
canonici **non** è bloccata dalla snapshot militare. **La causa principale del
silenzio non è questa.** (Resta un caso residuo vero ma stretto: una questione di
guerra — chiave `conflict:…` — durante il caricamento militare, che si auto-ripara
appena la snapshot arriva. È transitorio, non spiegherebbe una partita intera.)

Ho corretto questo documento di conseguenza: la fase «deroga dai fronti» che
avevo previsto è stata **declassata** (§3, M04).

### 1.6 La causa a monte: il prompt del Consulente non insegna la mappa

Misurato: `backend-nest/src/prompts/advisor.ts` non contiene **mai** la parola
`tavola` (`grep -c tavola → 0`) e non insegna la sintassi delle direttive mappa.
Insegna solo `[[chart: territorio|bilancio|risorse|trend]]`, che è un'**altra**
funzione (le figure di `AdvisorChart.tsx`). Quindi il modello **non può** emettere
```` ```tavola {"op":"focus","evidence":"mappa"} ```` perché non sa di poterlo
fare. I ministri invece **lo sanno** (`MinisterDialogueRules.ts:52-57`).

**Corollario.** Prima di scrivere il prompt, va fissato **chi** fornisce i
`regionIds`. Il modello non deve inventarli: gli id canonici di 4475 regioni non
stanno nel contesto, e indovinarli violerebbe la regola di fondo («il modello
sceglie *cosa* mostrare, mai le cifre»). Deve fornirli il **read model canonico**
— le regioni possedute, il proprietario della regione selezionata, i membri della
questione. Al modello resta la scelta di **mostrare o no**.

### 1.7 Perché i test erano verdi e la partita no

Le due PR erano verdi perché i mock erano favorevoli. Misurato:

- `governmentVisual.test.ts` costruisce 2 regioni (`north`, `east`) e un fronte
  `active` **già presente** nell'indice (`:10-16`), con `buildGovernmentVisualSnapshot`
  che passa `militarySnapshotKey === canonicalSnapshotKey`. **Presuppone le
  condizioni che in partita mancano.**
- **`councilVisuals.test.tsx:15-16`** costruisce 3 regioni con un fronte `active`
  **e** una relazione ostile (`relationships: { A: { B: 'hostile', C: 'neutral' } }`).
- `e2e/tests/government-map-focus.spec.mjs`: il caso «direttiva spontanea del
  ministro» usa un **fronte attivo** (`fronts: [F1]`); il caso «richiesta
  esplicita senza direttiva» (`requested = true`) usa una relazione ostile
  singola (`relationships: { ALPHA: { BETA: 'hostile', GAMMA: 'neutral' } }` →
  `hostile.length === 1`, `governmentVisual.ts:118`), e asserisce poi «Contesto
  diplomatico»: passa per il ramo diplomatico, non per la richiesta.

Nessun test costruisce il caso dell'autore: **una partita senza fronti, senza
direttiva mappa, senza relazione ostile, con il Presidente che chiede il proprio
paese.** Il banco e2e è verificato **per lettura**, non eseguito in questa
sessione. Questo è il buco che il piano deve chiudere.

---

## 2. Le invarianti

Valgono per tutte le fasi. Sigle `M-I…`, citate nei test.

- **M-I1 — La geografia viene dal motore, mai dal modello.** Il modello sceglie
  *cosa* mostrare; gli `regionIds` provengono dal **read model canonico**. Nessun
  id inventato dal modello raggiunge una scheda. (Eredita la regola C01.)
- **M-I2 — Nessuna geometria inventata.** Solo ID canonici dello snapshot
  corrente; anteprima solo se la geometria è disegnabile fedelmente; altrimenti
  si dichiara l'assenza, non si abbozza.
- **M-I3 — Le regioni possedute sono una risposta canonica alla richiesta
  esplicita.** Se il Presidente chiede esplicitamente la mappa e non c'è un
  riferimento più preciso, il **territorio posseduto** è la rappresentazione
  minima. Senza fronte, senza guerra, senza direttiva.
- **M-I4 — Un tetto non distrugge.** Superata la soglia di regioni, la scheda
  degrada al **riepilogo più ricco possibile** (elenco dei territori, legenda),
  **mai** a un vuoto, e **mai** sparisce al reload. Nessun `return []` per
  «troppe regioni».
- **M-I5 — Il degrado è dichiarato.** Se una mappa non può essere costruita, la
  UI dice **perché** (snapshot indisponibile / nessun riferimento / ID non validi
  / geometria assente / troppe regioni), senza fingere che vada tutto bene.
- **M-I6 — Retrocompatibilità.** Le direttive e le richieste esistenti restano
  valide; un messaggio vecchio non viene ri-badgiato con la geografia nuova.

---

## 3. Le fasi

Ordine di dipendenza. Ognuna è consegnabile da sola, con la sua PR e il suo
Quality Gate.

> **M01 + M02 ESEGUITE (2026-10-09).** Frontend, una PR. Il criterio minimo
> dell'autore è soddisfatto **e misurato**: partita reale (`KOR`, 61 regioni),
> `fronts: []`, `militaryAvailable === false`, `militarySnapshotKey: null`,
> nessuna direttiva → **una card con le 61 regioni possedute e la geometria
> disegnata** (61 path SVG). Nuovo helper `playerOwnedRegionIds`
> (`governmentVisual.ts`), nuovo tetto di resa `MAX_MAP_PREVIEW_REGIONS = 800`
> (`presentation.ts`), scelto sul **costo misurato** (4475 regioni → 4475 path,
> 2,7 MB, ~750 ms; il paese → 45 ms).
>
> **La correzione vive nel resolver, non nei chiamanti.** Il territorio posseduto
> è l'**ultima risorsa di `resolveGovernmentVisuals`**: si applica solo se il
> messaggio è una richiesta esplicita **e** non porta alcuna chiave situazionale
> (`keys` vuote), quindi **dopo** fronti e diplomazia. Nessuna firma pubblica è
> cambiata (`councilRoom`, `AdvisorChat`, `GovernmentOffice` intatti).
>
> **Una regressione introdotta e corretta, dichiarata.** La prima stesura passava
> il territorio posseduto come `contextRegionIds` nei **chiamanti**: la card
> «posseduto» veniva costruita **prima** del ramo diplomatico e lo **preemptava**
> (una relazione ostile verificata mostrava il paese invece della relazione). La
> verifica indipendente l'ha riprodotta; ora il posseduto è un ultimo ramo del
> resolver e la diplomazia vince. Difeso da `governmentVisualOwnership.test.tsx`
> («la mappa posseduta non preempta i riferimenti verificati»).
>
> **C-1 lasciata invariata, e perché.** La misura — non l'analisi — ha mostrato
> che `invalidRegionIds` per una direttiva del **modello** con 21 id è un
> **contratto difeso** (`presentation.test.ts:79`), non un difetto: il payload
> non fidato resta fail-closed. La correzione vera era a monte (M01): il modello
> non deve indicare i territori. Le facce **C-2** e **C-3**, quelle dei **canali
> canonici**, sono corrette.
>
> **Un test esistente cambiato di proposito.** `councilVisuals.test.tsx:90`
> asseriva «richiesta esplicita senza geografia verificata → nessuna card»: è
> esattamente il comportamento che M01 cambia. Riscritto con nota, e affiancato
> da un caso negativo (prosa storica **senza** richiesta esplicita → nessuna card).
>
> **Verifica.** 108 test verdi sulle 7 suite del perimetro mappe + 184 su 20 suite
> correlate, `tsc` pulito, 13 nuovi test in `governmentVisualOwnership.test.tsx`.

### M00 — La misura, in chiaro *(nessun codice)* — **FATTA in questo documento**

Sonde A–J eseguite sul DB reale. Consegna: §1. Le sonde sono state rimosse a fine
lavoro (M99); la ricetta di riproduzione è in §1.1.

---

### M01 — La mappa del paese posseduto, senza fronti *(frontend)* — **la fase che sblocca l'autore**

**Perché.** È il criterio minimo dell'autore: «*apri una partita reale, chiedi
"Mostrami la mappa del nostro paese", e compare una card basata sul territorio
effettivamente posseduto, senza guerra né fronte*».

**Cosa.** Il territorio posseduto diventa l'**ultima risorsa del resolver**
`resolveGovernmentVisuals`: se il messaggio è una richiesta esplicita **e** non
porta alcuna chiave situazionale (`keys` vuote), e nessun ramo precedente ha
prodotto una card, si mostra il territorio posseduto — dal read model canonico.

**Dove (solo `governmentVisual.ts`, nessun cambio ai chiamanti).**
1. Nuovo helper `playerOwnedRegionIds(snapshot)`: le regioni con
   `owner === playerPolityId`, dall'indice canonico (`regionsById`).
2. In `resolveGovernmentVisuals`, **dopo** il ramo diplomazia e **dopo** un
   eventuale `cards.length` di fronti: il ramo posseduto chiude la funzione.
3. Regola di precedenza: fronti → diplomazia → territorio posseduto. Il posseduto
   non può preemptare un riferimento verificato.

**Attenzione — perché NON nei chiamanti.** La prima stesura passava il posseduto
come `contextRegionIds` nei chiamanti: costruiva la card **prima** del ramo
diplomatico e lo preemptava. Il resolver è l'unico posto giusto.

**Attenzione — la trappola del tetto.** Il paese di `KOR` è **61 regioni**, sopra
le 20. Senza M02, la card verrebbe mostrata in forma testuale (C-2) e **sparita
al reload** (C-3). M01 e M02 sono una coppia: stessa PR.

**Prova (`M-I1`, `M-I3`, `M-I6`).** Con `fronts: []`, `militaryAvailable: false`:
una richiesta esplicita senza chiavi produce **una** card con le regioni
possedute; una menzione non esplicita produce **zero**; una relazione ostile
verificata produce la card **diplomatica**, non il posseduto.

---

### M02 — Un tetto che degrada invece di distruggere *(frontend)* — **accorpata con M01**

**Perché.** §1.4 C: tre facce di un solo tetto, una delle quali è il vuoto.

**Cosa — due facce corrette, una lasciata.**
1. **C-2 (anteprima, `governmentVisual.ts:181`).** Il limite del `preview = null`
   passa da `MAX_MAP_REGION_IDS` (20) a `MAX_MAP_PREVIEW_REGIONS` (800): se la
   geometria è disegnabile (misurato: lo è), si disegna; oltre il tetto si
   ricade sul riepilogo testuale, che è già reso.
2. **C-3 (reload, `governmentVisualRequest.ts:41`).** `readGovernmentVisualMetadata`
   non **scarta** più la `visualRequest` per «troppi id»: se gli id superano il
   tetto di resa, si mantiene la richiesta e si omettono solo gli id.
3. **C-1 lasciata invariata, per scelta.** `MAX_MAP_REGION_IDS = 20` continua a
   proteggere il **payload di una direttiva del modello**: 21 id → troncati a 20
   **e** `invalidRegionIds: true` → `governmentVisual.ts` scarta. È un
   **contratto difeso** (`presentation.test.ts:79`), fail-closed voluto. La
   correzione del caso «paese ampio» non passa di qui: passa da M01 (il modello
   non indica i territori).

`GovernmentVisualCard.tsx:20-30`: il fallback testuale resta per la geometria
**assente**, non per «troppe regioni».

**Attenzione — non è «alzare una costante».** Va deciso cosa protegge il tetto:
il carico di rendering (migliaia di path SVG) e l'integrità di una direttiva del
modello sono due problemi diversi, oggi con lo stesso numero. Se il disegno di
molte regioni pesa, la mitigazione è **semplificare la geometria**, non nascondere
la mappa.

**Prova (`M-I4`).** Con 61 regioni vere: card viva con geometria non vuota (o
riepilogo se la geometria manca — mai vuota), e **la stessa card sopravvive al
ricaricamento**. Test-contratto che le tre soglie non reintroducano un vuoto.

---

### M03 — Il degrado è dichiarato *(frontend)* — **diagnostica**

**Cosa.** La ragione per cui una scheda non compare, o compare ridotta, diventa
un esito **tipizzato** e, in modalità diagnostica, **visibile**: snapshot
indisponibile, nessun riferimento geografico, id non validi, geometria non
disponibile, anteprima ridotta.

**Dove.** `governmentVisual.ts` restituisce oggi `[]` in **sei** punti (`:80`,
`:87`, `:88`, `:91`, `:113`, `:115`) e `null` altrove. Serve una ragione esplicita
sul risultato vuoto, consumata da `GovernmentMessageVisuals.tsx:16-17` (che oggi
mostra sempre lo stesso `NO_VERIFIED_GEOGRAPHY`).

**Attenzione.** Diagnostica **temporanea e opt-in** (un flag), non un messaggio
permanente all'utente: serve a dire *dove* si interrompe il flusso.

**Prova (`M-I5`).** Una richiesta uccisa da `invalidRegionIds` riporta la ragione
«id fuori tetto», distinta da «nessun riferimento geografico».

---

### M04 — Lo scarto del caricamento militare *(frontend)* — **DECLASSATA, bassa priorità**

**Perché declassata.** §1.5: la mia ipotesi che `militaryAvailable === false`
bloccasse tutte le schede è **smentita** dalla misura. Resta **un** caso vero e
stretto: una questione di guerra (chiave `conflict:…`) durante il caricamento
della snapshot militare, che si auto-ripara appena la snapshot arriva.

**Cosa (se l'autore lo vuole).** Nel ramo fronti, `militaryAvailable === false`
non deve far cadere **anche** una richiesta esplicita con `regionIds` canonici:
il `return []` diventa «salta il ramo fronti», non «arrenditi». Il ramo fronti
resta **fail-closed** per le card **che sono di un fronte** (una battaglia non va
mostrata con dati non allineati); la deroga vale solo per le card senza `source`.

**Prova (`M-I6`).** Fronte non allineato ⇒ la card del fronte non compare; la
card «territorio posseduto» sì. Le direttive vecchie restano invalide come oggi.

**Nota onesta.** È un caso transitorio. La PR si giustifica solo se l'autore ha
visto il ritardo in una partita con una guerra in corso; altrimenti si chiude
qui, dichiarata e non eseguita.

---

### M05 — Il Consulente impara a chiedere la mappa *(backend — solo testo)* — **ESEGUITA**

**Cosa.** Una direttiva mappa **senza** gli id, nel prompt del Consulente: il
modello dichiara l'**intento**, gli id li risolve il read model (M01).

> **Eseguita (2026-10-09), dopo un errore reale, dichiarato.** La prima stesura
> aveva messo il testo in `buildAdvisorPrompt` (`prompts/advisor.ts`). La verifica
> indipendente ha mostrato che **quella funzione non ha chiamanti di produzione**:
> il percorso reale è `PromptBuilder.getAdvisor` →
> `buildRealityAdvisorPrompt` (`core/government/RealityAdvisor.ts`). Quindi la
> prima stesura era **inerte** — verde su codice morto, e in partita il Consulente
> non riceveva nulla. Il prompt è stato spostato dove la produzione lo legge:
> nuova costante `ADVISOR_MAP_PROTOCOL` (`core/government/CouncilIssue.ts`),
> montata in `buildRealityAdvisorPrompt` solo per `audience === 'advisor'`
> (il ministro non ha il blocco). Il testo inerte è stato **rimosso** da
> `advisor.ts`. Il test ora punta al **prompt reale**.
> **Rifinitura di M01 scoperta qui:** la guardia del territorio posseduto non è
> più `keys.size === 0` ma «nessuna chiave **situazionale**» (`conflict:*`,
> `hostile-relations*`): in produzione l'Advisor eredita le chiavi del messaggio
> precedente, e la vecchia guardia perdeva la richiesta se il turno parlava di
> bilancio.
> **Lezione:** un test verde su una funzione senza chiamanti non prova il
> comportamento. Prima di scrivere un prompt, verifica **chi lo chiama**.

**Attenzione.** Il guardrail resta: la direttiva è una **richiesta**, non prova
che la mappa sia visibile — la frase «la mappa conferma» è vietata
(`safeGovernmentVisualText`, `governmentVisualRequest.ts:48`), e il prompt lo
ripete al modello.

---

### M06 — Il test che avrebbe dovuto esserci *(e2e o sonda)*

**Cosa.** Uno scenario che riproduce **esattamente** il caso dell'autore: partita
senza fronti, nessuna direttiva mappa, nessuna relazione ostile, Presidente
chiede il proprio paese, **una** card con le regioni possedute e **una** geometria
non vuota.

**Attenzione.** Il banco e2e corrente (`openAdvisor`) inietta un fronte o una
relazione ostile: **non può vedere il difetto.** Serve un banco «nudo».

**Prova.** Il test fallisce sul codice di `main` e passa dopo M01–M02. È la
difesa contro la regressione che ha prodotto tutto questo (§1.7).

---

### M99 — Pulizia *(nessun codice di prodotto)*

Rimuovere `ms_measure*.test.ts` e `ms_regions.json`; o promuoverne i casi in
M02/M06. Aggiornare la memoria del progetto.

---

## 4. Ordine, confini, e cosa NON fare

**Fatto.** M01+M02 (la coppia che sblocca) e **M05** (il Consulente impara a
chiedere la mappa).
**Resta.** M06 (il banco e2e «nudo», difesa contro la regressione di §1.7) → M03
(diagnostica del degrado) → M04 (declassata, solo se una guerra in corso ha
mostrato il ritardo) → M99 (pulizia, già fatta: le sonde sono rimosse).

**Il criterio minimo dell'autore, tradotto in prova:** *partita reale, `fronts:
[]`, `militaryAvailable: false`, nessuna direttiva, nessuna relazione ostile,
«Mostrami la mappa del nostro paese» → una card basata sul territorio posseduto,
con geometria.* M01+M02 lo soddisfano.

**Cosa NON fare (per non ripetere il difetto di §1.7):**
- non aggiungere fronti o relazioni ostili al mock per far passare il test;
- non far indovinare i `regionIds` al modello (violerebbe M-I1 e la regola C01);
- non «alzare il limite a 200» senza decidere cosa protegge;
- non dichiarare risolto nulla che non sia stato **misurato** con `fronts: []`.

**Decisioni che restano dell'autore.**
1. Per il paese posseduto ampio: **disegnare tutte le regioni** o **disegnare le
   più significative** (capitale, regioni della questione, confine) con il
   riepilogo sotto? La sonda dice che disegnarle tutte è possibile; la scelta è
   di prodotto.
2. Se il disegno di molte regioni pesasse, accettare una **semplificazione
   geometrica** delle regioni minori.
3. Il degrado di M03: diagnostica **solo in sviluppo** o **visibile in partita**
   (un rigo discreto sotto la card)?
4. M04: vale la pena per un caso transitorio, o si chiude dichiarato?

---

## 5. Cosa la misura ha cambiato rispetto all'analisi iniziale

1. **Smentisce la mia ipotesi principale.** Credevo che `militaryAvailable ===
   false` bloccasse tutte le schede. La sonda H la contraddice: con `fronts: []`
   una richiesta esplicita passa. La fase «deroga dai fronti» è declassata (M04).
2. **Il tetto uccide, non riduce.** Tre facce misurate: la direttiva del modello
   (>20) è troncata **e** marcata invalida → `[]`; la richiesta canonica viva
   mostra testo; la **stessa richiesta sparisce al reload**. Due strati dello
   stesso limite che si contraddicono.
3. **La geometria della Corea si disegna per intero** (61/61, span 8,84°). Non è
   un problema di coordinate: era la mia seconda ipotesi, smentita.
4. **Il prompt del Consulente non insegna affatto** la direttiva mappa
   (`grep tavola → 0`): il modello non può emetterla anche volendo.
5. **I test #247/#248 sono verdi perché i mock hanno già fronte attivo o
   relazione ostile singola** — le condizioni che in partita mancano.

---

## 6. Verifica indipendente, e cosa ha corretto

Prima di consegnare, un agente **indipendente** ha avuto il compito esplicito di
**smontare** questo piano — non di confermarlo — ri-eseguendo ogni sonda e
ri-leggendo ogni riga citata.

**Esito: le 10 affermazioni numeriche e di codice si riproducono tutte.** Le
sonde hanno dato gli stessi output (`4 passed`, `10 tests passed`); ogni riga
citata è stata confermata. La tesi centrale regge: il tetto delle 20 è a tre
facce, la geometria della Corea si disegna per intero, il prompt del Consulente
non insegna la direttiva mappa, e la mia ipotesi su `militaryAvailable` è
smentita.

**Sei imprecisioni trovate, tutte corrette in §1–§3.** Nessuna cambia un numero:

1. i `return []` in `governmentVisual.ts` sono **sei**, non cinque (mancava `:115`);
2. la riga `:93` **non è** un `return []` ma una guardia — descrizione corretta;
3. `contextRegionIds` in `councilRoom.ts` è alla riga **282**, non 280;
4. sopra le 20 regioni la card mostra «61 territori canonici», **non** l'elenco dei nomi;
5. l'inventario dei test era incompleto: mancava `councilVisuals.test.tsx`;
6. le sonde leggono un **export statico** (`ms_regions.json`), non il DB a runtime.

**Non verificabile in questa sessione:** il comportamento **e2e** (Playwright non
eseguito; §1.7 è per lettura) e la stabilità dello stato della partita al primo
turno (il DB è allo stato attuale, `world_revision` 4).

**Lezione annotata.** La prima stesura di questo piano conteneva una **mia**
ipotesi (`militaryAvailable` blocca tutto) che la misura ha smentito, e l'avevo
scritta con la stessa sicurezza delle misure. È esattamente il tipo di errore che
la verifica indipendente esiste per trovare: un'inferenza travestita da misura.

---

## 7. Verifica indipendente della correzione

Dopo M01+M02, un secondo agente indipendente ha avuto il compito di **rompere** la
correzione: cercare regressioni, contratti violati e falsi verdi.

**Ha confermato** il criterio minimo sulle regioni reali (61 id, preview a 61 path,
nessun «Geometria non disponibile»), i contratti fail-closed intatti, il confine
M01 nel Consiglio, la provenienza canonica degli id (un `playerPolityId` ostile →
`[]`), il costo di resa (800 regioni → ~63 ms) e la genuinità dei test nuovi.

**Ha trovato un difetto reale, MEDIO, che avevo introdotto.** La prima stesura —
territorio posseduto come `contextRegionIds` **nei chiamanti** — costruiva la card
prima del ramo diplomatico e lo **preemptava**: in produzione (Consiglio e
Advisor) una relazione ostile verificata mostrava il **paese** invece della
relazione, e «due relazioni ostili → nessuna card» diventava «→ paese posseduto».
Il banco di test non lo vedeva perché `councilVisuals.test.tsx` non passava mai lo
snapshot. **Corretto** spostando il posseduto nell'ultimo ramo del **resolver**;
`councilRoom`, `AdvisorChat` e `GovernmentOffice` sono tornati intatti. Difeso da
`governmentVisualOwnership.test.tsx` («la mappa posseduta non preempta i
riferimenti verificati», più il caso a due ostili).

**Un difetto BASSO, dichiarato e non corretto.** `isGovernmentMapRequest`
riconosce anche il testo **negato** («Non voglio vedere la mappa»): con M01 quella
frase mostra ora il paese. È una debolezza **pre-esistente** del regex, allargata
dalla correzione. Va chiusa in una fase separata (una guardia di negazione), non
qui: tocca il riconoscimento dell'intento, non la mappa.

**Lezione.** La correzione «giusta» che avevo in mente al primo colpo (nei
chiamanti) era **sbagliata**, e nessun test esistente la copriva: il banco
diplomatico non passava lo snapshot. Un secondo giro ostile l'ha presa. È la
stessa disciplina di [[verifica-indipendente]].

---

## 8. Verifica indipendente di M05, e il suo errore più grave

Dopo M05, un terzo agente indipendente ha avuto il compito di **falsificare** il
prompt e la guardia di M01.

**Ha confermato** la guardia B (nessun falso positivo, casi degeneri
`conflict:unknown` e `hostile-relations:` trattati come situazionali, confine
rispettato) e il parser frontend (il blocco senza `regionIds` produce una
direttiva valida).

**Ha trovato che M05 era INERTE.** Il testo era stato scritto in
`buildAdvisorPrompt` (`prompts/advisor.ts`), che **non ha chiamanti di
produzione**: il percorso reale è `PromptBuilder.getAdvisor` →
`buildRealityAdvisorPrompt`. Il test era verde su **codice morto**. In partita il
Consulente non riceveva la sezione Mappa. **Corretto:** nuova costante
`ADVISOR_MAP_PROTOCOL`, montata nel prompt reale per il solo Consulente; il testo
inerte rimosso; il test ri-puntato a `buildRealityAdvisorPrompt`.

**Conseguenza ancora aperta, dichiarata.** Lo stesso prompt morto insegna le
figure `[[chart: …]]` (C01). Se anche `parsePresentation` non gestisce quei
blocchi nel percorso reale, **C01 è inerte allo stesso modo** e va verificata a
parte. Non l'ho misurata qui: è una indagine separata.

**Lezione.** `grep dei chiamanti` prima di scrivere un prompt. Un test verde su
una funzione che la produzione non chiama non prova il comportamento — è la
versione "codice" della lezione già imparata sui test-contratto (§6).
