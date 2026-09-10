# G1-A — Fondazioni sicure e accessibili del redesign

**Pacchetto:** prima micro-consegna del piano grafico immersivo, coerente con U01 ma isolata per non sovrapporsi alla migrazione di shell ancora aperta.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Fotografia iniziale

- Il frontend aveva una Landing e un catalogo già caratterizzati, ma `frontend/index.html` era ancora in inglese e usava `vite.svg`.
- Ogni card scenario era un `div` cliccabile che conteneva altri `button`: non era attivabile da tastiera e generava markup interattivo annidato.
- `MapboxMapView.tsx` inseriva `obj.name` e `obj.type` in `Popup#setHTML()`. I dati possono provenire da preset importati e salvataggi; HTML interpolato non è accettabile.
- I comandi della mappa intercettavano frecce, `+`, `-` e `0` su `window`, anche quando la mappa non aveva il focus.
- La CSS migration non aveva ancora token semantici autonomi.

## Requisiti

- Piano grafico: VIS-01, VIS-03, VIS-06, VIS-17; quick win 1 e 10.
- Piano maestro §10.2: token semantici e identità World Story.
- Piano maestro §10.7: controlli nativi, focus e nessuna azione disponibile solo al mouse.
- Piano esecutivo U01: fondazioni CSS e navigazione tastiera; nessun nuovo `!important`.

## File letti

- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/components/Game/TemplateSelector.tsx`
- `frontend/src/components/Map/MapboxMapView.tsx`
- `frontend/src/index.css`
- `frontend/src/editorial.css`
- `frontend/src/styles/foundations.css` (nuovo)
- `frontend/vitest.config.ts`

## File modificati o creati

- `frontend/index.html`
- `frontend/public/world-story-mark.svg` (nuovo)
- `frontend/src/main.tsx`
- `frontend/src/styles/foundations.css` (nuovo)
- `frontend/src/components/Game/TemplateSelector.tsx`
- `frontend/src/components/Game/templateSelectorAccessibility.test.ts` (nuovo)
- `frontend/src/components/Map/MapboxMapView.tsx`
- `frontend/src/components/Map/mapPopupSecurity.test.ts` (nuovo)

## Comportamento prima e prova rossa

È stato aggiunto prima della correzione `mapPopupSecurity.test.ts`:

```text
expect(source).not.toContain('.setHTML(')
expect(source).toContain('.setDOMContent(')
```

Esecuzione iniziale:

```text
vitest run src/components/Map/mapPopupSecurity.test.ts
→ 1 test fallito: MapboxMapView contiene `.setHTML(`
```

La prova è stata poi resa verde sostituendo il percorso vulnerabile.

## Contratti e comportamento introdotti

### Identità documento

- `lang="it"`;
- titolo italiano;
- metadata description e `theme-color` World Story;
- favicon `world-story-mark.svg` locale, senza dipendenza da Vite.

### Fondazioni CSS

`foundations.css` introduce token `--ws-*` per superfici, testi, azioni, raggi e registro z-index. I token coesistono con il tema corrente e non riscrivono i selettori legacy: servono come punto d’ingresso alla migrazione componente per componente.

### Catalogo scenari

- una card è ora un `article`;
- il comando di apertura è un vero `button.template-card-select`;
- modifica, copia ed export sono button fratelli, quindi non esiste nesting di controlli interattivi;
- ogni azione icon-only ha un `aria-label` contestuale;
- la resa e l’hover esistenti rimangono compatibili.

### Mappa

- il popup usa `setDOMContent()`;
- titolo e metadati passano per `textContent`, non HTML interpolato;
- il contenitore mappa è focusable, con istruzioni accessibili;
- le hotkey sono attive soltanto quando il contenitore mappa possiede il focus; un pointer down trasferisce il focus al contenitore.

## Invarianti mantenute

- Nessuna API, simulazione, save, ordine o stato di gameplay è stato modificato.
- Il click su una card apre lo stesso scenario di prima.
- Modifica/copia/export mantengono lo stesso comportamento, senza propagazione necessaria perché non sono più figli di una card cliccabile.
- Le hotkey mappa continuano a funzionare dopo click/focus sulla mappa, ma non interferiscono con form e dialoghi esterni.
- Nessun dato di preset importato è interpretato come markup nel popup.

## Verifiche eseguite

```text
cd frontend && ../node_modules/.bin/vitest run src/components/Map/mapPopupSecurity.test.ts
→ 1/1 verde

cd frontend && ../node_modules/.bin/vitest run
→ 7 file, 53 test verdi

cd frontend && npm run build
→ tsc + vite OK

git diff --check
→ pulito
```

Verifica browser locale Chrome, 1260×604:

- titolo documento: `World Story — Simulatore di storia alternativa`;
- 9 card semantiche `article.template-card`;
- 9 controlli di apertura `template-card-select`;
- 4 controlli focusabili per card;
- 0 pulsanti senza `aria-label` nella card;
- screenshot: `docs/ref/audit-grafico-2026-09-09/04-scenari-accessibili.png`.

Nota ambiente: Playwright headless non è eseguibile su macOS 11.6 per incompatibilità binaria del browser. La verifica browser è stata eseguita con Chrome esistente via DevTools Protocol. Il warning Vite su `__dirname` e gli avvisi esbuild/oxc sono preesistenti.

## Cosa non è implementato

- `AccessibleDialog`, toast e focus trap (prossima micro-consegna U01/G1-B).
- Shell grid, command rail persistente, breakpoints tablet e migrazione completa del CSS.
- Separazione effettiva del vendor MapLibre dal CSS legacy.
- Nuovo catalogo filtrato, dossier paese, Time Desk, catena fattibilità e cicatrice temporale.
- Test browser/axe completi: bloccati dall’attuale runtime Playwright e da fixture dedicate da ampliare.

## Migrazioni e dati

Nessuna migrazione DB, nessun backend, nessun deploy e nessun dato reale modificato.

## Decisione revisore

**Da revisionare.** Il revisore deve in particolare verificare il focus dei canvas/controlli MapLibre reali e il comportamento del button di selezione con le regole CSS legacy a tutti i breakpoint.
