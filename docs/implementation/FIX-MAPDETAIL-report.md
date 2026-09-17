# FIX-MAPDETAIL — «Non riesco a scegliere il livello mappa» nel preset editor

Branch: `fix/preset-map-detail-selectable` · Base: `main` = `969d175`.
Tipo di intervento: **correzione di presentazione/abilitazione** (classe A), il
più possibile localizzata. Nessuna nuova dipendenza.

---

## 1. Problema trovato (causa reale)

Nel tab **«Mappa»** del preset editor i tre livelli di dettaglio (Solo nazioni /
Regioni raggruppate / Massimo dettaglio) apparivano **tutti grigi e non
selezionabili**, compreso quello che la nota dichiarava disponibile.

Causa confermata sul codice, in
`frontend/src/components/Game/PresetEditorModal.tsx` (riga 370):

```jsx
<fieldset className="preset-map-detail" disabled={!provinceMap}>
```

Un `<fieldset disabled>` disabilita **tutti i discendenti**. I singoli radio
avevano già la condizione corretta (riga 379):

```jsx
disabled={!provinceMap && option.value !== 'nations'}
```

che avrebbe lasciato attivo «Solo nazioni». **Ma il `disabled` del fieldset
vinceva** e bloccava tutti e tre: il codice contraddiceva la propria nota.

Percorso reale: con un preset **senza** `map.geojson` provinciale (es.
`cold_war_1951`), `provinceMap` è `false` → fieldset disabilitato → nessuna
scelta possibile.

### Verifiche di FASE 1 (sul codice)

1. **Riga incriminata confermata** (riga 370) e contraddizione confermata: il
   `disabled` del fieldset prevale su quello dei singoli radio.
2. **`provinceMap`**: `const provinceMap = useMemo(() => hasProvinceFeatures(data.map_geojson), [data.map_geojson]);`
   (riga 159). `hasProvinceFeatures` (`frontend/src/components/Game/mapGrouping.ts`)
   restituisce `true` solo se **almeno una** feature ha `country` e `code`
   stringhe non vuote e `country !== code`. Per `cold_war_1951` (nessuna mappa
   provinciale) è `false`.
3. **Origine del grigio**: in `frontend/src/index.css` (riga 2393) la regola
   `.preset-map-detail[disabled] label { opacity: .55; }` legava l'opacità allo
   stato del **fieldset**, non a quello del singolo radio: per questo anche
   «Solo nazioni» risultava grigio.
4. **Stesso pattern altrove**: nel file esistono solo **due** `<fieldset>`: il
   primo (livello mappa, la causa) e il secondo `preset-map-grouping` (riga 387)
   con `disabled={effectiveDetail !== 'grouped'}`, che è **corretto** (il
   raggruppamento ha senso solo con «Regioni raggruppate») — confermato, **non
   modificato**. Nessun altro `<fieldset disabled>` nel resto del frontend.

---

## 2. Correzione applicata

- **Rimosso il `disabled` dal fieldset del livello mappa**: ora è
  `<fieldset className="preset-map-detail">`; l'abilitazione dipende dai singoli
  radio. La condizione è stata estratta in una funzione pura e testabile,
  `mapDetailOptionDisabled(hasProvinceMap, value)` in `mapGrouping.ts`, usata dal
  componente — così la regola è verificabile senza rendering:
  ```jsx
  disabled={mapDetailOptionDisabled(provinceMap, option.value)}
  ```
- **Grigio derivato dallo stato reale del radio** (`frontend/src/index.css`):
  aggiunta `.preset-map-detail input:disabled + span { opacity: .55; }` e
  mantenuta `.preset-map-detail[disabled] label` (serve ancora al fieldset del
  raggruppamento, che è legittimamente disabilitato).
- **Fieldset del raggruppamento invariato** (`disabled={effectiveDetail !== 'grouped'}`).
- **Salvataggio invariato**: `map_detail: provinceMap ? effectiveDetail : 'nations'`.

---

## 3. File modificati

- `frontend/src/components/Game/PresetEditorModal.tsx` — rimosso `disabled` dal
  fieldset; uso di `mapDetailOptionDisabled`.
- `frontend/src/components/Game/mapGrouping.ts` — nuova funzione pura
  `mapDetailOptionDisabled` (+ tipo `MapDetailLevel`).
- `frontend/src/components/Game/presetMapDetail.test.ts` — test di abilitazione e
  di regressione sul fieldset/CSS.
- `frontend/src/index.css` — opacità delle opzioni legata al radio disabilitato.
- `docs/implementation/FIX-MAPDETAIL-report.md` — questo report.

Nessuna modifica a `backend-nest/src/utils/map-detail.ts`, alla proiezione, al
loader, alle route o al motore.

---

## 4. Conferma CORE ENGINE FREEZE

**Nessun file del freeze è stato toccato.** L'intervento è confinato a
`frontend/src/components/Game/PresetEditorModal.tsx`, `mapGrouping.ts`,
`presetMapDetail.test.ts` e `frontend/src/index.css`. Non sono stati modificati
`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/database, `repositories`, la proiezione
(`utils/map-detail.ts`), il loader dei preset, né alcuna pipeline di turno.
Nessuna migrazione, nessun nuovo stato di gioco, nessuna dipendenza aggiunta.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `backend-nest` `tsc --noEmit` | **0 errori** |
| `backend-nest` `vitest run` | **1124 passed / 130 file** |
| `frontend` `tsc --noEmit` | **0 errori** |
| `frontend` `vitest run` | **294 passed / 48 file** |
| `npm run build` (frontend + backend) | **OK** |
| `npm run test:e2e:mock` | **21 passed** |
| `npm run test:a11y` | **3 passed** |
| `npm run test:perf` | **OK** (2.04 MB, entro baseline) |

Test mirati (`presetMapDetail.test.ts`, 12 test, tutti verdi) — nuovi:
- **senza** mappa provinciale: `mapDetailOptionDisabled(false, 'nations') === false`
  (abilitato) e `grouped`/`full` → `true` (disabilitati);
- **con** mappa provinciale: `nations`/`grouped`/`full` tutti abilitati;
- **regressione**: il `<fieldset className="preset-map-detail">` **non** ha
  l'attributo `disabled` (verifica testuale anti-ricaduta);
- il fieldset del raggruppamento usa ancora `disabled={effectiveDetail !== 'grouped'}`;
- il salvataggio scrive `map_detail: provinceMap ? effectiveDetail : 'nations'`;
- il CSS del grigio usa `.preset-map-detail input:disabled + span`.

Non esiste un test E2E del preset editor nel repo (verificato: `e2e/tests/` non
contiene alcuno spec per l'editor): la copertura è data dai test di componente/
funzione pura, come consentito dal task. Nessuno snapshot.

---

## 6. Risultati (prima → dopo)

| Scenario | Prima | Dopo |
|---|---|---|
| Preset **senza** mappa provinciale (es. `cold_war_1951`) | Tutti e tre i radio grigi e bloccati dal `fieldset disabled` → **nessuna scelta possibile** | «Solo nazioni» **selezionabile**; «Regioni raggruppate» e «Massimo dettaglio» **visibilmente disabilitati** (radio nativo + opacità), con la nota esplicativa |
| Preset **con** mappa provinciale | Tutti e tre selezionabili | **Invariato**: tutti e tre selezionabili |
| Salvataggio senza mappa provinciale | Scriveva `map_detail: 'nations'` | **Invariato**: scrive `map_detail: 'nations'` |
| Fieldset «Raggruppamento delle province» | `disabled` solo se `effectiveDetail !== 'grouped'` | **Invariato** (confermato corretto) |

---

## 7. Limiti residui

- La verifica è a livello di componente/funzione pura: **non** c'è un test E2E che
  apre davvero il preset editor (non esisteva e non è stato aggiunto, per non
  introdurre harness nuove). Un futuro spec E2E del tab Mappa darebbe una
  conferma end-to-end.
- `provinceMap` considera provinciale una mappa con almeno una feature
  `country ≠ code`: mappe miste o con proprietà parziali ricadono su `nations`,
  comportamento preesistente e non modificato da questo fix.
- Il grigio dei radio disabilitati usa `input:disabled + span` (dipendente
  dall'ordine `input` → `span` nel markup): se la struttura del `label` cambiasse,
  andrebbe aggiornato il selettore.
