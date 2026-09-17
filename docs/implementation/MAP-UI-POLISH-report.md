# MAP-UI-POLISH — Rifinitura estetica della sezione «5. Mappa» (preset editor)

Branch: `style/preset-map-polish` · Base: `main` @ `ec26420` (dopo il merge della PR #35 `fix/map-native-coverage`).
Tipo di intervento: **solo presentazione** (CSS + markup di presentazione). Nessuna modifica a logica, stato, API o motore.

---

## 1. Problemi visivi confermati sul codice (selettori reali)

Tutti i punti sono stati confermati leggendo il CSS reale e misurando la pagina nel browser (Playwright, viewport 360/390/430px). Il modale è a **tema chiaro editoriale** (`.preset-editor { background: var(--op-sheet) !important }`, `frontend/src/editorial.css:296`; body crema `#f8f3e8`), mentre la sezione Mappa era un insieme di riquadri navy: da qui i contrasti rotti.

1. **Radio sproporzionato.** `.preset-map-base-option input { width: 20px; height: 20px }` + su mobile `@media (max-width: 720px) { .preset-editor :is(input, textarea, select) { background: #091321 !important; border-color: #58708e !important; color: #f0f5ff !important } }` (`frontend/src/index.css:1657`): il pallino diventava un **disco navy 20×20** che dominava la card. Inoltre `.preset-editor-body :is(input, textarea) { width: 100% }` (`index.css:2343`) ingrandiva i controlli.
2. **Nessuno stato selezionato.** La card scelta era identica alle altre: nessuna regola `.selected`, nessun bordo/accento/spunta. L'unico segnale era il pallino nativo.
3. **Nessuna gerarchia tipografica.** Titolo e sottotitolo erano due nodi dello stesso `<span>` con peso simile (`.preset-map-base-option span { font: 600 13px }` e `.preset-map-base-option small { font: 500 11px }`), e il numero di province era **dentro** la frase del sottotitolo, non scansionabile.
4. **Barra «Mappa attiva» a filo del footer.** Era un semplice `<p class="preset-guide">` in mezzo alla sezione; su mobile il footer è `position: sticky; bottom: 0` (`index.css:1582`) e il body non riservava spazio in fondo → il riepilogo finiva **coperto/tagliato** dal footer (Annulla / Salva modifiche).
5. **Spaziatura disomogenea / card alte.** `.preset-map-editor { gap: 13px }`, `.preset-map-base { padding: 10px 13px }`, card con `padding: 9px 10px` e contenuto stirato in verticale: **104px** di altezza per una card con una riga di titolo.
6. **Blocco informativo in gara col selettore.** L'intro era un `.preset-guide` (riquadro navy pieno, `index.css:2345`), visivamente pesante quanto il selettore; inoltre il testo era chiaro su fondo crema (contrasto **1.13:1**, illeggibile).

### Bug di leggibilità scoperto durante la verifica

Il tema editoriale impone **`!important`** all'inchiostro scuro sui nodi dentro il modale:
`frontend/src/editorial.css` — `:is(.save-modal, .llm-modal, .prompt-editor-modal, .preset-editor) :is(h1, h2, h3, h4, p, label, span, strong) { color: var(--edition-ink) !important }`
e `index.css:2454` — `.preset-editor .preset-editor-body label small { color: #526170 !important }`.

Conseguenza misurata: **titolo card 1.27:1** (scuro su navy) e **sottotitolo 2.12:1**. I titoli erano già illeggibili prima dell'intervento (il sottotitolo era un `<small>` dentro la `<label>`); l'aggiunta del `<strong>` per la gerarchia avrebbe peggiorato anche il titolo. Andava forzata la tinta chiara.

---

## 2. Intervento applicato (markup + CSS) e tinte riusate

### Markup (`PresetEditorModal.tsx`, solo presentazione)
- **Card mappa nativa**: il radio resta nel DOM (accessibile e focusabile) ma è nascosto via CSS; la `<label>` è l'elemento cliccabile. Titolo in `<strong>`, sottotitolo in `<small>`, **badge** `<em class="preset-map-base-badge">{features}<small>province|paesi</small></em>` e **spunta** `<i class="preset-map-base-check">✓</i>`.
- **Classi di stato derivate dallo stato React** (nessun `:has()` richiesto): `preset-map-base-option${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`. La logica di selezione è invariata: `selected = !hasOwnMap && selectedBase === m.id`, `disabled = hasOwnMap || missing.length > 0` (le espressioni nei `disabled={...}` dei radio **non** sono state toccate).
- **Livelli di dettaglio** trasformati nelle stesse card compatte (`.preset-map-detail-option`, `.preset-map-detail-text`, spunta) con `disabled={mapDetailOptionDisabled(provinceMap, option.value)}` invariato.
- **Riepilogo «Mappa attiva»**: da `<p>` a box `.preset-map-summary` (con `role="status" aria-live="polite"`) composto da due item etichettati — «Mappa attiva: {activeMapLabel}» e «Livello: {effectiveDetail}».
- **Intro**: da `.preset-guide` (riquadro pieno) a `.preset-map-intro` (nota discreta). Il `<details>` «Opzione avanzata» è rimasto funzionalmente identico, solo allineato.

### CSS (`frontend/src/index.css`, blocco `.preset-map-*`)
- Radio nascosto ma accessibile: `.preset-editor .preset-map-base-option > input[type="radio"] { position: absolute; width: 1px; height: 1px; ... opacity: 0 }` (idem per il dettaglio). La card mantiene `min-height: 44px` e `cursor: pointer` (target touch sulla card, non sul pallino).
- **Stato selezionato evidente**: `.preset-editor .preset-map-base-option.selected { border-color: #9c87ed; background: #302950 }` + spunta `opacity: 1`. **Stato disabilitato**: `opacity: .55; cursor: not-allowed`.
- **Gerarchia**: titolo 13px/600 `#dce8f8`, sottotitolo 11px/500 `#9bacbf`, legend maiuscola 11px/700 con `letter-spacing`.
- **Badge**: pillola `border-radius: 999px`, `white-space: nowrap`, numero in evidenza + unità attenuata.
- **Riepilogo**: box con padding `10px 12px`, bordo `#394f6d` e accento a sinistra `#8872df`; separato dal contenuto (non una riga a filo).
- **Footer sticky**: `.preset-editor-body { padding-bottom: calc(26px + env(safe-area-inset-bottom)) !important }` nel media query mobile, così la barra è sempre interamente visibile.
- **Leggibilità forzata** dove il tema editoriale impone l'inchiostro scuro: titolo/sottotitolo/badge/riepilogo e `.preset-map-drop strong` con `color: … !important`; intro e hint dell'opzione avanzata in inchiostro scuro.

**Tinte riusate (nessuna nuova palette):**
- navy esistenti della sezione: `#0e1b2c`, `#101d30`, `#16233a`, `#243651`, `#33486a`, `#394f6d`, `#5a79a8`;
- testo chiaro: `#dce8f8`, `#c3d1e3`, `#9bacbf`, `#d7e4f7`;
- accento già usato dal progetto: `#8872df`, `#9c87ed`, sfondo selezionato `#302950` (identici a `.preset-editor-tabs button.active`);
- inchiostro scuro del modale su fondo crema: `#27333f`, `#526170`, `#e0a24a` (warning) — già presenti in `index.css:2452-2456`.

---

## 3. File modificati

| File | Modifica |
| --- | --- |
| `frontend/src/components/Game/PresetEditorModal.tsx` | Markup di presentazione della sezione Mappa (card, badge, spunta, riepilogo, intro) |
| `frontend/src/index.css` | Blocco `.preset-map-*` riscritto + padding mobile del body + fix contrasti |
| `frontend/src/components/Game/presetMapDetail.test.ts` | +7 test di presentazione (stato selezionato, badge, riepilogo, contrasti, intro) |
| `e2e/mock-api.mjs` | Mock di `GET /templates/:id/edit` e `GET /templates/:id/scenario` per aprire l'editor negli E2E |
| `e2e/tests/preset-map-ui.spec.mjs` | **Nuovo** E2E: misura reale a 360/430px, stato selezionato, contrasti, riepilogo non coperto |
| `docs/implementation/MAP-UI-POLISH-report.md` | Questo report |

Nessuna modifica a `native-maps.ts`, `mapGrouping.ts`, `presets.routes.ts`, `worlds.routes.ts`, né al motore.

---

## 4. Conferma: logica e comportamento invariati

- Selezione mappa nativa: stessa condizione (`!hasOwnMap && selectedBase === m.id`), stesso `patch('map_base', …)`, stesso `disabled`.
- Compatibilità/`missingByMap`/avvisi di copertura: intatti (le classi `.disabled` derivano dalle stesse variabili).
- Salvataggio: `map_base: selectedBase`, `map_detail: provinceMap ? effectiveDetail : 'nations'`, `map_grouping: provinceMap && grouping ? grouping : ''` invariati.
- Nessun contatto con `native-maps.ts`, `mapGrouping.ts`, `presets.routes.ts`, `worlds.routes.ts`, store, economia, motore.
- Le uniche differenze nel diff di `PresetEditorModal.tsx` sono classi/struttura di presentazione e testo del sottotitolo (il conteggio è passato dal testo al badge).

---

## 5. Test eseguiti (esito reale)

| Verifica | Comando | Esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1138 passed / 131 file** |
| Frontend test | `cd frontend && npx vitest run` | **313 passed / 48 file** (306 → +7) |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| Build frontend | `cd frontend && npm run build` | OK (`index-iOlYg2hi.css`, 498.99 kB) |
| Build backend | `cd backend-nest && npm run build` | exit 0 |
| E2E mock (tutti) | `npm run test:e2e:mock` | **23 passed** (21 preesistenti + 2 nuovi) |
| Accessibilità | `npm run test:a11y` | **3 passed** |
| Performance bundle | `npm run test:perf` | **2.04 MB** (JS 1.49 · CSS 0.55) — entro baseline |

### Verifica mobile documentata (E2E reale, `e2e/tests/preset-map-ui.spec.mjs`)

Misure reali nel browser con l'editor aperto sul tab «5. Mappa» (mock API):

| Viewport | Riepilogo «Mappa attiva» | Footer sticky | Esito |
| --- | --- | --- | --- |
| **360×740** | top 365.3 · **bottom 414.9** | top 660 | interamente visibile e sopra il footer |
| **430×932** | top 710.3 · **bottom 759.9** | top 852 | interamente visibile e sopra il footer |

Altre misure: radio nativo **1×1px** (prima 20×20); card mappa **84.1px** a 360 / **53.5px** a 430 (prima 104px); `documentElement.scrollWidth == viewport` → **nessuno sbordamento orizzontale**; contrasto reale titolo **10.87:1**, sottotitolo **5.80:1**, intro **5.75:1** (tutti ≥ 4.5).

---

## 6. Prima → dopo (punti 1–6)

1. **Radio sproporzionato → card controllabile.** Prima: disco nativo 20×20px, navy su mobile. Dopo: radio 1×1 invisibile ma ancora focusabile (anello `:focus-within`), l'intera card è il bersaglio (≥44px).
2. **Nessuno stato selezionato → stato evidente.** Prima: card identiche. Dopo: bordo `#9c87ed`, sfondo `#302950` e spunta `✓` visibile sulla sola card scelta.
3. **Nessuna gerarchia → gerarchia + badge.** Prima: titolo/sottotitolo stesso peso, conteggio annegato nel testo. Dopo: titolo 13/600, sottotitolo 11/500 attenuato, numero di regioni in pillola a destra.
4. **Barra «Mappa attiva» tagliata → riepilogo in box.** Prima: `<p>` a filo coperto dal footer. Dopo: box con padding e accento, due item etichettati, più `padding-bottom` sul body mobile: a 360 e 430px è interamente visibile (misure sopra).
5. **Card alte/spaziatura irregolare → card compatte.** Prima: 104px per una riga. Dopo: 84.1px a 360 (per via dell'avviso di copertura su due righe) e 53.5px a 430, con `gap` e padding uniformi.
6. **Blocco informativo in gara → nota discreta.** Prima: intro in riquadro navy pieno e con testo illeggibile sul fondo crema (1.13:1). Dopo: nota `.preset-map-intro` in inchiostro `#526170` (5.75:1), il selettore resta il protagonista.

---

## 7. Limiti residui

- La sezione Mappa resta un **insieme di riquadri navy** dentro un modale a fondo crema (coerente con le tinte esistenti richieste); una conversione integrale della sezione al tema chiaro sarebbe un intervento più ampio e non richiesto.
- Il fix di leggibilità usa alcuni `!important` (necessari per superare gli `!important` del tema editoriale su `strong`/`small`); sono localizzati al blocco `.preset-map-*`.
- La barra «Mappa attiva» è stata misurata con il preset mock (2 paesi, senza copertura); con molti codici mancanti l'avviso di copertura può allungare le card, ma il riepilogo resta in coda e sopra il footer.
- Su desktop 768–1024px resta il noto overlap `.hud-center` (fuori scope, segnalato in precedenti report).
- Il badge mostra il numero di feature (province/paesi) così come restituito da `GET /templates/maps/native`; non distingue province reali da regioni-country-level (es. `paxh_ww2_provinces`).
