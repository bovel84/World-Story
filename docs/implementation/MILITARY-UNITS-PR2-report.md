# MILITARY-UNITS PR2 — I fronti di guerra reali (P6–P9)

**Data:** 2026-09-19 · **Base:** `main` @ `b199398` · **Branch:** `feat/war-fronts`
**Stato:** implementazione completa, test e build verdi, **PR aperta e NON mergiata**
(la specifica chiede esplicitamente di non mergiare).

---

## 1. Sintesi

PR1 ha reso il **reparto** un oggetto persistente con uomini, pezzi e fabbisogni
propri. Ma i reparti non facevano nulla: esistevano, si rinforzavano, si
spostavano, e la guerra restava quella del tick legacy (`militaryPower` delle
province, conquista a dado una volta ogni tanto).

PR2 aggiunge il **fronte**: un conflitto **strategico** fra due polity ostili con
confine reale e reparti schierati, che si consuma in periodi reali — pressione,
perdite di uomini e pezzi, consumi dalle scorte, ritirata, sfondamento, conquista
via `transferRegion`.

```
WarFrontState (persistente)  ←deriva←  MilitaryUnit.frontId
        ↓
   FrontEngine (puro, deterministico)
        ↓
 perdite reali + consumi reali + ritirata + transferRegion
```

Un solo motore, lo stesso per il giocatore e per gli NPC: cambia **chi sceglie**
l'ordine (pannello del reparto o policy deterministica), non il calcolo.
Nessun wargame tattico: il fronte è strategico (niente tenaglie, sbarchi,
esagoni).

---

## 2. Il mandato (P6–P9)

| Punto | Richiesta | Dove è realizzato |
|---|---|---|
| **P6** | `WarFrontState` + persistenza | `core/simulation/OperationalState.ts`, `game/OperationalStateStore.ts` (kind `'front'`), `repositories/operational-object.repository.ts` |
| **P7** | assegnazione reparti + ordini | `MilitaryUnitState.frontId`, `unit.order`, `UI` `order_*`, `game/WarFrontService.ts` (`syncFronts`, `unitOrder`) |
| **P8** | `FrontEngine` di combattimento | `core/simulation/WarFronts.ts` (`resolveFront`) |
| **P9** | perdite, ritirata, territorio | `resolveFront` (perdite reali) + `retreatRegionFor` + `advanceFronts` (`transferRegion`) |
| **—** | determinismo `frontRollSeed` | `frontRollSeed({ frontId, date, phase })` → `stableRoll` (FNV, lo stesso del tick di produzione) |

Vincoli non negoziabili della specifica, tutti rispettati: **no wargame tattico**,
**no secondo motore militare**, **stesso `FrontEngine` per giocatore e NPC**,
**l'LLM narra ma non decide numeri**, **conquista territoriale solo via
`transferRegion`** con sfondamento + difensore che non tiene + obiettivo
raggiunto.

---

## 3. Principi

1. **`MilitaryUnit.frontId` è la fonte dell'assegnazione.** Il fronte **deriva**
   i suoi reparti; non tiene un secondo elenco che può divergere.
2. **Il fronte è territoriale, non tattico.** Nessuna posizione, nessun fronte
   continuo, nessun ordine di battaglia: due parti, una pressione, un obiettivo.
3. **Le perdite sono reali.** Uomini e pezzi si tolgono ai **reparti** (non a un
   numero aggregato): se il reparto esiste, la guerra lo consuma davvero.
4. **Nessun uomo nasce dal nulla.** La guerra toglie, non aggiunge; la riserva
   addestrata non viene toccata dal combattimento.
5. **Determinismo totale.** Ogni tiro passa da `frontRollSeed({frontId, date,
   phase})` → `stableRoll`. Mai `Math.random`. Stesso fronte e stessa data ⇒
   stesso esito, verificabile.
6. **La mappa resta la fonte del mondo.** La conquista passa da `transferRegion`;
   la forza dichiarata in teatro è la `militaryPower` delle province.
7. **Niente doppio sistema.** Se una coppia di polity ha un fronte con reparti,
   la conquista la decide il `FrontEngine` e il tick legacy **non** concorre sulle
   stesse province.

---

## 4. P6 — `WarFrontState` e persistenza

```ts
export interface WarFrontState {
  id: string;                      // `front-<A>-<B>` (non direzionale)
  name: string;                    // «Fronte Italia–Austria»
  attackerPolityId: string;
  defenderPolityId: string;
  regionIds: string[];             // il teatro (province di confine delle due parti)
  status: WarFrontStatus;          // forming | active | stalemate | breakthrough | collapsed | closed
  objectiveRegionId: string | null; // provincia del difensore da prendere
  attackerPressure: number;        // ultima pressione misurata (fatti, non calcoli UI)
  defenderPressure: number;
  createdDate: string;
  updatedDate: string;
}
```

Persistenza: `game_operational_objects` con `kind = 'front'` — **nessuna
migrazione** (la tabella non ha CHECK sul `kind`; l'aggiunta è puramente
additiva, come per `'unit'` in PR1). Lo store ha `fronts()`, `saveFronts(fronts,
units?)`, `persistedFronts()` (lettura pura senza materializzazione) e il caso
`'front'` in lettura.

`saveFronts(fronts, units)` scrive **fronte e reparti nella stessa chiamata**:
lo stato di un fronte e quello delle sue unità sono la stessa fotografia, mai due
scritture che possono divergere.

---

## 5. P7 — assegnazione e ordini

**Assegnazione.** `syncFronts()` apre un fronte solo se esistono **tutte** le
condizioni: due polity **ostili**, un **confine reale** (adiacenza dalla mappa) e
**reparti schierati** nel teatro. I reparti della coppia presenti nel teatro
ricevono `frontId` (una volta sola: `!unit.frontId`); i reparti di un fronte
chiuso lo perdono. Il **ruolo** (chi attacca, chi difende) si decide **alla
nascita** del fronte: più uomini nel teatro, poi più potenza dichiarata, poi
l'ordine alfabetico. Un fronte già aperto **conserva i suoi ruoli**: una guerra
che cambia «chi attacca» a ogni periodo non è una guerra, è rumore.

**Ordini (4 mosse, `MilitaryUnitState.order`, persistente):**

| Ordine | Pressione | Perdite | Consumi |
|---|---|---|---|
| `attack` | ×1,35 | ×1,25 | ×1,8 |
| `defend` | ×1,00 | ×0,85 | ×1,2 |
| `reserve` | ×0,45 | ×0,50 | ×0,8 |
| `withdraw` | ×0,00 | ×0,70 | ×1,0 |

I fattori sono **centralizzati** (`UNIT_ORDER_INFO`): il motore, l'anteprima e i
test leggono lo stesso oggetto. Il giocatore sceglie dal pannello del reparto
(`order_attack` … `order_withdraw`, con `dryRun` = anteprima PRIMA → DOPO); per
gli NPC la scelta è `npcFrontOrder({ownPressure, enemyPressure})` — la **stessa**
formula, deterministica: vantaggio ≥ 1,4 → attacca; fra 0,6 e 1,4 → difende;
sotto 0,6 → si ritira.

**Perché `withdraw` esiste.** Serve una via d'uscita onorevole: un reparto che si
ritira smette di premere (pressione 0) ma non si fa distruggere, e ripiega in una
provincia amica adiacente. È anche il modo in cui una difesa numericamente
inferiore «cede il campo» senza essere annientata.

---

## 6. P8 — `FrontEngine` (`core/simulation/WarFronts.ts`, puro)

`resolveFront(input)` non tocca il mondo: legge reparti, rifornimenti e potenza
dichiarata, e restituisce pressioni, esiti per reparto, consumi, stato, tiro e
decisione di avanzata. Nessun `import` da store, sessioni o repository.

**Pressione di una parte** = Σ forze effettive dei reparti + supporto dichiarato:

```
forza del reparto = organico × equipaggiamento × prontezza × ordine × rifornimenti
pressione          = Σ forze + min(1,5; militaryPower/400) × peso × fattore d'ordine
 peso              = 0,25 se la parte ha reparti persistenti, 1 se non ne ha
```

Le formule riusano il motore: `arsenalCombatFactor` (MilitaryIndustry),
`militaryManpower` e `rifleRequirement` (MilitaryDoctrine), `equipmentQuantity` e
`combatAttrition` (MilitaryIndustry). **Nessuna formula riscritta.**

**Perdite** (per parte):

```
rapporto    = pressione nemica / max(0,25; pressione propria)
quota       = 0,06 × mesi × rapporto × fattorePerdite(ordine) × jitter(0,75…1,25)
perdite     = min(35%; quota) applicate a uomini e pezzi (combatAttrition)
```

Il tiro (`jitter`) è una **variazione** (±25%), non il fattore dominante: la forza
effettiva resta quella dei reparti, dei rifornimenti e degli ordini.

**Consumi di guerra** = fabbisogni mensili dei reparti × fattore d'ordine × mesi,
scaricati dalle **scorte reali** via `applyFlow` (lo stesso magazzino del material
flow). Se la scorta non basta, `supplyCoverage` scende e la pressione cala: la
penuria morde sulla battaglia, non su un numero finto.

**Stato del fronte:**

| Stato | Significato |
|---|---|
| `forming` | aperto, non ancora risolto |
| `active` | in contatto, nessuno prevale |
| `stalemate` | pressioni entro il 15% |
| `breakthrough` | vantaggio ≥ 1,5, attaccante in ordine, difensore che non tiene, tiro passato (55%) |
| `collapsed` | vantaggio difensivo ≥ 1,5 e attaccante in rotta |
| `closed` | l'ostilità è finita: i reparti sono liberati |

---

## 7. P9 — perdite, ritirata, territorio

**Perdite reali.** `advanceFronts` applica a ogni reparto coinvolto uomini,
pezzi, prontezza e stato restituiti dal motore, e **persiste** (una sola
`saveFronts`). La riserva addestrata non viene toccata: la guerra non è una leva
di reclutamento.

**Ritirata.** `retreatRegionFor` sceglie la **prima provincia amica adiacente**
fuori dal teatro e dall'obiettivo: la geografia è quella della mappa (`borders`),
nessuna geografia nuova. Se non esiste una via di ripiegamento la resa costa di
più (`SURRENDER_LOSS_MULTIPLIER = 1,25`, cioè +25% di uomini persi), e se il
reparto scende sotto la soglia organica si sbanda.

**Territorio.** La conquista avviene **solo** quando il motore decide
`advance` — cioè con `status = breakthrough`, difensore che non tiene
(`routedDefender`) e **obiettivo raggiungibile** (provincia del difensore,
adiacente a una provincia dell'attaccante, dentro il teatro) — e passa da
`transferRegion` (la stessa strada del mondo); l'evento finisce nei dispacci.
Una provincia **non confinante** non si conquista nemmeno con lo sfondamento
(test 20).

---

## 8. Determinismo

```ts
frontRollSeed({ frontId, date, phase })  // `${frontId}:${date}:${phase}`
stableRoll(seed)                          // FNV-1a → [0, 1) — riuso di MilitaryProduction
```

Fasi: `combat-attacker`, `combat-defender`, `breakthrough`. Stesso fronte e
stessa data ⇒ stesse pressioni, stesse perdite, stesso esito (test 7, 23, 28).
Nessun `Math.random` in `WarFronts.ts` né in `WarFrontService.ts` (l'unica
occorrenza della parola è nel commento che lo vieta).

---

## 9. Quando il fronte avanza (il tick)

Il fronte si risolve **una volta per periodo materiale** (≤ 30 giorni) e **una
volta per tick live** (7 giorni), riusando gli agganci che esistono già:

- `NationStateService.advanceResources` → hook `onPlayerSlice(slice)` — il
  wrapper in `game-session.ts` chiama `advanceFronts(days, date)`;
- `LiveTickService` → `applyWorldConflicts` → `advanceFronts(days)`.

Nessun nuovo timer, nessun nuovo scheduler, nessuno stato parallelo.

**Lettura pura.** `hasPersistentMilitary()` legge `persistedUnits()` /
`persistedFronts()`: un mondo che non ha mai materializzato reparti **non viene
toccato** (né scritto) da una lettura. Se il mondo ha reparti, il tick scrive solo
se qualcosa è cambiato davvero (`JSON.stringify` dei reparti): un tick senza
battaglia non riscrive né i reparti né gli oggetti-armata della mappa. Questa
regola è nata da una regressione reale trovata nei test (`map-features`, §20):
leggere i fronti non deve modificare gli oggetti della mappa.

---

## 10. Un solo motore (giocatore e NPC)

- **Giocatore:** `POST /games/:id/military/units/:unitId/order` → `unitOrder()` →
  `dryRun` anteprima / ordine vero. L'anteprima **non scrive nulla** (test 11,
  probe §19).
- **NPC:** la stessa `resolveFront`, con l'ordine deciso da `npcFrontOrder`. Nel
  tick, la policy riscrive l'ordine dei reparti NPC (persistente, così il
  giocatore lo vede nella sala di governo).
- **Nessun LLM nei numeri:** le funzioni del fronte non chiamano provider; gli
  esiti diventano **dispacci deterministici** (`FrontTickReport.events`) e note
  nel feed.

Il test 8 lo verifica per costruzione: la risoluzione di un fronte è **identica**
a prescindere da quale polity sia il giocatore (stessi input ⇒ stessi output).

---

## 11. Niente doppio sistema (tick legacy)

`NpcTurnService.processWorldConflictTick` resta il percorso **legacy** (province
con `militaryPower`, nessun reparto persistente). La conquista legacy viene
saltata **solo per le coppie già coperte da un fronte con reparti**:

```ts
if (this.ctx.frontBetween?.(c.attacker, c.defender)) continue;
```

Non un `if` globale, ma un controllo per coppia: un mondo che ha reparti da una
parte e una guerra senza fronte dall'altra continua a funzionare come prima. Il
test 24 di `war-fronts` verifica che senza stato militare persistente il tick del
mondo resta esattamente quello legacy, e `stage2` («WORLD-ALIVE P3») continua a
vedere la conquista legacy quando **non** c'è un fronte.

---

## 12. L'attrito della forza dichiarata

Senza attrito, una provincia con `militaryPower` alta e **nessun reparto** sarebbe
invulnerabile: il fronte non potrebbe mai concludersi. Quindi la forza dichiarata
in teatro **perde la stessa quota** dei reparti:

```
quota persa = 0,06 × mesi × rapporto × fattorePerdite(ordine) × jitter × peso
              (peso = 0,25 se la parte ha reparti, 1 se non ne ha)
militaryPower delle province in teatro ×= (1 − quota)
```

La scrittura è **sulla mappa**, come già fa l'attrito di conquista
(`WorldMutationService.applyConquestAttrition`): la mappa resta la fonte, e il
tick legacy vede una forza realmente consumata. Misura reale (probe, §19):
`militaryPower` di una provincia da 1.000 scende a 868 in 6 mesi di fronte.

---

## 13. Reparti distrutti

Un reparto che scende a **zero uomini**, o che è **in rotta sotto la soglia
organica** (25% dell'organico d'epoca), si **sbanda**: `status = 'destroyed'`,
equipaggiamento azzerato, prontezza 0. Da quel momento:

- non combatte più (escluso dai lati del fronte: `sideUnits` filtra i distrutti),
- non consuma e non perde altri uomini,
- **non torna in vita** al periodo successivo (regressione trovata nella probe e
  corretta: prima un reparto distrutto veniva «ripristinato» dallo stato calcolato
  sulla copertura).

La riga resta nello stato del paese — la storia non si cancella — e il reparto
può essere ricostituito con le azioni esistenti (crea reparto / rinforza).

---

## 14. Read model (`/arsenal` e `/military/fronts`)

- **Oggetto `front`** nel quadro operativo: `parentId = 'force'`, stato
  (`Attivo`, `In stallo`, `Collassato`, …), fatti (attaccante, difensore,
  pressione delle due parti, reparti impegnati, teatro, obiettivo, consumi di
  guerra) e problemi dichiarati (fronte senza reparti, stallo, collasso).
  I reparti del fronte arrivano dal loro `frontId`: il read model **legge**, non
  tiene un secondo elenco.
- **Sul reparto**: i fatti `Ordine` (con la descrizione dei fattori) e `Fronte`
  (nome e stato), più le **4 azioni d'ordine** in `actions`, con
  `enabled`/`blockedReason` del motore («Il reparto ha già l'ordine «Difendi»»,
  «Il reparto non è assegnato a un fronte: non ci sono ordini da dare»).
- **`GET /games/:id/military/fronts`**: elenco dei fronti (stessa fonte dello
  stato, sincronizzata alla lettura).
- **`POST /games/:id/military/units/:unitId/order`**: `{ order, dryRun }` →
  `UnitOrderImpactPayload` (righe PRIMA → DOPO: pressione della parte, pressione
  nemica, perdite attese, consumi di guerra).

---

## 15. UI (sala di governo)

- Il **fronte** è un oggetto del settore «Forze armate», sotto lo schieramento:
  nome, stato, pressioni, obiettivo, problemi.
- Sul **reparto** è comparsa la riga **«Mosse sul fronte»** con le quattro mosse;
  l'ordine in corso è disabilitato con il motivo, e un reparto senza fronte ha le
  mosse **dichiarate bloccate** (non nascoste).
- La conferma mostra la stessa tabella **PRIMA → DOPO** delle altre azioni:
  pressione, pressione nemica, perdite attese, consumi. Nessun numero calcolato
  nella UI.

---

## 16. FREEZE — cosa è stato toccato nel motore

`core/simulation/**` è sotto freeze: le modifiche sono **additive** e dichiarate.

| File | Modifica | Perché è additiva |
|---|---|---|
| `core/simulation/WarFronts.ts` | **nuovo**, puro | nessuna dipendenza da store/sessioni: si può cancellare senza effetti collaterali |
| `core/simulation/OperationalState.ts` | tipi `WarFrontStatus`, `WarFrontState`, `UnitOrder`, campo `order`/`frontId` su `MilitaryUnitState`, sezione fronti nel read model, 4 azioni d'ordine | nessuna regola esistente modificata: le azioni d'ordine sono **aggiunte** a `unitActions` accanto alle quattro di PR1 |
| `core/simulation/OperationalObjects.ts` | `OperatingKind` += `'front'`, azioni d'ordine, `counts.front` | tipo additivo |
| `WorldStateEngine`, `GameSession` turn pipeline, `TurnOrchestrator`, `SessionStateStore`, schema/db, `repositories`, checkpoint, playback, Zustand/economia | **non toccati** | — |

Nel tick del mondo sono toccati solo gli **hook esistenti**
(`onPlayerSlice`, `applyWorldConflicts`) e il ramo legacy di `NpcTurnService`
(un controllo per coppia, non un percorso nuovo).

Nessuna migrazione: `game_operational_objects` accetta `kind = 'front'` senza
CHECK (verificato su 52 tabelle dello schema corrente).

---

## 17. API e contratti

| Metodo | Percorso | Nota |
|---|---|---|
| `GET` | `/games/:id/military/fronts` | elenco fronti (lettura sincronizzata) |
| `POST` | `/games/:id/military/units/:unitId/order` | `{ order, dryRun }` |

Errori dichiarati (`UNIT_ERROR_CODES`): `unit_unknown`, `front_unknown`,
`order_unknown` (oltre a quelli di PR1). L'inventario endpoint rigenerato passa
da **104 a 106** endpoint (`games/state.routes.ts`: 20 → 22).

---

## 18. Test

`backend-nest/tests/war-fronts.test.ts` — **29 test**, tutti verdi:

*Motore puro (1–8)*: forza del reparto (organico × equipaggiamento × prontezza ×
ordine × rifornimenti); rifornimenti mancanti (carburante per i motorizzati,
munizioni per l'attacco, cibo per tutti); consumi per ordine; policy NPC
deterministica; ritirata in provincia amica fuori dal teatro; scelta
dell'obiettivo (il meno difeso, poi l'id); determinismo (stesso fronte e stessa
data); identità delle parti irrilevante (stesso motore).

*Integrazione (9–29)*: il fronte nasce solo con ostilità + confine + reparti;
l'assegnazione è `unit.frontId`; ordini persistenti con anteprima `dryRun`; read
model (fronte + ordine/fronte sul reparto + 4 mosse); attacco vs difesa (più
pressione, più perdite per chi attacca); perdite **reali** sugli uomini e sui
pezzi; senza rifornimenti la pressione cala e i consumi escono dalle scorte
reali; ritirata; conquista con `transferRegion` **e solo allora**; stallo senza
trasferimenti; provincia non confinante mai conquistata; conservazione di uomini
e pezzi; fronte chiuso che libera i reparti; tick deterministico; nessun doppio
sistema senza stato persistente; nessun effetto su crisi/playback/produzione;
attrito della forza dichiarata; reparto in rotta sotto soglia che si sbanda;
seme del tiro dipendente solo da fronte/data/fase; **reparto distrutto che non
torna in vita** (regressione trovata in probe e corretta).

Aggiornato `military-units.test.ts` (PR1): il reparto ora espone anche le quattro
mosse del fronte, e **senza fronte** sono bloccate con il motivo — il test lo
verifica invece di assumere la vecchia lista di quattro azioni.

---

## 19. Verifica di esecuzione reale (pre-PR)

Tutto eseguito sulla base `b199398`, albero pulito.

| Comando | Esito |
|---|---|
| `npx tsc --noEmit` (backend) | pulito |
| `npx vitest run tests/war-fronts.test.ts` | **29/29 verdi** |
| `npx vitest run` (backend) | **159 file / 1548 test verdi** (137 s) |
| `npm run build` (backend) | ok |
| `npx tsc --noEmit -p frontend` + `npx vitest run` (frontend) | **67 file / 494 test verdi** |
| `npm run build` (frontend) | ok |
| `npx playwright test` (e2e mock) | **49 verdi** (erano 47) |

**Sonda su dati reali** (`tests/_probe/war-fronts-probe.test.ts`, temporanea,
**cancellata prima del commit**; misure in `/tmp/ws-fronts-probe.json`). Mondo a 4
province: ITA (30M ab., 4 brigate da 12.000 uomini, `militaryPower` 300) contro
AUT (6M ab., `militaryPower` 1.000, nessun reparto), ostili, in confinanza.

- **Apertura:** un fronte `front-AUT-ITA` «Fronte Italia–Austria», teatro
  `Tirolo · Pianura`, obiettivo `Tirolo`, 4 reparti assegnati via `frontId`.
- **Anteprima ordine** (`dryRun` su `attack`): righe PRIMA → DOPO *Pressione della
  parte* 43,2% → 51,7%, *Pressione nemica* 150% → 150%, *Perdite attese* 85% →
  125%, *Consumi di guerra* 120% → 180%; **nessuna scrittura** (confronto JSON
  prima/dopo identico).
- **Sei periodi da 30 giorni** (ordine `attack`):
  - pressioni 1,078 / 1,386 → 0,893 / 1,985 → 0,662 / 2,332 (collasso) → 0,297 /
    2,358 → 0,222 / 2,305 → 0,694 / 1,665 (forza dichiarata rimasta);
  - la 1ª Brigata scende da 12.000 a **11.001 → 9.039 → 6.329 → 3.085 → 2.005
    (distrutta)**; le altre tre a 11.321 → … → 2.510 (distrutte): i due numeri
    restano **congelati** nei periodi successivi, prova che un reparto distrutto
    non torna in vita;
  - prontezza 0,66 → 0,527 → 0,297 → 0,169 → 0 (distrutti);
  - **nessuna conquista** (l'Italia perde il fronte) e la provincia resta AUT:
    il difensore che vince **respinge** ma non avanza (limite dichiarato §22).
- **Consumi reali:** scorte ITA `cibo 10,476 → 8,856 · carburante 3,69 → 2,88 ·
  munizioni 2,8 → 0` (fabbisogno × fattore d'ordine × mesi), scaricate dal
  magazzino del material flow.
- **Attrito dichiarato:** `militaryPower` AUT `1.000 → 963 → 931 → 908 → 898 →
  891 → 868` (la stessa quota persa dai reparti).
- **Read model:** `counts { force 1 · army 2 · unit 14 · front 1 · facility 14 ·
  mine 4 }`; l'oggetto fronte porta `Attivo`, pressioni 69,4% / 166,5%, 4 reparti
  impegnati, teatro, obiettivo; sui reparti i fatti `Ordine` (`Attacca — Assalto:
  più pressione, più perdite, più consumi. Pressione ×1.35 · perdite ×1.25 ·
  consumi di guerra ×1.8.`) e `Fronte`, con le quattro mosse (`order_attack:false`
  perché già in attacco, le altre tre disponibili).
- **Determinismo:** due `advanceFronts(30, '2026-08-30')` consecutivi producono
  fronti **identici** (confronto JSON).

---

## 20. Quality gate e regressioni trovate (e risolte)

| Suite | Prima | Dopo |
|---|---|---|
| Backend | 158 file / 1519 test | **159 file / 1548 test** |
| Frontend | 67 file / 492 test | **67 file / 494 test** |
| E2E mock | 47 | **49** |
| Inventario endpoint | 104 | **106** |

Durante lo sviluppo il gate completo ha fatto emergere tre regressioni **reali**,
tutte risolte prima della PR:

1. **`stage2` / «WORLD-ALIVE P3»** — la conquista legacy spariva. Causa: il salto
   del tick legacy era **globale** (`hasPersistentMilitary`). Fix: controllo
   **per coppia** (`frontBetween`), §11.
2. **`map-features` (4 test)** — l'oggetto-armata della mappa cambiava forma
   durante una semplice avanzata. Causa: il tick del fronte riscriveva i reparti
   anche senza variazioni, e la `saveUnits` di PR1 riallinea gli oggetti-armata
   della mappa. Fix: lettura **pura** (`persistedUnits`/`persistedFronts`) e
   scrittura **solo se cambiato** (`JSON.stringify`), §9.
3. **Reparti distrutti che tornavano in vita** — trovata dalla sonda, non dai
   test. Fix: `sideUnits` filtra i distrutti (§13) + test 29 di regressione.

---

## 21. File toccati

**Nuovi (3):** `backend-nest/src/core/simulation/WarFronts.ts` (569 righe),
`backend-nest/src/game/WarFrontService.ts` (621), `backend-nest/tests/war-fronts.test.ts` (794).

**Modificati (backend, 9):** `core/simulation/OperationalState.ts` (+200),
`core/simulation/OperationalObjects.ts`, `game-session.ts` (+105),
`game/MilitaryService.ts`, `game/NpcTurnService.ts`,
`game/OperationalStateStore.ts`, `repositories/operational-object.repository.ts`,
`routes/games/helpers.ts`, `routes/games/state.routes.ts`; più
`tests/military-units.test.ts` e `docs/implementation/q02-endpoint-inventory.json`.

**Modificati (frontend, 8):** `services/api.ts`, `hooks/useNationSnapshot.ts`,
`components/Game/operationalObjects.ts`, `components/Game/ObjectsBoard.tsx`,
`components/Game/NationDock.tsx`, `components/Game/NationDock/types.ts`,
`components/Game/GameScreen.tsx`, `components/Shell/DeskContent.tsx`; più
`operationalObjects.test.ts`.

**Modificati (e2e, 2):** `e2e/mock-api.mjs`, `e2e/tests/op-objects.spec.mjs`.

Nessun file temporaneo, nessuna sonda, nessun preset toccato: `git status` pulito
a parte i file del pacchetto.

---

## 22. Limiti dichiarati

1. **Il difensore che vince non avanza.** Il motore calcola solo l'avanzata
   dell'**attaccante**: uno sfondamento difensivo produce `collapsed` (l'attacco
   si rompe) ma non inverte i ruoli, quindi un NPC che vince un fronte **non**
   conquista la provincia del giocatore. Conseguenza visibile nella sonda §19:
   l'Italia perde quattro brigate e la provincia resta austriaca. L'inversione
   dei ruoli (con `transferRegion` dal lato difensore) è materia di PR3.
2. **Nessuna ricostituzione automatica.** Un reparto distrutto resta distrutto:
   ricostituirlo richiede le azioni esistenti (crea reparto / rinforza). Non
   esiste «ripiega e riorganizza».
3. **Il ruolo del fronte è fissato alla nascita.** Se la situazione si ribalta,
   il fronte non «cambia verso»: diventa `collapsed` (o resta `active`).
4. **La forza dichiarata consumata dalla guerra non si rigenera alla pace.** Il
   fronte chiuso perde il suo stato e la `militaryPower` resta quella consumata
   (il `WorldStateEngine` continua a farla **decadere** lentamente in pace,
   `×0,9975/anno`). La ricostruzione post-bellica è materia di PR3.
5. **Reparti di un'armata che esce dalle province del giocatore.** Se una
   provincia viene conquistata da altri, l'oggetto-armata non è più un seed del
   paese e i suoi reparti escono dallo stato del giocatore (comportamento di PR1,
   non introdotto qui). La cattura/distruzione delle formazioni nemiche è materia
   di PR3.
6. **Nessun movimento strategico fra fronti.** Un reparto cambia fronte solo
   cambiando provincia (le azioni di PR1) o quando il mondo cambia il teatro: non
   esiste «marciare verso l'altro fronte».
7. **Il fronte è strategico e basta.** Nessuna profondità, nessun accerchiamento,
   nessuna aviazione, nessuna marina nel combattimento terrestre.

---

## 23. Cosa NON è stato fatto (per mandato)

- **Nessun merge** su `main` e **nessun deploy**: la specifica chiede la PR, non
  il rilascio.
- **Nessun wargame tattico**: nessuna mappa di battaglia, nessuna unità
  spazialmente posizionata, nessun ordine operativo oltre alle quattro mosse.
- **Nessun secondo motore**: `WorldStateEngine`, turn pipeline, playback,
  checkpoint, schema/db, economia e store Zustand **non toccati**.
- **Nessun numero deciso dall'LLM**: il provider non è mai chiamato dalle funzioni
  del fronte.
- **Nessuna migrazione**: `kind = 'front'` è additivo.

---

## 24. Proposte (PR3, non implementate)

1. **Inversione dei ruoli sul collasso**: chi vince un fronte difensivo diventa
   attaccante; l'avanzata passa sempre da `transferRegion` (chiude il limite 1).
2. **Ricostituzione dei reparti**: fusione di reparti decimati e ripiegamento con
   riorganizzazione (chiude il limite 2).
3. **Cattura delle formazioni**: le armate delle province perdute passano al
   vincitore come **quadri senza uomini** (coerente con «nessun uomo dal nulla»),
   invece di uscire dallo stato (chiude il limite 5).
4. **Rigenerazione post-bellica** della forza dichiarata, legata a spesa e
   coscrizione (chiude il limite 4).

---

## 25. Esito

- **PR aperta, non mergiata** (come richiesto).
- Test, tipi e build verdi su backend, frontend ed e2e mock; inventario endpoint
  rigenerato; nessun file temporaneo.
- Verifica **reale** su dati controllati (§19) con misure riportate: nessuna
  dichiarazione di verde non eseguita.
