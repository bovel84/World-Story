# MILITARY P4 — UNITÀ NPC PERSISTENTI E SIMMETRIA PLAYER/NPC

Base `main = 30b12be`. Ramo `feat/military-p4-npc-units`.
Blocco PR1–PR3 (MilitaryUnit player, WarFront, supply del periodo, consumi,
contrattacco bidirezionale, avanzata territoriale, rally, ricostituzione
atomica, cache recovery, save/rewind/branch, 30/90/180) **non riaperto**.

## 1. L'asimmetria iniziale

L'NPC combatteva con `region.militaryPower` aggregato: nessun reparto, nessun
consumo per ordine, perdite solo sulla potenza dichiarata, nessun rally. Il
giocatore aveva `MilitaryUnitState[]`. P4 dà all'NPC gli **stessi** reparti, lo
**stesso** `WarFront` e le **stesse** regole — senza un secondo motore.

## 2. `polityId`: la nuova authority

`MilitaryUnitState.polityId` è l'**appartenenza nazionale**: la provincia dice
*dove* sta il reparto, `polityId` dice *a chi appartiene*. Prima la nazionalità
si **deduceva** dall'owner corrente della provincia: una conquista trasformava in
«nazionale di chi conquista» un reparto che combatteva lì.

- `WarFrontService.unitPolityId()` → `unit.polityId`, con fallback **solo** per
  righe legacy senza campo (mai l'owner della provincia);
- `normalizeUnitState(raw, fallbackPolityId)` per i save PR1–PR3 → `polityId =
  polity giocante`; id storici del giocatore invariati;
- costruttori aggiornati (`emptyUnit`, `materializeUnitsForArmy`, percorso
  `raiseFormation`);
- id NPC con namespace non collidente `npc-${polity}-unit-NNN`, contenitore
  `npc-${polity}-army-${regionId}` (nessuna gerarchia HQ).

## 3. Isolamento del giocatore (e l'invariante critica del replace)

- selector per polity: `unitsForPolity`, `militaryNeedsForPolity`,
  `baseMilitaryNeedsForPolity`; `militaryNeedsOf` filtra per polity;
- `loadState` riconcilia **solo** i reparti con un'armata viva del giocatore e
  **preserva** ogni altro reparto (polity diverse **e** reparti la cui armata
  non è più fra gli oggetti del giocatore);
- **`saveUnits` usa `replaceKind('unit')`**: `items` deve essere l'insieme
  **globale**. L'aggregato delle armate si calcola solo sui reparti del
  giocatore. Un'azione del giocatore non cancella le unità NPC (test 6).

## 4. Materializzazione lazy (seed = conversione, non produzione)

`materializeNpcMilitary(...)` (pura, idempotente):

| aspetto | regola |
|---|---|
| formazioni | `account.forces` (stessa sorgente del percorso legacy) |
| uomini | `militaryManpower().menPerFormation × formazioni` (somma **esatta**) |
| fabbisogni | `monthlyNeedsPerFormation(epoch)` |
| geometria | distribuzione deterministica per peso `region.militaryPower` (pavimento 1, riparto a maggior resto, priorità al teatro), **mai** `regionId = null` |
| equipaggiamento | `transferEquipment` dal **deposito** della polity (conservazione `deposito + assegnato`), mai inventato; senza pezzi il reparto resta non operativo |
| idempotenza | seconda chiamata ⇒ **0** nuove unità |
| no resurrection | reparti tutti `destroyed` ⇒ nessuna ricreazione da `account.forces` |
| persistenza | una sola transazione (`militaryPersistenceRepository.materializeUnits`, `kind='unit'` + depositi), cache adottata **dopo** il commit |

`ensureNpcUnits()` è chiamato **dopo** `syncFronts()` (pipeline del substep in
`beforeMaterialPeriod`, e nel percorso live/playback dentro `advanceFronts`),
solo per le polity di un **fronte aperto** (chi è in pace resta legacy), e
**fuori** da `hasPersistentMilitary()` (che resta lettura pura).

## 5. Ordini e consumi

- ordini NPC dal `npcFrontOrder()` **esistente**, per fronte, scritti su
  `MilitaryUnit.order` (helper `npcOrdersFor` condiviso con `planPeriod`: un solo
  punto di decisione). Lo **stesso** ordine è letto da `orderConsumptionFactor`,
  `frontSideStrength`, `sideHasOffensiveIntent`, `resolveFront`;
- fabbisogni: `militaryNeedsForPolity` = Σ `monthlyNeeds` × fattore d'ordine
  (**period**) e base senza fattore (**structural**) → `advanceStock` riceve
  `militaryOverride { period, structural }`: l'attacco consuma di più ma **non**
  gonfia la capacità del magazzino;
- priorità per polity: **player → overlay** · **NPC con reparti → fabbisogni dei
  reparti** · **NPC senza → legacy × legacyWarConsumptionFactor**: mai
  `persistent + legacy` nello stesso periodo (no double counting).

## 6. Combattimento, perdite, ritirata, rally

L'NPC passa da `resolveFront()` (nessun `resolveNpcFront`, nessun
`npcBattle`): perdite reali su `personnel`/`equipment`/`readiness`/`status`,
ritirata con `retreatRegionFor`, rally dopo ≥ 30 giorni **in territorio della
propria polity** (`region.owner === unit.polityId`), senza cure e senza
reconstitution (P5).

## 7. Read model

- le **schede reparto** del quadro operativo sono quelle del **giocatore**
  (`unit.polityId === polityId`), con un filtro **sulle schede**, non sull'ingresso:
  il fronte deve vedere entrambe le parti;
- il fronte espone due fatti «Reparti persistenti · `<polity>`» (lato attaccante
  storico e lato difensore) con conteggio e **ordini per fronte** (es.
  «2 attacco · 1 difesa»), e dichiara quando una parte combatte con la sola
  forza dichiarata. Nessun pulsante NPC, nessuna azione finta, nessun secondo
  pannello.

## 8. Test

`tests/military-p4-npc-units.test.ts` (mondo dedicato, 12 test):

| # | caso |
|---|---|
| 1 | `polityId` è l'authority: una conquista **non** cambia la nazionalità |
| 2 | materializzazione lazy e idempotente (pace → 0, fronte → >0, stessi id) |
| 3 | nessuna resurrezione dopo `destroyed` |
| 4 | conservazione: uomini = `menPerFormation × formations`; pezzi solo dal deposito (`deposito + assegnato` invariato) |
| 5 | isolamento: fabbisogni e aggregato armate non vedono le unità NPC |
| 6 | un'azione del giocatore **non** cancella le unità NPC (set globale) |
| 7 | consumi dagli **ordini** (`period` vs `structural`) |
| 8 | combattimento via `resolveFront` con perdite reali sui reparti NPC |
| 9 | persistenza (checkpoint) e rewind |
| 10 | `90 = 3 × 30` sui reparti NPC |
| 11 | fronte **NPC–NPC** senza il giocatore in guerra |
| 12 | determinismo (due sync identiche) — guardia |

**Magneticità**: con il solo `src` di `30b12be` **11 test su 12 falliscono**
(resta verde il 12, guardia di determinismo). Verifica eseguita con
`git checkout 30b12be -- backend-nest/src` e ripristino.

Test PR3/PR86 riallineati alla semantica P4 (l'NPC ha reparti persistenti):
`war-fronts` 16 (fabbisogno del giocatore sui **suoi** reparti), 19 (invariante
di **non gratuità** della conquista), 35 (bug reale corretto: reparto senza
armata non più perso al reload), `military-warfront-integrity` 50 (fabbisogno
NPC dai suoi reparti), 59 (**timeout esplicito 60 s**: era un timeout, non
un'asserzione — snapshot identici), 68 (equivalenza sui fatti).

## 9. Quality gate

| Comando | Esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npx vitest run` | ✅ **161 file / 1656 test** (il rosso `industrial-capacity-service` è il flaky preesistente: verde al rerun) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` / `vitest` / `build` | ✅ |
| `npm run test:e2e:mock` | ✅ 49 passed |

## 10. Limiti dichiarati

- **stock materiale NPC** può differire di poco fra un salto lungo e turni
  spezzati (materializzazione lazy dentro il substep): restano congelati
  proprietari, fronti, reparti e stock del giocatore;
- nessuna **reconstitution** NPC (P5): un reparto NPC indebolito resta indebolito;
- nessuna **simmetria di arsenale**: l'NPC usa il deposito seminato dal gioco e
  non ne produce di nuovo;
- fuori ambito P5+: reserve addestrata NPC, reinforce/reequip automatici,
  mobilitazione, accerchiamento, supply lines geografiche, movement time,
  fortificazioni, aria/marina, anfibi, HQ di fronte.
