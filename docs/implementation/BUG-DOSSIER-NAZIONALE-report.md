# BUG FIX — dossier nazionale vuoto dopo selezione di una regione esterna

## Causa

Nel modulo `nation` di `frontend/src/components/Shell/DeskContent.tsx`, sia
`NationDock` sia `DiplomacyPanel` erano subordinati a:

```tsx
selectedRegion && !externalRegionSelected
```

Con una provincia di un'altra polity selezionata, `externalRegionSelected`
diventava `true`; senza selezione, `selectedRegion` era `null`. In entrambi i
casi nessun componente veniva montato e sotto l'header del dossier restava un
body vuoto.

La derive in `nationalContext.ts` è corretta e non è stata modificata. I dati di
`NationDock` provengono già dalla polity del giocatore, non dalla provincia
selezionata.

## Fix

- `NationDock` viene renderizzato per ogni partita aperta, indipendentemente da
  `selectedRegion` ed `externalRegionSelected`.
- `DiplomacyPanel` conserva il comportamento precedente: viene mostrato solo
  con una provincia propria selezionata. Questo evita di ampliare il perimetro
  funzionale della correzione.
- Se il modulo viene raggiunto senza una partita, viene mostrato un
  `EmptyState` esplicito invece di un body vuoto.

Il dettaglio della provincia esterna resta nell'inspector dedicato. Non sono
stati modificati `MapContextSelection`, tooltip/inspector, `nationalContext.ts`,
`nationDossier.ts`, motore, endpoint, MAP P1–P6 o MILITARY P4–P6.

## Test

Aggiunto `frontend/src/components/Shell/DeskContent.test.tsx`, che verifica:

- nessuna provincia selezionata: `NationDock` presente;
- provincia esterna selezionata: `NationDock` presente con il
  `playerPolityId` del giocatore;
- provincia propria selezionata: dossier e diplomazia invariati;
- il modulo `nation` contiene sempre `NationDock` oppure `EmptyState`;
- senza partita: `EmptyState` presente e nessun pannello dipendente da
  `gameId`.

Il test di regressione fallisce sulla base `ca7f977` (3 failure su 5) e passa
con la correzione (5/5). I gate sono stati eseguiti in un worktree pulito basato
esclusivamente sul commit della fix, senza le modifiche locali escluse dal PR.

## Gate

| Gate | Esito |
|---|---|
| Frontend `npx tsc --noEmit` | ✅ |
| Frontend `npx vitest run` | ✅ 82 file, 665 test (664 passati, 1 skipped) |
| Frontend `npm run build` | ✅ |
| Backend `npx tsc --noEmit` | ✅ |
| Backend `npx vitest run` | ⚠️ 168/169 file; unica failure: timeout noto nel test 34 di `military-warfront-integrity.test.ts`, verde alla ri-esecuzione isolata |
| Backend `npm run build` | ✅ |
| Root `npm run test:e2e:mock` | ✅ 144 test |
| Root `npm run test:a11y` | ✅ 3 test |
| Root `npm run test:perf` | ✅ bundle entro baseline |

## Limiti

La correzione riguarda esclusivamente il gate di rendering del dossier. Non
cambia la derive dei dati nazionali né il comportamento dell'inspector della
mappa. `DiplomacyPanel` continua intenzionalmente a non comparire per una
provincia esterna; il dossier rimane comunque sempre popolato da `NationDock`.
La suite backend completa conserva una flaky preesistente per timeout; lo stesso
test passa isolatamente e non coinvolge file modificati da questa fix.
