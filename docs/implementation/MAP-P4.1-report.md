# MAP P4.1 — invalidate stale unit previews across map and nation dossier

**Stato**: completato · **Base**: `main = 421e0b7` · **Branch**: `fix/map-p4-1-stale-preview` · **PR aperta per review, nessun merge automatico.**

## 1. Bug corretto

MAP P4 aveva reso sicura la preview PRIMA → DOPO del reparto nel **context inspector della mappa** passando a `UnitActionPanel` uno `snapshotKey` canonico (`gameId · turno · data · worldRevision · headBranchId`), con reset dell'anteprima al cambio (`React.useEffect(() => reset(), [object, picture, snapshotKey, reset])`).

Il **secondo** punto d'uso dello stesso pannello — `GameScreen → DeskContent → NationDock → ObjectsBoard → ObjectCard → UnitActionPanel` (Nazione → Armamenti → Sala di governo) — montava il pannello **senza** `snapshotKey`.

Conseguenza misurata (non ipotizzata): dopo rewind/restore/cambio turno-data-revisione-ramo, la preview già aperta nella sala di governo restava **visibile e confermabile** finché l'Operating Picture non tornava dal motore. La misura, con l'arsenale ritardato di proposito, è: preview ancora presente per tutta la finestra (×14 poll consecutivi, oltre 5 s) e svuotata solo all'arrivo del nuovo read model. Nella mappa lo stesso cambio la invalidava subito.

Nessuna regola di simulazione è stata aggiunta, nessun endpoint toccato, nessuno stato persistente nuovo.

## 2. Una sola nozione di snapshot

La formula, prima duplicabile, ora vive in **un unico punto puro**:

```ts
// frontend/src/components/Game/actionSnapshot.ts
export function actionSnapshotKey(game: ActionSnapshotSource | null | undefined): string {
  return [
    game?.id ?? '', game?.currentTurn ?? 0, game?.currentDate ?? '',
    game?.worldRevision ?? 0, game?.headBranchId ?? '',
  ].join(':');
}
```

Stessa semantica e stessa forma di MAP P4 (`''`/`0` per i campi assenti). `GameScreen` la calcola **una volta** e la distribuisce ai due percorsi: nessun timestamp locale, nessun contatore, nessuna revisione parallela della UI, nessuna seconda formula nel componente (asserito da test).

## 3. Propagazione (solo dove serve)

```
GameScreen                 snapshotKey = actionSnapshotKey(currentGame)
  ├─ ProvinceInspector     snapshotKey={snapshotKey}      (MAP P4, invariato)
  └─ DeskContent           snapshotKey?: string
       └─ NationDock       NationDockProps.snapshotKey?: string   (types.ts)
            └─ ObjectsBoard ObjectsBoardProps.snapshotKey?: string
                 └─ ObjectCard (prop interna)
                      └─ UnitActionPanel snapshotKey={snapshotKey}
```

- `DeskContent` e `NationDock`/`ObjectsBoard` ricevono una prop **opzionale**: senza valore il pannello si comporta come prima (nessuna rottura per altri consumatori).
- `UnitActionPanel` **non è stato modificato**: la prop e l'effect di reset esistevano già, sono stati riusati.
- Nessuna nuova cache, nessun `useEffect` parallelo, nessun polling, nessun confronto deep, nessuna logica stale-state alternativa.

## 4. Test aggiunti

### Unitari — `frontend/src/components/Game/actionSnapshot.test.ts` (9 test)
- forma e ordine della chiave (`g1:4:1951-02-01:5:branch-live`);
- stabilità: lo stesso snapshot produce sempre la stessa chiave;
- sensibilità: **uno qualsiasi** dei cinque campi cambia la chiave (partita, turno, data, revisione, ramo);
- rewind/restore con turno e ramo precedenti ≠ stato attuale;
- assenza di partita: chiave canonica `:0::0:`, nessun valore inventato;
- propagazione verificata lungo **tutta** la catena (GameScreen → ProvinceInspector + DeskContent → NationDock → ObjectsBoard → `UnitActionPanel`), incluso il divieto di una seconda formula locale.

### E2E — `e2e/tests/map-p4-gameplay.spec.mjs`, scenario **MAP P4.1 / S** (percorso dossier nazionale)
- **A** — anteprima valida: dry-run del motore (`dryRun:true`) e **Conferma** disponibile;
- **B** — cambio snapshot (`currentTurn`, `currentDate`, `worldRevision`, `headBranchId`) con Operating Picture **ferma** (richiesta in volo, delay 12 s): la preview PRIMA → DOPO **sparisce** entro 5 s, la **Conferma sparisce**, il pannello resta agganciato allo stesso reparto, il read model mostra ancora il quadro precedente (`quadro 1`) e **nessuna** mutazione `dryRun:false` è partita; serve una nuova Anteprima;
- **C** — stesso `unit.id`, nuovo Operating Picture (`quadro 2`): la preview richiesta nel frattempo resta invalidata all'arrivo del read model; due dry-run in totale, zero conferme.

**Il test è discriminante, verificato per regressione**: rimuovendo il solo hop finale `snapshotKey={snapshotKey}` da `ObjectsBoard`, lo scenario S fallisce alla riga 486 (`toHaveCount(0)` con la preview ancora presente 14 volte di fila nella finestra), e torna verde ripristinando la prop. È questa la prova che il residuo esisteva e che la fix lo chiude.

Nota di robustezza: il marcatore `quadro N` distingue due Operating Picture con lo **stesso** ID, così la sparizione della preview non può essere attribuita al cambio di `picture`.

## 5. Gate

| Gate | Esito |
|---|---|
| `frontend: npx tsc --noEmit` | ✅ pulito |
| `frontend: vitest run` | ✅ **73 file / 568 test** (+1 file, +9 test) |
| `frontend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **104/104** (103 + scenario S) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2.22 MB** entro baseline |
| Backend (0 file modificati) | ✅ `tsc`/`build` · **1714/1714** |

Nessun test fallito in nessun gate. Le suite MAP P1 · MAP P2/P2.1/P2.2 · MAP P3/P3.1 · MAP P4 · MILITARY restano verdi.

## 6. File modificati

| File | Modifica |
|---|---|
| `frontend/src/components/Game/actionSnapshot.ts` | **nuovo** — `actionSnapshotKey()` puro |
| `frontend/src/components/Game/actionSnapshot.test.ts` | **nuovo** — 9 test (chiave + propagazione) |
| `frontend/src/components/Game/GameScreen.tsx` | usa l'helper; stessa chiave a inspector e `DeskContent` |
| `frontend/src/components/Shell/DeskContent.tsx` | prop `snapshotKey` → `NationDock` |
| `frontend/src/components/Game/NationDock/types.ts` | contratto `snapshotKey?: string` |
| `frontend/src/components/Game/NationDock.tsx` | inoltro a `ObjectsBoard` |
| `frontend/src/components/Game/ObjectsBoard.tsx` | prop `snapshotKey` → `ObjectCard` → `UnitActionPanel` |
| `e2e/tests/map-p4-gameplay.spec.mjs` | scenario S + fixture `pictureEpoch`/`forceRoot`/`arsenalDelay` |

## 7. Criteri di accettazione

- `ObjectsBoard` riceve lo snapshotKey canonico ✅
- `UnitActionPanel` riceve la **stessa** identità snapshot nei due percorsi (mappa + dossier nazione) ✅
- la preview stale **sparisce** al cambio snapshot ✅ (E2E S/B)
- la preview stale **non è confermabile** ✅ (nessuna `dryRun:false`, Conferma assente)
- nessun bypass di mutazione diretta ✅ (preview → conferma sempre dallo stesso endpoint)
- **nessuna modifica backend**, nessuna modifica alla simulazione ✅ (0 file in `backend-nest`)
- nessun secondo meccanismo stale-state, nessun grande refactor ✅
- MAP P1–P4 e MILITARY P4–P6 invariati ✅
