# Piano — La scheda mappa: selezione giusta, e una mappa che racconta

> **Stato:** **MAP01–MAP11** (MAP10 chiusa senza codice, con la misura che lo
> giustifica). L'effetto misurato è nella §1.5 e nella §6. Fasi `MAP00–MAP11`.
> **Domanda dell'autore (2026-10-09):** «fare che la mappa generata dal
> Consulente e dal ministro sia più precisa e che possa raccontare di più».
> **Priorità dichiarata:** (1) *selezione più giusta* — le zone evidenziate siano
> quelle di cui si parla; (2) poi **nomi e legenda**, **colori da dati veri**,
> **annotazioni e segni**. La geometria non è in cima: la misura qui sotto dice
> perché.
> **Metodo:** tutto ciò che segue è **misurato** sul codice di `main` e sul
> database reale (`backend-nest/data/open-pax.db`, 2,35 GB, **230 partite con
> regioni**, **284 mondi** di cui 138 da 4475 province). Dove la misura
> contraddice un'ipotesi — anche mia — lo dico in chiaro.

> **Nota di correzione (verifica indipendente del 2026-10-09).** La prima stesura
> di questo piano conteneva quattro numeri sbagliati, trovati da una verifica
> avversariale e **corretti qui**: (1) le partite con regioni sono **230**, non
> 38 (38 era il limite della mia query); (2) le scale in px/° sotto erano
> calcolate **senza** il padding di 2° che il codice reale applica
> (`staticMapModel.ts:53`) — sono state rifatte con la formula vera; (3) le
> «224 politie» valgono **per un mondo da 4475 province**, non per tutto il DB
> (che ne ha 244 distinte); (4) i conteggi delle regioni minuscole dipendono dal
> criterio — qui è dichiarato una volta: *lato minore del riquadro proiettato
> < 4 px*.
> **Precedente:** `docs/PIANO_AFFIDABILITA_MAPPE_GOVERNO.md` (M01+M02 e M05
> eseguiti). Questo piano **non riapre** quelle fasi e non ne tocca i contratti:
> parte da dove quelle si sono fermate.

---

## 1. La misura

### 1.1 Che cosa contiene davvero una scheda mappa

La scheda è `GovernmentVisualCard` (`frontend/src/components/Game/GovernmentVisualCard.tsx`),
costruita da `governmentVisualModel` (`governmentVisual.ts:233`). Contiene, in
quest'ordine: **un `<svg>` di anteprima** (`:20-28`), **l'elenco dei nomi delle
regioni** (`:30`), **la legenda** (`:31-33`), **la descrizione** (`:34`) e il
bottone «Mostra sulla mappa principale» (`:35`).

Misurato su un caso reale (Giordania, partita `d4b0f95c679e`, 11 province):

| Elemento | Contenuto reale | Giudizio |
|---|---|---|
| Anteprima SVG | 11 province, buona scala (31,8 px/°) | **disegna bene** |
| Nomi sotto la mappa | «Irbid · Sakib · Al Salt · …» — 11 nomi, una riga | ridondante e illeggibile |
| Etichette **dentro** l'SVG | **nessuna** (compaiono solo con ≤ 4 regioni, `:26`) | mancano proprio dove servirebbero |
| Legenda | **una voce sola**, `#007A3D` → «Giordania» | tautologica |
| Colore | il colore del **proprietario**, identico per tutte le province | «pittura piatta» |

### 1.2 I tre difetti, misurati

**D-1 — La selezione è un insieme, non una graduatoria.**
`resolveGovernmentVisuals` (`governmentVisual.ts:94`) produce **un solo** insieme
di id per scheda. Non esiste il concetto di «zona principale» e «contesto»: o
tutte le regioni sono evidenziate allo stesso modo, o nessuna. Le tre strade —
territorio posseduto (`playerOwnedRegionIds`, `:77`), territori del fronte
(`:118-124`), territori della relazione ostile (`:139-148`) — sono **mutuamente
esclusive** e scelte da un ordine di precedenza cablato. Misurato: con una
relazione ostile verificata la scheda mostrata è la coppia `{giocatore ∪ ostile}`
(2 colori, `:145`); il resto del paese — le province di cui la conversazione
parla — non entra mai.

**D-2 — Gli id li possiede solo il ministro, e solo in un caso.**
`MINISTER_DIALOGUE_PROTOCOL` (`MinisterDialogueRules.ts:55-56`) insegna
`regionIds`: *«se riguarda zone precise, indica con `regionIds` gli ID canonici
disponibili nel contesto»*. Ma il contesto del ministro **non contiene alcun
elenco di id di regione**: il blocco *Stato strategico*
(`prompt-builder.ts:825-941`) porta i **nomi** delle province confinanti
(`:935`), e il *fact registry* che il ministro riceve (`RealityAdvisor.ts:443`)
non porta `geography`. Il Consulente, dal canto suo, è **vietato** dallo scrivere
id (`ADVISOR_MAP_PROTOCOL`, `CouncilIssue.ts:266`, che dice «NON scrivere MAI gli
id»). Esito misurato: **l'intento preciso è grammaticalmente disponibile solo a
una scheda su dieci** — il ministro che parla di un progetto in una zona — e
anche lì è una scommessa. Tutto il resto ricade su «tutto il paese».

**D-3 — `regionIds` può solo restringere, mai ordinare.**
`safeRegionId` + `.slice(0, MAX_MAP_REGION_IDS)` (`presentation.ts:264-270`).
Il campo è un elenco di id, senza peso, senza ruolo, senza relazione. Non c'è
modo, oggi, di dire *«questa è la zona principale, queste il contorno»*.

### 1.3 Che cosa si può raccontare, e da dove

I dati **esistono già** e sono canonici; il problema è che la scheda non li usa.

*Per regione* (tabella `world_regions`, `database.ts:85`, e `game_regions`,
`:1086`, riscritte a ogni turno da `game-session.ts:3045`): `population`, `gdp`,
`military_power`, `objects` (2872 oggetti **nel mondo**, di cui **211 capitali**
e 2661 città, `type/lat/lng/name`; nella partita viva se ne aggiungono 4
fabbriche e 1 porto, per 2877), `borders` (**adiacenza reale**, misurata: 4050
regioni con adiacenze, 425 senza — sono le città-stato). Tipo SQL `real` su
tutte e tre le partite esaminate, nessuna stringa nascosta.

*Nel GeoJSON di ogni provincia* (che la scheda **già carica** per disegnare):
`name`, `country`, `pax_region_id`, `surface_type` (`Land` 2737, `Coastal` 1731,
`Strait` 3, `Ocean` 4), `centroid` (presente su 4475/4475), `is_capital` (201),
`adjacencies`, `tags` (12 tag reali nel preset: *Cartel-Controlled Territory*,
*Weak State Presence*, *Hungarian majority*…). **Nessuno di questi campi arriva
oggi alla scheda**: `parseRegionGeometry` (`mapModel.ts:134`) scarta le
`properties`, e `VerifiedMapRegion` (`VerifiedWorldSnapshot.ts:38`) non le porta.

*Il codice per colorare da un dato esiste già ed è puro.*
`thematicMapModel.ts` è privo di React e di WebGL:

| funzione | riga | uso |
|---|---|---|
| `economyBucketEdges(values, n)` | `:105` | soglie a **quantili** |
| `economyColorForBucket(bucket)` | `:124` | valore → colore (`ECONOMY_COLORS`, `:63`) |
| `buildEconomyMapModel(regions)` | `:145` | modello per regione |
| `economyLegendRanges(model)` | `:164` | intervalli per una legenda vera |
| `thematicUnavailableMessage(...)` | `:446` | quando il dato manca, **lo dice** |

La mappa grande lo usa già per la coropleta del PIL (`MapboxMapView.tsx:927`) e
la sua legenda si intitola «**PIL territoriale**» (`MapLegend.tsx:96`). La scheda
del governo, oggi, **non lo usa affatto**.

### 1.4 Quello che NON è un difetto (misurato, per non rifare il lavoro)

* **La geometria si disegna, e anche bene.** La mia ipotesi di partenza — che
  le province siano troppo piccole per essere disegnate — è **falsa** sulla
  maggior parte dei casi. Misurato con la proiezione **vera** della scheda
  (`buildStaticMap`, 640×260, `staticMapModel.ts:97-111`, che include il padding
  di 2° di `:53`), con politie reali del DB; «minuscola» = lato minore del
  riquadro proiettato **< 4 px**:

  | politia | province | span lng | span lat | scala | minuscole |
  |---|---|---|---|---|---|
  | JOR | 11 | 8,34° | 8,19° | 31,8 px/° | **0 / 11** |
  | NPL | 7 | 8,1° | 4,1° | 32,3 px/° | 0 / 7 |
  | BIH | 47 | 3,9° | 2,7° | 38,9 px/° | 0 / 47 |
  | DEU | 181 | 13,1° | 11,6° | 22,4 px/° | 3 / 181 |
  | IND | 40 | 32,9° | 32,8° | 7,9 px/° | 0 / 40 |
  | KOR | 61 | 8,84° | 9,42° | 27,6 px/° | **5 / 61** |
  | CAN | 91 | 92,4° | 45,8° | 5,7 px/° | **45 / 91** |
  | USA | 256 | 115,2° | 56,4° | 4,6 px/° | 54 / 256 |
  | FRA | 103 | 122,7° | 76,5° | 3,4 px/° | 94 / 103 |

  Le piccole non sono un difetto della **scheda**: sono un difetto di
  *inquadratura*, e l'inquadratura si decide in `focusViewBox`
  (`regionFocus.ts:83`) — che la scheda **non** usa (usa `viewBoxFor`, `:66`).
* **Il tetto delle 20 regioni** (`MAX_MAP_REGION_IDS`) resta un contratto
  difeso (payload non fidato del modello): **non si tocca**. Il tetto di *resa*
  è 800 regioni e in tutti i casi misurati non è mai raggiunto.
* **`region.metadata` e `region.status` sono sempre `{}` / `'active'`** — nessun
  writer popola le colonne (`world.repository.ts:183`). Non sono dati
  disponibili: non si possono usare, e questo piano non li usa.
* **Il testo della scheda non è mai illeggibile**: il riquadro ha
  `overflow-wrap: anywhere` (`governmentVisual.css`). La riga dei nomi è
  lunga, non rotta.
* **`focusViewBox` esiste già e qualcuno lo usa**: `SeatCanvas.tsx:48` (la mappa
  della Tavola), `StaticGeoMap.tsx:43`, `MapView.tsx:65`. La scheda del governo
  è l'unica a non usarlo, e va allineata **senza** duplicare la logica.

### 1.5 L'effetto di MAP01+MAP02, misurato su una partita reale

Sonda provvisoria sulle **11 province della Giordania** della partita
`d4b0f95c679e`, risposta: *«la crescita di Amman e Al Karak merita attenzione»*.

| | prima | dopo |
|---|---|---|
| zone | — (le 11 tutte uguali) | primarie: **Amman, Al Karak** · adiacenti: Maan, Zarqa, Al Salt, Madaba, At Tafila · contesto: Irbid, Sakib, Za tary, Aqaba |
| `viewBox` | `250.43 52.86 139.14 154.28` (tutto il paese) | `267.23 100.26 60.42 49.12` — **2,5× più stretto**, sul soggetto |
| nomi sotto la mappa | «Irbid · Sakib · Al Salt · Maan · Aqaba · Zarqa · Madaba · Al Karak · At Tafila · Amman · Za tary» | «**In evidenza: Amman · Al Karak** — sulle 11 del contesto» |
| etichette **dentro** l'SVG | 0 | **2** (le primarie) |
| legenda | 1 voce («Giordania») | invariata: 1 voce (MAP04 non è ancora fatta) |

Le guardie, verificate sui dati reali: un nome che non è una provincia del
motore **non** produce nulla; una parola comune non produce una zona sbagliata
(«Maan» sì, «man» no); un vicino che non è nella scheda **non** entra; senza
nomi la scheda è **identica** a prima (`zones: undefined`).

---

## 6. Cosa è stato eseguito, fase per fase

| fase | cosa è entrato | dove |
|---|---|---|
| **MAP01** | risolutore di rilevanza: nomi canonici nel testo, 4 guardie | `regionRelevance.ts` (191 righe), 18 test |
| **MAP02** | ruoli `primary/context/adjacent`, inquadratura sulle primarie, `data-role` | `governmentVisual.ts`, `GovernmentVisualCard.tsx`, 8 test |
| **MAP03** | de-collisione delle etichette (scatole, scorrimento, eliminazione), corpo adattivo, etichette **dentro** l'SVG, pallino della capitale | `regionLabels.ts` (113 righe), 7 test; `GovernmentVisualCard.tsx` |
| **MAP04** | metrica `pil`/`popolazione`/`difesa` dal testo o dalla direttiva, colori e legenda a intervalli **riusando** `thematicMapModel` | `regionMetrics.ts` (140 righe), 11 test |
| **MAP05** | campo opzionale `metric` nel blocco `tavola`; il Consulente e il ministro dichiarano l'**intento**, e al ministro si dice di **non indovinare** gli id | `presentation.ts`, `CouncilIssue.ts`, `MinisterDialogueRules.ts`, 3 test backend |
| **MAP06** | frontiera dell'insieme dai confini canonici (`borderRegionIds`), quota delle zone in evidenza sulla metrica | `regionRelevance.ts`, `governmentVisual.ts`, test in `regionMapDetail.test.tsx` |
| **MAP07** | banco nudo coi rapporti di scala reali (nessun fronte iniettato) | `regionMapBench.test.tsx`, 6 test |
| **MAP08** | l'insieme oltre l'antimeridiano non uccide più l'anteprima: il riquadro segue le primarie se sono misurabili e non attraversano il fuso | `governmentVisual.ts`, `previewFor`; 3 test in `regionMapBench.test.tsx` |
| **MAP09** | segni sul territorio: capitali, porti e stabilimenti sempre; città solo nelle zone in evidenza; proiettati con la stessa proiezione dei poligoni. **Corretto** il pallino che usava il centroide invece delle coordinate reali | `regionMarkers.ts` (118 righe), 9 test |
| **MAP10** | **chiusa senza codice**: i giacimenti non sono per regione, e la mappa grande li ha già come marker ancorati alla provincia | §2, MAP10 |
| **MAP11** | il clic apre il layer della **stessa** lettura: `pil` → `economy`; popolazione e difesa restano politiche; il pulsante lo dichiara | `regionMetrics.ts`, `governmentVisual.ts`, `GovernmentVisualCard.tsx`, `GameScreen.tsx`; 4 test |

**Verifica.** **La suite completa del frontend passa: 189 file, 1639 test, 0
fallimenti** (eseguita in quattro blocchi, perché questa sandbox sospende i
processi in background fra una chiamata e l'altra: 39 file fuori da `Game` + 150
di `Game`). 171 test verdi sui 15 file del perimetro mappa; 12 backend sul prompt
reale; `tsc` pulito (frontend e backend).

**Resta aperto, e non è una svista.** Il rendering **in pagina** non è mai stato
visto: tutte le misure di questo lavoro girano in Node (`renderToStaticMarkup`).
Un banco e2e nel browser richiede un server su `localhost` raggiungibile dal
pannello del browser, che questa sandbox non offre (i server avviati qui non sono
sulla stessa macchina del browser). Il markup è stato però generato dal
componente **reale** sui dati di partita, e impaginato col CSS della scheda
(`outputs/scheda-mappa.html`): è una verifica visiva del markup, non del layout
in pagina.

### 6.1 La verifica avversariale ha trovato due difetti reali (corretti)

Un secondo agente è stato incaricato di **smontare** le affermazioni, non di
confermarle. Ha trovato due difetti **nel codice**, invisibili a una suite verde:

1. **`placeLabels` poteva uscire dalla zona.** Lo scorrimento era limitato
   dall'altezza della zona divisa per il passo, non dalla **scatola**
   dell'etichetta: in una provincia bassa (60×30) la seconda etichetta finiva
   ~8 unità sotto il bordo, cioè sopra la provincia vicina. Ora il limite è la
   scatola, e due nuovi test lo catturano.
2. **La guardia dell'antimeridiano confrontava pixel con gradi.** In
   `previewFor` il riquadro proiettato (0..640 px) era confrontato con la soglia
   di `184` **gradi**: una provincia larga 600 unità sulla tela legacy veniva
   scartata pur non attraversando nessun fuso. Ora la soglia si applica **solo**
   ai gradi del GeoJSON, prima della proiezione, e **solo** alle regioni in
   evidenza; nel ramo legacy non esiste longitudine, e non si finge.

Un terzo difetto, minore ma vero: **le radici dei pattern delle metriche erano
inerti.** `\b(?:economi|produzion|popolazion)\b` non matcha mai, perché dopo la
radice c'è una lettera — «economia», «produzione», «popolazioni» non
selezionavano nulla. Corretto togliendo il `\b` finale (il confine resta
all'inizio), con un test dedicato.

La verifica ha anche segnalato un **falso verde** nel banco MAP07:
`expect(width).toBeGreaterThan(0)` passa per qualunque anteprima non nulla. È
stato sostituito con un'asserzione che misura l'inquadratura vera.

---

## 2. Le fasi

Ogni fase è una PR piccola, con i suoi test. L'ordine è quello delle dipendenze:
**MAP01 e MAP02 sono la risposta diretta alla domanda dell'autore**; il resto è
ciò che le rende vere anche per il Consulente e per i mondi grandi.

### MAP01 — La mappa chiesta dalla conversazione · **FATTA**

*Perimetro:* frontend, `governmentVisual.ts` + un nuovo modulo puro
`regionRelevance.ts`. **Nessuna firma pubblica cambiata.**

Il difetto D-2 misurato: la scheda non sa che cosa la conversazione stava
guardando. Il testo del messaggio però è già lì, e gli id sono già risolti dal
resolver. Si aggiunge un **risolutore di rilevanza** che, dato l'insieme
canonico e il testo, produce zone con un **ruolo**:

```
primarie   — il soggetto: le province nominate nel testo, o l'insieme
             verificato (fronte / coppia diplomatica) se esiste;
contesto   — l'insieme di riferimento neutro (il territorio del giocatore);
adiacenti  — i vicini delle primarie, da `borders` (dato canonico);
```

Il join **non** è «somiglianza di nomi» nel senso vietato: è un confronto
*esatto e normalizzato* fra il testo del Presidente/ministro e i nomi canonici
delle regioni **già presenti nel read model**, con tre guardie: (a) un nome
compare solo se è presente come sottostringa delimitata da confini di parola;
(b) servono **≥ 4 caratteri** e nessuna collisione con un altro nome; (c) se il
nome è ambiguo fra due regioni, **si scarta** (fail-closed). Il risultato è una
lista di id con ruolo — **mai inventata**, sempre filtrata da
`regionIdsForFocus` (`mapFocus.ts:8`, all-or-nothing).

*Invariante difesa da test:* un nome citato **deve** esistere fra le regioni
canoniche; un nome ambiguo non produce nessuna zona; l'insieme finale rispetta
il tetto di resa; `regionIds` del modello continua a passare prima.

### MAP02 — I ruoli delle zone nel modello e nel disegno · **FATTA**

*Perimetro:* frontend, `governmentVisual.ts`, `GovernmentVisualCard.tsx`,
`governmentVisual.css`.

`MapFocusVisual` guadagna un campo opzionale `zones: { primary: string[];
context: string[]; adjacent: string[] }` — **derivato dal resolver**, mai dal
modello. L'anteprima disegna: primarie a piena opacità colorata, contesto
attenuato in tinta neutra, adiacenti in contorno sottile. La card dichiara il
ruolo in una riga sola («In evidenza: Amman · Al Karak — sulle 11 del contesto»),
e le etichette dentro l'SVG seguono le primarie invece del vecchio taglio
`paths.length <= 4`. L'inquadratura si fa in `previewFor` con la **convenzione
esistente** di `focusViewBox` (`regionFocus.ts:83`): si contiene il soggetto, e
il resto resta disegnato intorno per **collocarlo**, con lo stesso margine
dell'8%.

*Invariante:* senza primarie la scheda torna **esattamente** al comportamento di
oggi (`zones: undefined`); le zone non fanno mai crescere l'insieme canonico;
l'inquadratura non può tagliare fuori una primaria. Difesa da 8 nuovi test in
`governmentVisualOwnership.test.tsx` e da 18 in `regionRelevance.test.ts`.

### MAP03 — Nomi e legenda veri dentro l'anteprima

*Perimetro:* frontend, `GovernmentVisualCard.tsx` + `regionLabels.ts` (puro).

Tre cose, tutte misurate su materiale che il progetto ha già:
l'**inquadratura a due livelli** (paese + riquadro sulle primarie) con
l'etichetta disegnata **solo sulle primarie** (oggi il taglio è `paths.length <= 4`,
`:26`: si sostituisce con «etichetto le primarie, non più di N, e solo se
c'entrano nel riquadro»); la **de-collisione** delle etichette (scatole,
scorrimento, eliminazione, non sovrapposizione a caso); il **pallino della
capitale** dalla `centroid` del GeoJSON e da `is_capital` — che la scheda ha già
in memoria e butta via.

Si aggiunge il **titolo dentro l'SVG**: `region.name` per le primarie, la
nazione per il contesto. La riga dei nomi sotto la mappa (`:30`) si accorcia a
«le N province in evidenza» quando le etichette sono già dentro.

*Invariante:* nessun nome inventato; con una sola regione l'etichetta resta
centrata come oggi.

### MAP04 — Colori da dati veri

*Perimetro:* frontend, `governmentVisual.ts` + riuso di `thematicMapModel.ts`.

La scheda impara a colorare da un **dato canonico per regione**, con la stessa
disciplina della mappa grande — **il resolver sceglie la metrica, il modello
sceglie solo la domanda**. Tre metriche disponibili subito, con la loro fonte:

| metrica | fonte canonica | quando ha senso |
|---|---|---|
| `pil` | `region.gdp` | «dove investire», «cosa rende» |
| `popolazione` | `region.population` | «dove vive la gente» |
| `difesa` | `region.militaryPower` | «dove sono le forze» |

E la **legenda vera** dagli intervalli (`economyLegendRanges`), come fa la
mappa grande. Quando il dato manca, **si dichiara** (`THEMATIC_NO_DATA_COLOR` +
`thematicUnavailableMessage`), non si colora a caso.

La scelta della metrica la prende una funzione deterministica dal testo (come
`classifyGovernmentMapIntent`, `governmentVisualRequest.ts:38`), non il modello.

*Invariante:* nessun numero del modello entra in una scheda; con dati assenti la
scheda resta quella di oggi; il colore politico resta il default.

### MAP05 — Il Consulente e il ministro dichiarano l'intento, non gli id

*Perimetro:* backend, `CouncilIssue.ts` (`ADVISOR_MAP_PROTOCOL`, `ADVISOR_FIGURE_PROTOCOL`) +
`MinisterDialogueRules.ts`. **Nessuna nuova sintassi obbligatoria.**

Il Consulente non ha il vocabolario dell'intento preciso: gli intendimenti
`national` / `situation` / `generic` sono **dedotti dal testo del Presidente**
(`classifyGovernmentMapIntent`), non dichiarati dal modello. Si estende il
blocco `tavola` con un campo **opzionale e facoltativo** `intent`
(`national|situation|project|metric`), e si insegna al ministro che **non deve**
indovinare id quando non li ha: dichiara l'intento e, se vuole essere preciso,
**il nome** della zona di cui sta parlando (MAP01 lo risolve da sé).

Questo è il minimo indispensabile perché MAP01 non resti una capacità che solo
il Presidente attiva. Restano vietati gli id scritti a mano dal Consulente
(M-I1): l'invariante non cambia.

*Invariante:* un `intent` ignoto viene ignorato; il protocollo del ministro
continua a funzionare senza il campo nuovo.

### MAP06 — Annotazioni e segni sull'anteprima

*Perimetro:* frontend, `GovernmentVisualCard.tsx` + `regionAnnotations.ts` (puro).

Quello che una mappa deve poter dire e oggi non dice: **dove confina** una zona
evidenziata (dalla `borders` canonica), **quanti sono** (dalla somma del
posseduto), e — se il motore registra presidi nella regione (`military.locations`,
`VerifiedWorldSnapshot.ts:199`) — **dove sono le forze**. Tutto da **fatti già
verificati**, mai dal modello.

Si aggiungono: un contorno più marcato sulla **frontiera** fra primarie e
territorio non evidenziato; una scala dichiarata quando si colora da un dato;
la **quota** («3 delle 11 province, il 27% del PIL nazionale») calcolata dal
resolver. Una nota del modello (`note`, `presentation.ts:107`) resta l'unico
testo libero, com'è oggi.

*Invariante:* ogni numero mostrato ha una fonte canonica verificabile; la nota
resta ≤ 160 caratteri e senza markup.

### MAP07 — Un caso di prova che assomiglia a una partita vera

*Perimetro:* `e2e/tests/government-map-focus.spec.mjs` + test di unità.

Il banco attuale (§1.7 del piano precedente) **inietta sempre** un fronte o una
relazione ostile: presuppone le condizioni che in partita mancano, ed è per
questo che i difetti sono passati. Serve il banco **nudo**, con dati estratti
dal DB reale: le 11 province della Giordania e le 47 della Bosnia (che hanno
`gdp` distinti e una scala confortevole), il caso Corea (5 province minuscole su
61), il caso Canada (45 su 91) e **il caso antimeridiano**: la Russia ha **334
province con span 364°** e la Nuova Zelanda **355,4°**, cioè oltre il tetto di
184° che manda l'anteprima al riepilogo testuale (`governmentVisual.ts:218`).

*Invariante:* il banco nudo **deve** produrre una scheda con geometria; il banco
antimeridiano **deve** degradare al riepilogo dichiarato, non al vuoto.

### MAP10 — Giacimenti e siti produttivi · **CHIUSA SENZA CODICE**

*Esito:* **non si costruisce nulla**, e la ragione è una misura.

I giacimenti **non sono per regione**: `game_natural_resources` è una tabella
**per politia** (`game_id, polity_id, ledger`), e il ledger porta
`endowment`/`reserve`/`maxReserve`/`stockpile` per risorsa — mai una provincia.
Il dato per-regione esiste solo come `WorldResourceSitePayload` (`api.ts:259`),
che porta **solo `regionId`**, nessuna coordinata: un giacimento è un fatto di
**provincia**, non un luogo puntuale. Sulla mappa grande non è un pallino ma un
**marker ancorato alla regione** (`thematicAssetMarkers.ts:66`, layer `resources`
e `infrastructure`).

Metterlo anche sulla scheda sarebbe **duplicare** ciò che la mappa grande già
mostra, con un secondo disegno da tenere allineato — esattamente la seconda
cartografia che questo piano rifiuta. La scheda resta la mappa dei **luoghi**
(MAP09: capitali, porti, stabilimenti, città); i **giacimenti** vivono nel layer
Risorse, dove hanno già la loro legenda e il loro vocabolario.

### MAP11 — Il clic apre la stessa lettura · **FATTA**

*Perimetro:* frontend, `regionMetrics.ts` + `governmentVisual.ts` +
`GovernmentVisualCard.tsx` + `GameScreen.tsx`.

**Il difetto misurato.** `focusGovernmentMap` (`GameScreen.tsx:197`) forzava il
layer a `'political'` con il commento «Same ownership palette as the preview»:
vero finché la scheda era sempre politica, **falso** da MAP04 in poi. Una scheda
colorata dal **prodotto** si apriva sulla mappa con i **colori politici**: il
colore non significava più la stessa cosa attraverso il clic — lo stesso difetto
di prima, spostato di un passo.

Ora `mapLayerForVisual(card)` decide: `pil` → layer `economy`, che è dichiarato
«Dove è concentrato il PIL territoriale» — **la stessa lettura**. Popolazione e
difesa **non** forzano un layer: `military` mostra fronti, reparti e trasferimenti,
che è un'altra cosa, e aprire quella mappa direbbe qualcosa di diverso. Il
pulsante lo dichiara: «Apri la mappa del prodotto» invece di «Mostra sulla mappa
principale».

*Invariante:* il layer si sceglie dal **tipo di metrica**, mai dal testo né dal
modello; senza metrica il comportamento è quello di sempre.

### MAP08 — Il caso antimeridiano e i grandi imperi

*Perimetro:* frontend, `regionMarkers.ts` (nuovo, puro) + `governmentVisual.ts` +
`GovernmentVisualCard.tsx`.

Una mappa di sagome dice *dove*, non *cosa c'è*. La scheda ha già in memoria la
lista canonica degli oggetti di ogni provincia (`region.objects`, dal motore) e ne
usava **uno solo** — e pure nel posto sbagliato: il pallino della capitale era il
**centroide del poligono**, non le coordinate reali della capitale.

Ora i segni si proiettano con la `projectPoint` di `staticMapModel`: la **stessa**
proiezione dei poligoni, gli stessi limiti, la stessa tela. Capitali, porti e
stabilimenti si disegnano sempre (sono fatti unici); le **città** solo nelle zone
in evidenza e fino a un tetto di resa — 229 negli USA, 8 in Giordania.

*Invariante:* un oggetto **senza coordinate reali** non si disegna (i mondi legacy
portano `x`/`y` sulla tela 2000×1500: un altro sistema, sovrapporlo sarebbe una
bugia); un tipo di oggetto non previsto si ignora. Misurato sulla partita reale:
2 segni sulle province di Amman e Al Karak — la capitale alle sue coordinate vere
(`288,109`), non al centro del poligono.

### MAP08 — Il caso antimeridiano e i grandi imperi

*Perimetro:* frontend, `staticMapModel.ts` + `governmentVisual.ts`.

Misurato **su un mondo da 4475 province** (`75445832419d`): **2 politie su 224**
hanno un territorio che attraversa l'antimeridiano (Russia, 334 regioni, span
**364,0°** da −178,2° a +185,8°; Nuova Zelanda, 2 regioni, **355,4°**). Oggi la
scheda **rinuncia** (`> 184° → preview: null`). Le due strade oneste sono: (a)
disegnare il mondo intero con il **fuso corretto** (l'antimeridiano si disegna,
non si evita), (b) scegliere **il fuso che contiene le primarie** quando le
primarie esistono (MAP01/MAP02: la Russia che parla di una provincia a est non
ha bisogno di mostrare anche Kaliningrad). È una fase a sé perché tocca la
proiezione, e la proiezione è la parte più delicata del modulo.

*Invariante:* il disegno resta una proiezione sola, mai due fusi sovrapposti; se
la geometria non è disegnabile in modo onesto, si dichiara (comportamento di
oggi).

---

## 3. Ordine, costi e non-obiettivi

**Ordine di esecuzione proposto:** MAP01 → MAP02 (la risposta all'autore, PR
piccole e verificabili); MAP03 → MAP04 (il «raccontare di più», ognuna
indipendente); MAP07 (il banco che difende le quattro precedenti); MAP05
(backend, sblocca il Consulente); MAP06; MAP08 (la più delicata, per ultima).

**Costi misurati** (per non promettere prestazioni che non ci sono): il
disegno di 61 regioni con la proiezione della scheda è ~45 ms; 4475 regioni
sono ~750 ms e ~2,7 MB (già documentato in `presentation.ts:66-75`). Il tetto di
resa di 800 non viene mai toccato dalle fasi di questo piano, tranne MAP08.

**Non-obiettivi, dichiarati:**
- non si tocca `MAX_MAP_REGION_IDS = 20` (contratto fail-closed sul payload del
  modello);
- non si aggiungono campi a `world_regions` né si scrive sul motore: la scheda è
  un **read model**;
- non si dà al modello il potere di scrivere id, colori o numeri;
- non si sostituisce la mappa principale (WebGL): la scheda resta l'anteprima
  onesta, con il suo bottone «Mostra sulla mappa principale».

---

## 4. Ciò che la misura ha cambiato rispetto all'ipotesi di partenza

| # | Ipotesi iniziale | Esito | Prova |
|---|---|---|---|
| a | le province sono troppo piccole per essere disegnate | **FALSA** nella maggior parte dei casi | §1.4: 0 regioni minuscole su 5 politie su 9; le eccezioni sono gli imperi (USA, Canada, Francia, Olanda) |
| b | i giocatori hanno pochi territori, il problema non è la scala | **FALSA**: i mondi vanno da 1 a 4475 regioni, e gli imperi sono comuni | 284 mondi; USA 256 regioni, Russia 334, Francia 103, Canada 91 |
| c | al giocatore manca la conoscenza geografica per essere preciso | **NON È IL PROBLEMA**: gli id esatti sono nel database da sempre | `world_regions.id` = `pax-N`; 201 capitali con `is_capital` |
| d | la geometria della scheda è un problema di scala (640×260) | **FALSA**: la scala è buona; è l'**inquadratura** a mancare | `focusViewBox` esiste (`regionFocus.ts:83`), lo usano Tavola e mappe statiche, **non** la scheda del governo (`viewBoxFor`, `:66`) |
| e | il ministro può indicare le zone precise | **SOLO IN TEORIA**: il protocollo lo insegna, il contesto non porta gli id | `MinisterDialogueRules.ts:55` contro `RealityAdvisor.ts:443` |
| f | la scheda è un surrogato della figura «territorio» | **FALSA**: sono due cose diverse che non si vedono mai insieme | `territoryChart` (`advisorCharts.ts:77`) fa **barre** per PIL, non una mappa; la scheda è un `<svg>` di poligoni |

---

## 5. Riproduzione della misura

Le sonde sono state usate e poi rimosse, come da convenzione. Per rifare i
numeri:

1. **Le politie e le loro estensioni** (quante regioni hanno span > 184°, quante
   sotto i 4 px): si legge `game_regions` unito a `world_regions` dal DB
   `backend-nest/data/open-pax.db`, si proietta con la formula di
   `staticMapModel.ts:97-111` (equirettangolare, correzione `cos(midLat)`,
   `PAD = 2°`, canvas 640×260).
2. **I dati per regione**: `select typeof(population), typeof(gdp),
   typeof(military_power)` su `game_regions` — tutte `real` sulle partite
   esaminate.
3. **Le proprietà geografiche**: si contano su
   `backend-nest/data/presets/pax_modern_provinces/map.geojson` (4475 feature,
   7,36 MB).
4. **La scheda com'è oggi**: si monta `governmentVisualModel` su un
   `buildMapContextIndex` costruito dalle regioni della partita, con
   `units: []`, `fronts: []`.

Vedi [[mappe-governo]] (M01+M02, M05 e la lezione sul prompt morto),
[[consulente-grafici]] (C01: il modello sceglie *cosa* mostrare, mai le cifre),
[[metodo-misurare]], [[verifica-indipendente]], [[storie-mondo-preset]].
