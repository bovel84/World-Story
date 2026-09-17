# HOTFIX — HUD mobile e vicini geografici

Due bug segnalati dal giocatore, corretti con modifiche piccole e localizzate.
Base: `main` = `5ee9407`. Branch: `fix/hud-mobile-and-neighbour-geo`.

Classificazione: **BUG A = A** (CSS/presentazione), **BUG B = B** (read model
derivato da dati già prodotti dal motore). Nessuna modifica **E**, nessuna
migrazione.

---

## 1. Problemi trovati (causa reale)

### BUG A — Il pulsante impostazioni copriva il badge del turno (HUD mobile)
In `frontend/src/components/Game/HudBar.tsx` la colonna sinistra `.hud-left`
contiene **tre** controlli: menu `☰`, toggle dispacci `▤` e il pulsante
impostazioni `⚙` (reso da `Shell/GameMenu.tsx`, classe `hud-icon-btn`).

In `frontend/src/index.css`, `@media (max-width: 480px)`, la barra era una
griglia `grid-template-columns: 76px 62px minmax(0, 1fr)`: i 76px della prima
colonna bastavano per **due** icone (36 + 34 + gap ≈ 72), non per tre. Il
pulsante `⚙` (36px), aggiunto in seguito, **usciva dalla colonna** e finiva
sopra `.hud-center` (la colonna da 62px del badge).

Misura reale nel browser (mock, viewport 412px), prima della correzione:

| Elemento | x iniziale | x finale | Nota |
|---|---|---|---|
| `.hud-left` (colonna) | 6 | 82 | 76px |
| `.game-menu-btn` (⚙) | 80 | 116 | **esce dalla colonna** |
| `.hud-turn-badge` | 85 | 147 | **coperto dal ⚙** |

Non era `position: absolute` né un overlay: era una **colonna a larghezza fissa
che non teneva conto del terzo pulsante**. Il badge restava leggibile solo come
numero compresso, esattamente come nella segnalazione.

### BUG B — «Sfida estera: Finland si riarma» con l'Albania
In `backend-nest/src/game/NationStateService.ts`, `pressureNeighbours()`
iterava **tutti** i polity del mondo, sommava la potenza militare delle loro
regioni e restituiva i primi 8 per potenza, **senza verificare l'adiacenza**:

```ts
for (const region of this.ctx.regions().values()) {
  const owner = region.owner;
  if (!owner || owner === 'neutral' || owner === playerPolityId) continue;
  power.set(owner, (power.get(owner) || 0) + (Number(region.militaryPower) || 0));
}
return [...power.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)…
```

La Finlandia, potenza militare alta, entrava tra i primi 8 e diventava il
«vicino» dell'Albania. Il dato di adiacenza esiste già: `RegionState.borders`
(`backend-nest/src/core/simulation/types.ts`), popolato da `computeBorders`
(`backend-nest/src/utils/borders.ts`) e caricato in sessione da
`SessionBootstrapService` (`borders: region.borders`).

---

## 2. Correzioni applicate

### BUG A — Griglia mobile che rispetta il contenuto (classe A)
In `frontend/src/index.css`, blocco `@media (max-width: 480px)`:

- `.hud-bar` passa a `grid-template-columns: auto auto minmax(0, 1fr)`: la
  colonna sinistra e quella del badge si dimensionano sul **contenuto**, quindi
  nessun controllo può uscire dal proprio riquadro; la terza colonna (destra)
  assorbe lo spazio rimanente.
- Controlli leggermente più compatti (icone 34px, dispacci 32px) e badge con
  `min-width: 52px`, così le tre icone + il badge convivono da 360px in su.
- `@media (max-width: 370px)`: cede spazio solo il toggle dispacci dell'HUD
  (resta comunque accessibile dalla rail moduli in basso) e «Avanza» scende a
  64px. Menu e impostazioni restano nella barra.

Nessun cambio di semantica: gli stessi pulsanti, gli stessi handler
(`onBack`, `onOpenDispatches`, `onTimeSkip`, timeline). Solo layout.

Misura reale dopo la correzione (mock, nessuna sovrapposizione):

| Larghezza | `.hud-left` | Badge `TURNO 1` | Sovrapposizioni |
|---|---|---|---|
| 360px | 6–78 | 82–134 | nessuna |
| 393px | 6–114 | 118–170 | nessuna |
| 412px | 6–114 | 118–170 | nessuna |
| 430px | 6–118 | 118–170 | nessuna |
| 1280px (desktop) | invariato | invariato | nessuna |

### BUG B — Vicini per adiacenza reale (classe B)
`NationStateService.pressureNeighbours()` ora:

1. raccoglie i **polity confinanti**: per ogni regione del giocatore, scorre
   `region.borders` e guarda l'`owner` della regione adiacente, escludendo
   `neutral`, il giocatore stesso e gli owner assenti;
2. se non ci sono vicini reali restituisce **lista vuota** (nessun polity
   lontano inventato);
3. calcola la potenza militare **solo** su quei vicini, ordina come prima
   (potenza decrescente) e mantiene il limite a 8.

`NationStateRegion` (`src/game/NationStateService.ts`) espone ora
`borders?: string[]` — campo opzionale già presente a runtime su `RegionState`:
nessuna modifica a `GameSession` né ai repository.

Effetto: la Finlandia (potenza lontana) non compare più; i vicini reali, anche
deboli, restano. Le pressioni esterne che richiedono un vicino (`neighbour-
buildup`, `border-incident`, …) si generano solo con vicini reali.

### Test aggiornati (classe A)
`backend-nest/tests/player-levers.test.ts`: il mondo di prova creato a mano
**non impostava `borders`**; le regioni reali generate da `computeBorders` lo
hanno sempre. Aggiunti i confini tra Italia/Francia/Austria, così il fixture
riflette un mondo reale e le pressioni esterne tornano a generarsi.

---

## 3. File modificati

**Modificati**
- `frontend/src/index.css` — griglia HUD mobile ≤480px e ≤370px (BUG A).
- `backend-nest/src/game/NationStateService.ts` — `pressureNeighbours()` per
  adiacenza + `borders?` su `NationStateRegion` (BUG B).
- `backend-nest/tests/nation-state-service.test.ts` — 7 test sui vicini.
- `backend-nest/tests/player-levers.test.ts` — fixture con `borders` reali.

**Aggiunti**
- `frontend/src/components/Game/hudMobileLayout.test.ts` — invarianti di
  struttura HUD (markup + CSS ≤480px).
- `e2e/tests/hud-mobile.spec.mjs` — guardia geometrica reale: a 360/393/412/430px
  nessun controllo dell'HUD si sovrappone al badge e tutto resta nella barra.
- `docs/implementation/HOTFIX-hud-mobile-neighbours.md` — questo report.

---

## 4. Conferma CORE ENGINE FREEZE

**Il motore è rimasto congelato.** Nessuna modifica a
`backend-nest/src/core/simulation/**` (in particolare `PeacetimePressures.ts` è
intatto), `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/database, `repositories`, semantica dei checkpoint,
simulation run, `useSimulationPlayback`, pipeline di avanzamento del tempo.

BUG B è corretto **solo nel read model** (`src/game/NationStateService.ts`), che
costruisce l'input `PressureSnapshot.neighbours` per il motore. Nessun nuovo
stato di gioco, nessuna migrazione.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `backend-nest` `vitest run` | **1104 passed / 129 file** |
| `frontend` `vitest run` | **282 passed / 47 file** |
| `tsc --noEmit` frontend | **0 errori** |
| `tsc --noEmit` backend | **0 errori** |
| `npm run build` (frontend + backend) | **OK** |
| `e2e` `playwright test` (mock) | **21 passed** (4 nuovi + 17 esistenti) |
| `e2e` `playwright test --config=playwright.a11y.config.mjs` | **3 passed** |
| `npm run test:perf` | **OK** (bundle entro la baseline) |

Test mirati BUG B (`nation-state-service.test.ts`, describe «vicini delle
pressioni esterne»):
- Albania + vicini reali (ITA forte, GRE debole) + Finlandia lontana → solo
  `ITA`, `GRE`, **mai** `FIN`;
- il vicino reale debole compare comunque;
- potenza lontana fortissima assente;
- potenza aggregata delle regioni dello stesso vicino;
- giocatore isolato → lista vuota;
- `neutral` e owner senza regioni ignorati;
- dati legacy senza adiacenza → lista vuota;
- limite a 8 mantenuto, dal più armato.

Test mirati BUG A: `e2e/tests/hud-mobile.spec.mjs` (misura dei rettangoli reali)
e `hudMobileLayout.test.ts` (struttura e regole ≤480px).

---

## 6. Limiti residui

- **Mondi legacy senza adiacenza.** Il mondo della partita segnalata
  (`world_id` `1a11bac44310`, 4475 regioni) ha **tutte** le regioni con
  `borders = []` (generato prima che i confini venissero persistiti). Per quei
  mondi `pressureNeighbours()` restituisce lista vuota: **nessuna sfida estera
  che richiede un vicino**, invece di una falsa (Finlandia per l'Albania). È il
  fallback scelto e non reintroduce il bug; per riavere le sfide esterne serve
  un **backfill dei confini** (rigenerazione/`computeBorders`), che è una
  migrazione di dati fuori dallo scope di questo hotfix.
- Le pressioni esterne **già registrate** nel salvataggio restano finché non
  scadono o vengono risolte: la correzione agisce sulla generazione, non
  riscrive lo storico.
- A 768/1024px la HUD desktop usa ancora il centro centrato in assoluto: con un
  nome del mondo molto lungo può sovrapporsi ai controlli. È un comportamento
  **preesistente e fuori dallo scope** (mobile 360–430px); il desktop a 1280px è
  invariato.
- La correzione HUD è solo CSS: non introduce nuovi pulsanti né cambia i
  comportamenti esistenti.
