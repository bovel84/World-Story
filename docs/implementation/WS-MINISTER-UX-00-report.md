# WS-MINISTER-UX-00 — Audit e contratto della nuova esperienza

- **Base**: `main` @ `336e170` (WS-GOVOFFICE-07 mergiato); ramo
  `feat/ws-minister-ux-00-01-dialogo-e-tavola`.
- **Scopo**: fissare percorsi reali, dipendenze e confini prima di toccare la
  seduta; distinguere ciò che **esiste** da ciò che è **derivabile** e da ciò
  che è **assente**. Nessun refactoring dell'applicazione, nessun numero di
  impatto inventato.
- **Confine**: conversazione, memoria conversazionale, evidenze e coda degli
  ordini sono **oggetti distinti**. Parlare e mostrare **non** modificano il
  mondo; solo la firma di un atto entra in coda.

## 1. Percorsi effettivi (chi produce cosa)

| Oggetto | Chi lo produce | Dove vive | Persistenza |
|---|---|---|---|
| Sedia, competenza, apertura, bisogni, cifre | **backend** `readCabinetSession` → `composeCabinet` (`core/government/Cabinet.ts`, `GovernmentAgenda.ts`), servita da `GET /:id/government/cabinet` | `CabinetSessionView` → `CabinetSession` / `SeatBrief` | read model del turno |
| Risposta del ministro | `briefingFor` (`core/government/MinisterChat.ts`) compone il contesto; rotta `POST /:id/government/minister/:seat` e `.../stream` | `ministerApi.askStream` | nessuna: la `history` è inviata dal client a ogni richiesta |
| Cronaca per sedia | `MinisterChat` → store Zustand `chatStore.ministerChats` | RAM del browser (nessun `persist`) | **persa al reload** |
| Evidenze della tavola | `deriveSeatCanvasBlocks` (`seatCanvasModel.ts`) dai read model + `seatCanvasConfig.ts` (contenuto autore) | `SeatTable` → `SeatCanvas` | ricalcolate a ogni render |
| Grafici | `advisorCharts.budgetChart/trendChart` → `AdvisorChart` (SVG) | tavola | ricalcolati dai dati di partita |
| Piano strategico | `strategicPlan.ts` (contenuto **autore**) | tavola (`strategy`) | statico (UX-07 lo dichiara fuori scope) |
| Mappa zone | `zoneBoard` (regioni del giocatore, `Region.svgPath`) | tavola (`map`) | read model |
| Atto del Tesoro | `treasuryAct.ts` (cifre da `account`/`resources`/`economy`) | `TreasuryActPanel` | ricalcolato |
| Ordine / esito | `queueCabinetPath` / `queuePlayerAction` → `pendingActions` → registro (`OrderRegister`) | coda del motore | **canonica** (persistita dal salvataggio) |
| Stato e data | `nationalName`, `currentGame.currentDate` | testata della seduta | dalla partita |

## 2. Dipendenze

- `GovernmentOffice` ← `GameScreen` (props: `session`, `pictureSources`,
  `pendingActions`, `nationalName`, `currentDate`, `onQueue*`, `onWithdrawOrder`).
- `nationalOperatingPicture(nationOperatingPictureInput(pictureSources))` è la
  sorgente unica dei numeri del dossier e della tavola (invariante D01).
- Nessuna chiamata di rete extra nella seduta: la tavola usa ciò che è già in
  memoria; l'unica rete della chat è la rotta ministeriale.

## 3. Contratto messaggi / evidenze / ordini / memoria

```
Conversazione   AdvisorHistoryItem { role: 'user'|'assistant'; content: string }
                → max 20 messaggi inviati come contesto; NON impegna il mondo.

Evidenza        SeatCanvasBlock (metrics|chart|strategy|map|ideas)
                + PresentationDirective (UX-03, da implementare):
                  { operation: show|focus|compare|annotate|dismiss;
                    evidenceId; proposalId?; regionIds? }
                → tipi/riferimenti/soggetti validati; mai HTML/JS/geometrie dal modello.

Ordine          pendingActions → OrderRegister (coda del motore)
                → unico oggetto che impegna; firma esplicita del Presidente.

Memoria         (UX-05, da implementare) ricordi indicizzati:
                  { partita, ramo, ministro, mandato, tipo, rif. messaggio/atto, data, stato }
                → separata dai numeri del mondo; copiata al fork, filtrata al rewind.
```

Regola: la conversazione **propone**, l'evidenza **mostra**, l'ordine **impegna**,
la memoria **ricorda**. Un fallimento di uno non cancella gli altri (la risposta
testuale resta anche se una direttiva non è valida).

## 4. Matrice disponibile / derivabile / assente

### Disponibile (già nel codice)
- Sedia, competenza, apertura, bisogni e **cifre con provenienza** (`measured` /
  `estimated` / `unknown`).
- Blocchi tipizzati della tavola (`metrics`, `chart`, `strategy`, `map`, `ideas`)
  e grafici SVG senza librerie.
- Mappa delle zone del giocatore (con `svgPath` o lista esplicita).
- Chat con **streaming** e cronaca per sedia.
- Coda ordini reale, registro degli atti, addebito via `OrderSettlementEntry`.
- Identità minima della sedia (nome, incarico) e Stato/data di gioco.

### Derivabile con metodo
- **Atto concreto del Tesoro** (`treasuryAct`): cassa, saldo, debito/PIL,
  interessi/entrate, prossima scadenza, richiesta dei Lavori — tutti dai read
  model, con provenienza.
- **Confronto tra proposte**: costo immediato, prerequisiti, esito atteso
  dichiarato dal catalogo; grandezze omogenee e orizzonte da dichiarare.
- **Profilo stabile del ministro** (UX-02): competenza + stile + priorità,
  derivabili come *contratto*, senza biografie storiche inventate.
- **Memoria conversazionale** (UX-05) usando i meccanismi di salvataggio esistenti.
- **Direttive di presentazione** (UX-03) come evento strutturato validato accanto
  al testo.

### Assente (e dichiarato)
- **Personalità e opinioni del ministro** nel briefing: oggi il prompt le vieta.
- **Memoria persistente** della conversazione (solo RAM client).
- **Selezione delle evidenze guidata dalla conversazione** (oggi statica, UX-03).
- **Effetti sociali calcolati** (consenso, occupazione): non simulati dal motore.
- **Azione deterministica di rimborso titoli**: le scadenze sono un rollover.
- **Notiziario** che citi l'atto firmato; **badge nuove evidenze** e **ritorno al
  messaggio collegato** (UX-03).
- **Firma automatica del ministro**: non esiste né va introdotta.

## 5. Due schermate di riferimento

### Ingresso nella seduta (desktop)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Ministri   Ministro del Tesoro            ITALIA · 1951-02-01  [D|T]    │
│              cassa, debito e bilancio                                    │
├───────────────────────────────┬──────────────────────────────────────────┤
│ ▸ Fascicolo della sedia (1)   │  LA TAVOLA                               │
│                               │  Sul tavolo · L'atto del Tesoro          │
│  Ministro del Tesoro          │  «in cassa ci sono … interessi …»        │
│  Signor Presidente,           │  [ Cassa | Saldo | Debito/PIL | … ]      │
│  La cassa regge…              │  Richiesta in attesa · Lavori            │
│                               │  ▸ Investimento  ▸ Ammortamento          │
│  ─────────────────────────    │  ── visualizzazione principale ──        │
│  [ scrivi al ministro… ] [→]  │  piano a cascata / mappa / grafico       │
│ ─────────────────────────    │  Approfondimenti ▸                       │
│ Nulla di fatto  · registro    │                                          │
└───────────────────────────────┴──────────────────────────────────────────┘
```
Il **saluto** e il **composer** sono nella prima schermata; il fascicolo è chiuso.
La **tavola** ha una visualizzazione principale (qui il piano) e supporti.

### Confronto tra due proposte (desktop, UX-03/04)
```
┌───────────────────────────────┬──────────────────────────────────────────┐
│ «Confronta prudente e         │  CONFRONTO — proposta A ⟷ proposta B     │
│  ambiziosa»                   │  ┌───────────────┬──────────────────────┐ │
│                               │  │ PRUDENTE      │ AMBIZIOSA            │ │
│ Il ministro spiega i          │  │ costo …       │ costo …              │ │
│ compromessi e chiede i        │  │ tempi …       │ tempi …              │ │
│ dettagli necessari.           │  │ copertura …   │ copertura …          │ │
│                               │  │ benefici      │ benefici             │ │
│ ───────────────────────────   │  │ (misurati)    │ (misurati)           │ │
│ [ scrivi… ]              [→]  │  │ incertezza    │ incertezza           │ │
│                               │  └───────────────┴──────────────────────┘ │
│                               │  Effetti sociali: IPOTESI QUALITATIVE     │
│                               │  (non calcolati dal motore)              │
└───────────────────────────────┴──────────────────────────────────────────┘
```
Il confronto usa **grandezze omogenee** e dichiara unità e orizzonte; gli effetti
non calcolabili restano ipotesi qualitative, **non** curve inventate.

## 6. Freeze e confini di questa fase

- **CORE ENGINE FREEZE rispettato**: nessuna modifica a `core/simulation/**`,
  `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
  schema/DB, repository, pipeline di avanzamento del tempo.
- **UX-00 + UX-01**: solo presentazione e composizione. Nessuna memoria nuova,
  nessuna nuova meccanica economica, nessun effetto sociale.
- **Non promette memoria persistente**: il contratto di §3 è predisposto;
  l'implementazione è di **UX-05** (innesto backend reale).
