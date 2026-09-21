# MAP P4 — map-first contextual gameplay

Stato: **completato** · PR dedicata aperta per review, nessun merge automatico.

Baseline: `main` = `d61bc8b` (include MAP P1–P1.2, MAP P2–P2.2, MAP P3/P3.1 e
MILITARY P4–P6).

## 1. Obiettivo

La mappa diventa il punto di ingresso reale al gameplay:

```text
MAP CLICK → context selection → engine read model → existing dryRun
         → preview → confirm → canonical refresh → map reflects new state
```

La mappa **non** diventa un motore. Nessuna regola di simulazione vive nel
frontend.

## 2. Context authority

La selezione conserva **soltanto identità canoniche**, mai copie di oggetti:

```ts
type MapContextSelection =
  | { kind: 'region'; regionId: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'front'; frontId: string }
  | null;
```

- `region.id`, `unit.id`, `front.id` sono l'unica chiave. Mai array index, mai
  nome visualizzato.
- `frontend/src/components/Map/mapContext.ts` costruisce **indici memoizzati**
  (`unitsById`, `frontsById`, `unitsByRegion`, `frontsByRegion`, `unitsByFront`)
  e risolve l'ID contro lo snapshot corrente: `resolveMapContext()` restituisce
  `null` per un oggetto assente, `destroyed` o fronte `closed`.
- La selezione è **ID-only**: nessuno snapshot del reparto viene salvato nella
  selection, quindi rewind/restore/refresh non possono mostrare dati stale.

`GameScreen` è l'unico owner (`mapContextSelection` + `mapFocusRequest`);
`MilitaryStateOverlay` smette di aprire un secondo dettaglio quando riceve
`onSelectUnit`/`onSelectFront` (fallback P2 conservato quando i callback mancano).

## 3. Mutation authority

Tutte le mutazioni riusano gli endpoint esistenti:

| Azione | Endpoint | Preview |
|---|---|---|
| `reinforce`/`reequip`/`reconstitute`/`transfer`/`reassign` | `POST /military/units/:id/<action>` | `dryRun: true` |
| `attack`/`defend`/`reserve`/`withdraw` | `POST /military/units/:id/order` | `dryRun: true` |

Sequenza obbligatoria e verificata: `choose → dryRun → PRIMA/DOPO → Conferma →
stesso payload con dryRun:false`. Nessuna confirm diretta, nessuna optimistic
mutation: dopo la conferma si ricaricano arsenale, conto nazionale e stato
militare canonico (`refreshMilitaryState()`).

## 4. Ownership

```ts
unit.polityId === playerPolityId   // authority del reparto
```

Mai `region.owner`. Un reparto AUT dentro territorio conquistato da HUN resta
AUT: se AUT non è il player, l'inspector è **read-only** e nessun pannello
azioni viene montato (E2E J). Il backend `unit_forbidden`/HTTP 403 resta la
seconda linea di difesa, invariato.

## 5. Azioni e disponibilità

- Fonte unica: `OperatingObjectPayload.actions` pubblicato dal motore
  (`enabled`/`blockedReason`). Nessuna soglia sintetizzata nel client.
- Join canonico **per ID esatto e `kind === 'unit'`** (`operatingObjectForUnit`).
- Se l'Operating Object non esiste → dettaglio read-only, nessuna action list
  inventata (requisito #27).
- Per un NPC non si chiama nemmeno il dryRun: il dettaglio resta informativo.

## 6. Un solo pannello azioni (no duplicazione)

`UnitActionPanel` + `ActionImpact` sono stati **estratti** in
`frontend/src/components/Game/UnitActionPanel.tsx` e usati sia da `ObjectsBoard`
sia dal context inspector. La logica pura (`unitActionView`, `unitOrderView`,
`regionTargets`, `armyTargets`, `actionsOf`) è riusata così com'è.

Rafforzamenti P4 nel pannello condiviso:

- il comando che ha prodotto il dry-run viene **conservato** e la conferma
  riusa esattamente quello (`confirmedUnitPanelCommand`), non lo ricostruisce;
- **lock sincrono** (`inFlight`) contro il doppio submit: due click nello stesso
  frame non generano due richieste;
- preview invalidata su cambio `snapshotKey` (turno/data/revisione/ramo), su
  cambio azione/destinazione, su cambio Operating Picture, su smontaggio;
- una conferma `applied: false`/rifiutata **cancella la preview** e mostra il
  motivo: niente retry su uno snapshot precedente.

## 7. Fronte: contesto, non oggetto di comando

Il fronte apre un dettaglio con attaccante, difensore, obiettivo, pressioni,
iniziativa, teatro e reparti **separati per ruolo** (attaccante/difensore/altri),
senza classificazioni inventate. Non esiste alcun comando front-wide: gli ordini
si impartiscono al singolo reparto (E2E I).

I reparti in trasferimento restano visibili ma dichiarati *fuori combattimento*;
la loro esclusione dagli effettivi attivi del fronte resta quella di P2.

## 8. Refresh & stale state

- Nessuna mutazione ottimistica militare.
- Una preview aperta non è confermabile dopo un cambio di snapshot.
- Unità scomparsa/distrutta o fronte chiuso → il contesto si chiude (o degrada al
  territorio); l'ID viene ribindato alla risposta canonica successiva.
- Rewind/checkpoint restore: il contenuto è ricostruito dal nuovo canonical state
  (E2E L).
- `useNationSnapshot` conserva il valore `applied` pubblicato dal server (non lo
  forza più a `true`) e un **epoch di snapshot** impedisce a refresh
  post-mutation iniziati in un turno/ramo precedente di pubblicare dati nel
  successivo.

## 9. Cross-navigation e breadcrumb

`region → unit`, `region → front`, `unit → region`, `unit → front`,
`front → unit`, `front → objective` sono bottoni reali; breadcrumb minimo
(regione › fronte › reparto) senza router nuovo. Aprire/chiudere l'inspector
**non** muove la camera: solo i comandi espliciti «Centra…» emettono una
`focusRegionRequest` numerata.

## 10. Desktop e mobile

L'inspector è l'unico dossier contestuale e vive nel desk dello shell:
desktop a colonna da 400px, tablet come sheet laterale, mobile come bottom sheet
(eredità di `GameShell`). Requisiti verificati a 360×740 e 430×932: mappa
ancora visibile, sheet scrollabile, target ≥ 44px per le azioni, confirm
raggiungibile, nessun overflow orizzontale, una sola catena contestuale.

## 11. Accessibilità

- Counter e badge fronte sono `<button>` nativi: Enter/Space aprono il contesto
  (E2E B e G usano tastiera).
- L'inspector ha `role="region"` con `aria-labelledby` sull'heading `h2` (che
  riceve il focus all'apertura) e chiude con Escape; alla chiusura il focus torna
  al trigger.
- La tabella PRIMA → DOPO usa `th scope` e un `caption` visivamente nascosto:
  resta leggibile anche senza colore.

## 12. File

Nuovi:

```text
frontend/src/components/Map/mapContext.ts
frontend/src/components/Map/mapContext.test.ts
frontend/src/components/Game/UnitActionPanel.tsx
frontend/src/components/Game/UnitActionPanel.test.tsx
e2e/tests/map-p4-gameplay.spec.mjs
```

Modificati (frontend/solo presentazione):

```text
frontend/src/components/Game/GameScreen.tsx
frontend/src/components/Game/GameMap.tsx
frontend/src/components/Game/ObjectsBoard.tsx
frontend/src/components/Map/MapboxMapView.tsx
frontend/src/components/Map/MilitaryStateOverlay.tsx
frontend/src/components/Shell/ProvinceInspector.tsx
frontend/src/components/Shell/ProvinceInspector.css
frontend/src/hooks/useNationSnapshot.ts
frontend/src/index.css
```

Test E2E aggiornati per la nuova superficie contestuale unica:
`e2e/tests/map-p1.spec.mjs`, `e2e/tests/map-live.spec.mjs`,
`e2e/tests/map-p2-military.spec.mjs` (stesse verifiche, selettore del dossier).

**Nessun file backend modificato.**

## 13. Test

Unitari frontend (nuovi): risoluzione ID region/unit/front, `null` per
assente/distrutto/chiuso, focus geografico derivato, ownership per `polityId`
anche su territorio conquistato, join Operating Object per ID+kind, payload
esatto dryRun/confirm per azioni e ordini, nessun calcolo di path/ETA, azioni
solo dal motore con motivi bloccati.

E2E `map-p4-gameplay.spec.mjs` (18 scenari):
A click territorio · B reparto player (tastiera) · C NPC read-only · D dry-run
senza mutazione · E confirm `dryRun:false` + refresh · F transfer P6 (rotta
server, nessun teleport) · G fronte→reparto (tastiera) · H ordine di reparto ·
I nessun comando front-wide · J authority dopo conquista · K preview stale
invalidata · L rewind rebind · M unità rimossa · N mobile 360/430 · O layer
invariato · P cambio snapshot durante refresh · Q lock doppio submit · R confirm
non applicato.

## 14. Gate

| Gate | Esito |
|---|---|
| Frontend `tsc` | ✅ |
| Frontend `vitest` | ✅ **72 file / 559 test** |
| Frontend `build` | ✅ |
| E2E mock | ✅ **103/103** (85 + 18 P4) |
| a11y | ✅ 3/3 |
| perf | ✅ 2.22 MB entro baseline |
| Backend | **invariato** — `tsc`/`build` ✅ · `vitest` **1711/1711** |

## 15. Conferme finali

- **map selection stores IDs, not snapshots**
- **unit authority = unit.polityId**
- **NPC units remain read-only**
- **front has no invented front-wide commands**
- **all mutations reuse existing engine endpoints**
- **all mutations use dryRun before confirmation**
- **UnitActionPanel logic is reused, not duplicated**
- **P6 route/ETA are server-published**
- **no optimistic military mutation**
- **rewind/restore rebinds selection to canonical state**
- **MAP P1–P3 remain intact**
- **MILITARY P4–P6 remain intact**
- **no backend simulation changes**
- **no large refactor**

## 16. Fuori scope (invariato)

Nessun drag-and-drop, movimento per trascinamento, disegno di fronti, supply
lines, accerchiamento, fortificazioni, ferrovie, comandi aerei/navali nuovi,
geografia delle risorse, targeting di costruzione, azioni diplomatiche,
politica economica dalla mappa, fog of war, AI strategica, command wheel,
selezione multipla o box selection.
