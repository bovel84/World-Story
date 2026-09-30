# WS-MINISTER-UX-04 — Grafici, mappe e confronto delle conseguenze

> UX-03 aveva già legato la tavola alla conversazione (`compare` tra le strade del
> Tesoro, `focus` su un'evidenza). Ma due cose restavano fragili: la **mappa**
> disegnava con un `viewBox` fisso — quindi ritagliava la geometria in modo
> arbitrario — e il confronto diceva solo **costo** e **guadagno**, senza dire
> dove il motore tace. Questa fase inquadra la mappa sulla geometria reale e
> trasforma il confronto in una **tassonomia delle conseguenze**: dimensioni
> omogenee, provenienza dichiarata, effetti sociali mai inventati.

- **Ramo**: `feat/ws-minister-ux-04-mappe-e-conseguenze`, impilato su
  `feat/ws-minister-ux-03-conversazione-guida-tavola` (tip `304889b`), che a sua
  volta poggia su `main` @ `909d0f8`. **UX-03 non è ancora mergiata**: questa
  base impilata è dichiarata qui e nel §8.
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fase UX-04.
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3 (conversazione /
  evidenze / ordini / memoria sono oggetti distinti), `WS-MINISTER-UX-01-report.md`
  (la tavola), `WS-MINISTER-UX-02-report.md` (voce e priorità), `WS-MINISTER-UX-03-report.md`
  (direttiva di presentazione).
- **Freeze rispettato**: nessun file di `core/simulation/**`, nessuna modifica a
  `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
  schema o repository. Nessun innesto rimandato per freeze.

---

## 1. Il confine, in una frase

La mappa si **misura** dai path del read model e si inquadra sui limiti reali;
il confronto si costruisce con le stesse dimensioni per ogni strada, ciascuna con
la sua **provenienza**; dove il motore non dichiara, la tavola lo scrive. Nessuna
cifra nuova, nessuna geometria dal modello, nessuna curva per riempire spazio.

## 2. La mappa focalizzata

### Il difetto corretto

`SeatCanvas.ZoneMap` usava `viewBox="0 0 100 100"`. La geometria pubblicata dal
motore (`Region.svgPath`) vive su una tela **2000×1500**: un viewBox fisso
ritagliava le regioni in modo arbitrario, o le tagliava fuori. Ora il viewBox si
costruisce dai limiti reali del path, con un margine.

### Il modulo puro `regionFocus.ts`

| Funzione | Ruolo |
|---|---|
| `svgPathBounds(path)` | limiti dal `d` (stessa lettura numerica di `MapView.getCentroid`) |
| `unionBounds(list)` | unione dei limiti; `null` se nessuno è leggibile |
| `viewBoxFor(bounds, padding=4)` | stringa `viewBox` con margine; fallback `0 0 2000 1500` |
| `focusViewBox(zones, focusIds)` | inquadra la **selezione** se ha geometria, altrimenti l'insieme |
| `partitionZones(zones, focusIds)` | quali zone sono in evidenza (solo id esistenti) |
| `zoneCentroid(path)` | centro approssimato, per le etichette |

### La resa della mappa (`ZoneMap`)

- **Adattamento del viewport**: `<svg viewBox=…>` calcolato; niente più ritaglio fisso.
- **Evidenziazione**: le zone richieste prendono `.focused`; le altre `.dimmed`.
- **Selezione**: il click (o Invio/Spazio) su un path, o su una voce di legenda,
  seleziona la zona e ne mostra il dettaglio (`.zone-map-selected`).
- **Legenda**: sempre presente; con una selezione mostra le zone in evidenza,
  altrimenti le prime zone. È anche il **controllo accessibile** della selezione
  (l'SVG ha `<title>` e `role="button"`, ma la legenda è la via non visiva).
- **Annotazione**: la nota della direttiva resta nel banner (UX-03).
- **Fallback territoriale**: se nessuna zona ha geometria, si mostra
  l'**elenco esplicito** (`.zone-map-list`), ordinato con le zone in evidenza per prime.

## 3. Le conseguenze dichiarate

### Il modulo puro `consequences.ts`

Sette dimensioni, **le stesse per ogni strada**, nell'ordine:

| `id` | Etichetta | Da dove viene |
|---|---|---|
| `initial` | Costo immediato | `road.declaredCost` (atto, `declared`) |
| `recurring` | Spesa ricorrente | non dichiarata dal motore → `unavailable` |
| `timing` | Tempi | non dichiarati dal motore → `unavailable` |
| `coverage` | Copertura | `declaration.funded` / `missingMaterials` (opera) |
| `constraints` | Vincoli | `path.prerequisites` della strada |
| `benefit` | Benefici attesi | `road.expectedGain` (dichiarato) |
| `uncertainty` | Incertezza | provenienza delle `figures`: misurata/stimata/dato mancante |

Ogni cella porta un `ComparisonCell { value, basis }` con
`basis ∈ measured | estimated | declared | unavailable`: **unità e orizzonte**
sono nel testo del valore, la provenienza è nel badge. Ciò che non è dichiarato
non diventa un numero: diventa «Spesa ricorrente: non dichiarato dal motore».

### La catena `finanziamento → opera → capacità → società`

Ogni strada porta un `flow` di passi, ciascuno con `kind`:

- `simulated` — il motore lo calcola (addebito di cassa, apertura del cantiere);
- `declared` — il catalogo lo dichiara, il motore non lo simula passo per passo
  (capacità del servizio; per il rimborso: impegno di cassa, scadenza, interessi);
- `not-simulated` — gli **effetti sociali**, sempre con la stessa frase fissa
  (`SOCIAL_EFFECTS_NOTE`).

Il conteggio `countUnavailable` alimenta la nota di chiusura: *«N dimensioni su M
non sono dichiarate dal motore»* — così il limite è nel contesto della proposta,
come chiede l'accettazione.

### La resa del confronto (`ProposalComparison.tsx`)

Due schede (massimo due strade), ciascuna con le sette righe — etichetta, valore,
badge di provenienza — e la catena con i badge `simulato` / `dichiarato` /
`non simulato`. La classe `.proposal-comparison` resta invariata per l'E2E di
UX-03. Il confronto **non firma**: l'ordine nasce dall'atto del Tesoro.

## 4. Flusso end-to-end

```
modello ── testo + blocco `tavola` ──▶ MinisterChat
                                        │  parsePresentation(): valida anche `regionIds`
                                        ▼
                          GovernmentOffice: presentations[sedia] (UX-03)
                                        ▼
                  resolvePresentation(active, canvasBlocks, act.roads)
                                        ▼
      SeatTable ── presentation.regionIds (mappa) ──▶ SeatCanvas(focusRegionIds)
                 └─ compare ──▶ ProposalComparison(compareRoads)
```

- **La scelta resta del modello**: `regionIds` sono **riferimenti** (id), non
  geometrie. Il resolver li passa alla mappa **solo** quando l'evidenza è
  `mappa`; su ogni altra evidenza li ignora.
- **Validazione**: id accettati solo se `/^[A-Za-z0-9_-]{1,32}$/`, al massimo 20;
  gli altri scartati. Markup o codice nell'intero payload ⇒ direttiva respinta
  (comportamento di UX-03, invariato).
- **Isolamento e stato**: invariati da UX-03 — presentazione per sedia e per
  messaggio, stato di sola UI (nessuna coda, nessun mondo).

## 5. File

### Nuovi
| File | Ruolo |
|---|---|
| `frontend/src/components/Game/regionFocus.ts` | geometria delle zone: limiti, unione, viewBox, selezione (puro) |
| `frontend/src/components/Game/consequences.ts` | tassonomia delle conseguenze, catena, conteggio limiti (puro) |
| `frontend/src/components/Game/regionFocus.test.ts` | 7 test puri sulla geometria e il viewBox |
| `frontend/src/components/Game/consequences.test.ts` | 9 test puri sul confronto e i confini |
| `backend-nest/tests/ws-minister-ux-04.test.ts` | 3 test sulla riga `regionIds` nel briefing |
| `e2e/ux04-shot.mjs` | harness screenshot (mappa focalizzata, conseguenze) |
| `docs/implementation/assets/ws-minister-ux-04/` | screenshot a 1440×900, 1024×768, 390×844 |

### Modificati
| File | Cosa |
|---|---|
| `frontend/src/components/Game/SeatCanvas.tsx` | `ZoneMap`: viewBox dai path, evidenziazione, legenda, selezione, fallback; prop `focusRegionIds` |
| `frontend/src/components/Game/presentation.ts` | `PresentationDirective.regionIds`, sanificazione, passaggio al resolver (solo mappa) |
| `frontend/src/components/Game/ProposalComparison.tsx` | confronto a 7 dimensioni con badge di provenienza e catena delle conseguenze |
| `frontend/src/components/Game/SeatTable.tsx` | passa `focusRegionIds` alla mappa presentata |
| `frontend/src/editorial.css` | righe/badge del confronto, flusso, e mappa focalizzata (base + tavola chiara) |
| `backend-nest/src/core/government/MinisterChat.ts` | riga `regionIds` nella sezione `PRESENTAZIONE` |
| `e2e/mock-api.mjs` | il mock emette `regionIds:["ALPHA"]` sull'intento mappa/province |
| `e2e/tests/modules.spec.mjs` | nuovo **P04d**: mappa focalizzata e limiti delle conseguenze |
| `frontend/src/components/Game/presentation.test.ts` | nuovi test su `regionIds` (accettazione, sanificazione, solo-mappa) |
| `frontend/src/components/Game/seatTablePresentation.test.tsx` | confronto sulle 7 dimensioni; nuovo render della mappa focalizzata |

## 6. Test ed esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **115 file / 964 test** verdi (baseline UX-03 113/946 → +2 file / +18 test) |
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **203 file / 2131 test** verdi (baseline 202/2128 → +1 file / +3 test) |
| E2E `modules.spec.mjs` (mock) | **8/8**, incluso **P04d** (mappa → conseguenze) |
| E2E a11y (mock) | **3/3** (HUD, rail/tastiera, picker salvataggi) |
| Screenshot 1440×900 / 1024×768 / 390×844 | `e2e/ux04-shot.mjs`, tutti prodotti |

P04d verifica, in particolare: «Quali province coinvolge?» porta in cima la mappa,
il suo `viewBox` è `-4 -4 108 108` (misurato dal path, non più `0 0 100 100`), la
zona è `.focused` e la legenda nomina «Alfa»; «Confronta le due strade» mostra
`.proposal-comparison` con «Spesa ricorrente», «Incertezza», «non dichiarato dal
motore» e un passo `.kind-not-simulated`.

Verifica DOM sul percorso mock (1440×900): `viewBox=-4 -4 108 108`, 1 zona
`.focused`, legenda «Alfa», 2 schede × 7 righe, 8 passi di catena, nota «5
dimensioni su 14 non sono dichiarate dal motore…», **nessun overflow
orizzontale** nella tavola.

## 7. Verifica visiva

- **Mappa focalizzata** (`ux04-*-1-mappa.png`): la mappa sale in cima, inquadrata
  sulla geometria reale, con la zona in evidenza e la legenda.
- **Conseguenze** (`ux04-*-2-conseguenze.png`): due schede con le stesse sette
  dimensioni, i badge di provenienza e la catena con i passi simulato /
  dichiarato / non simulato.

## 8. Limiti residui

- **La selezione è del modello**: i test difendono il **contratto** (id validi,
  solo-mappa, sanificazione) e il percorso mock. Non c'è un E2E con LLM reale:
  se il provider non emette `regionIds`, la mappa mostra l'insieme (comportamento
  di sicurezza).
- **La geometria è approssimata**: i limiti si leggono dalle coppie numeriche del
  path (come `MapView.getCentroid`), sufficienti per inquadrare, **non** per un
  hit-test. Curve e archi non vengono interpretati.
- **Spesa ricorrente e tempi** restano `unavailable`: il motore non li dichiara
  per queste strade. La tavola lo dice, non li stima.
- **Effetti sociali**: nessuna previsione. La catena li marca `not-simulated` con
  la frase fissa; non ci sono curve di crescita.
- **Base impilata**: il ramo poggia su UX-03 (`304889b`), non ancora mergiata; la
  PR di UX-04 va aperta dopo (o insieme a) quella di UX-03.
- Nota di igiene preesistente: `dist/**/*.test.js` (copie compilate non
  versionate) vanno rimosse prima di `vitest`, altrimenti falliscono per
  `require('vitest')` in CommonJS.

## 9. Freeze e innesto

Non è stato necessario toccare la simulazione: la geometria e la tassonomia delle
conseguenze vivono in moduli **puri** del frontend e leggono solo read model già
in memoria (`CanvasZone.svgPath`, `TreasuryRoad`, `CabinetItemView`); il backend
cambia solo il testo del briefing in `core/government/**`. **Nessun innesto
rimandato per freeze.**

## 10. Classificazione A/B/C/D/E

- **A** — comportamento e resa: geometria della mappa (`regionFocus.ts`, `SeatCanvas.tsx`,
  `SeatTable.tsx`), tassonomia delle conseguenze (`consequences.ts`,
  `ProposalComparison.tsx`), contratto `regionIds` (`presentation.ts`) e CSS
  (`editorial.css`).
- **B** — harness e mock: `e2e/ux04-shot.mjs`, `e2e/mock-api.mjs` (esito `regionIds`
  sull'intento mappa). Non toccano il gioco.
- **C** — test: puri (`regionFocus.test.ts`, `consequences.test.ts`,
  `presentation.test.ts`), di render (`seatTablePresentation.test.tsx`), backend
  (`ws-minister-ux-04.test.ts`) ed E2E (`P04d`).
- **D** — questo report e gli screenshot in `docs/implementation/assets/ws-minister-ux-04/`.
- **E** — *nessuna*. Nessuna migrazione, nessun tocco al freeze.

---

**Prossimo passo del piano**: **WS-MINISTER-UX-05** (memoria persistente del
ministro), che estenderà la cronologia con una memoria conversazionale separata
dai numeri del mondo, con le regole di fork e rewind.
