# MAP-COMPLETE — la mappa è completa, le «nazioni giocabili» non esistono più

Branch: `feat/map-complete` · Base: `main` @ `fc7545e`.
Classe: **B** (il mondo è derivato da una fonte già esistente: la geometria del
preset/mappa nativa). Nessuna migrazione, nessuna modifica a `core/simulation/**`.

---

## 1. Problema e causa reale

La mappa aveva **buchi**: intere aree senza proprietario.

Causa verificata nel codice: `backend-nest/src/agents/balance-agent.ts`
`generateInitialWorldState()` costruiva le nazioni **solo** da
`template.country_codes` / `template.countries`:

```ts
const validCountries = countriesOverride?.length
  ? countriesOverride.map(...)                     // solo i codici del preset
  : template.country_codes.map(getCountry).filter(Boolean);
```

`worlds.routes.ts` creava poi **una regione per ogni nazione di
`worldState.countries`**, quindi ogni provincia/paese della mappa non elencato nel
preset restava **senza regione**: nessun owner, nessuna conquista possibile,
nessuna voce nel selettore. Il concetto di «nazioni giocabili» era il vero
impedimento a una mappa completa.

Numeri prima della correzione (regioni realmente create):

| preset | `country_codes` (consigliate) | politie sulla mappa | regioni create |
| --- | --- | --- | --- |
| `europa_1815` | 15 | 243 | **15** |
| `europa_1914` | 21 | 224 | **1 379** (solo le province delle 21) |
| `mondo_1936` | 39 | 224 | **814** |
| `mondo_1989` | 31 | 243 | **31** |

Tutte le altre entità della mappa (`LUX`, `AND`, `MCO`, `SMR`, il resto del
mondo) **non esistevano**.

---

## 2. Intervento

**Il mondo nasce dalla mappa, non dai codici del preset.** Riuso → derivazione →
estensione minima:

1. **Nuovo modulo puro `backend-nest/src/utils/map-polities.ts`** — unica fonte
   dell'elenco politie, costruito dalle feature della sorgente geometrica con le
   stesse regole della generazione:
   - codice polity = `properties.country` (mappe provinciali: la nazione-madre)
     altrimenti `properties.code` (mappe nazionali);
   - nome: `countries` del preset (storico) → nome italiano curato
     (`polityDisplayNameIt`) → registro `data/countries.json` → `nameEn` della
     feature → **dizionario dei nomi della mappa standard** → codice;
   - colore: `countries`/`country_colors` → registro → `colorForPolity`
     (deterministico, mai nero: il post-process `resolveRegionColor` resta invariato).
   - `partitionMapFeatures()` estrae la partizione feature della route, così
     l'invariante «ogni polity ha una geometria» è testabile.

2. **`worlds.routes.ts`** — costruisce `mapPolities` dalle feature già caricate e
   le passa al bilanciatore; la guardia `missingGeometry` ora copre **tutte** le
   politie; `playerCountryCode` deve appartenere alla mappa (errore chiaro
   altrimenti).

3. **`balance-agent.ts`** — nuovo parametro opzionale `curatedCodes`: il modello
   è interrogato **solo** per le nazioni curate dal preset (come prima), mentre
   le altre politie ricevono `baselineState()` — un **baseline deterministico**
   dichiarato (`BASELINE_POPULATION = 8M`, indici `gdp`/`military = 5`, `minor`,
   ideologia da `inferIdeology`). Per i mondi moderni (≥1990) la popolazione di
   riferimento **reale** viene comunque applicata da `applyReferenceBaseline`.
   Cache e `reuseExistingWorld` restano invariati e coprono l'intero elenco.

4. **`templates.routes.ts`** — `GET /api/templates/:id` restituisce ora **tutte
   le politie della mappa** in `countries` (+ `polity_count` e
   `recommended_codes`). `country_codes` **resta nello schema** ma cambia
   significato: non seleziona più chi esiste, elenca le **nazioni consigliate**.

5. **Frontend (solo presentazione)** — `CountrySelector` mostra la mappa completa
   («Mappa completa: N entità · M consigliate»), ordina le consigliate in cima e
   le marca con ★; `PresetEditorModal` e il prompt dell'assistente IA parlano di
   «nazioni consigliate».

**Nuovo significato dei campi (documentato nel codice):**

| campo | prima | ora |
| --- | --- | --- |
| `country_codes` | chi **esiste** nel mondo | chi è **consigliato** al giocatore (retrocompatibile) |
| `countries` | nomi/colori dei codici esistenti | nomi/colori **storici** dei codici consigliati; le altre politie usano registro/feature |
| mappa (`map.geojson`/`map_base`) | solo geometria | **fonte delle politie**: chi sta sulla mappa esiste |

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `backend-nest/src/utils/map-polities.ts` | **nuovo**: elenco politie della mappa, partizione feature, codici curati (puro) |
| `backend-nest/src/routes/worlds.routes.ts` | politie = mappa; guardia geometria su tutte; validazione della nazione scelta |
| `backend-nest/src/agents/balance-agent.ts` | `curatedCodes` + `baselineState()` deterministico; baseline esportato |
| `backend-nest/src/routes/templates.routes.ts` | `countries` = politie della mappa, `polity_count`, `recommended_codes` |
| `backend-nest/src/routes/presets.routes.ts` | testo assistente IA: «nazioni consigliate» |
| `backend-nest/src/utils/preset-loader.ts` | documentazione dei campi aggiornata al nuovo significato |
| `frontend/src/components/Game/CountrySelector.tsx` | conteggio mappa completa, consigliate in cima, badge ★ |
| `frontend/src/components/Game/PresetEditorModal.tsx` | etichette «nazioni consigliate» |
| `frontend/src/index.css` | stile di `.map-completeness` / `.country-recommended` (tinte esistenti) |
| `backend-nest/tests/map-polities.test.ts` | **nuovo**: 12 test sul modulo puro + invariante geometria per tutti i preset |
| `backend-nest/tests/map-complete-generation.test.ts` | **nuovo**: 3 test su curate vs baseline, costo LLM, popolazione reale |
| `backend-nest/tests/map-complete-route.test.ts` | **nuovo**: 3 test di integrazione sulla VERA route (LLM stub) |
| `e2e/tests/mock-smoke.spec.mjs` | verifica «mappa completa» + badge consigliata |
| `docs/implementation/MAP-COMPLETE-report.md` | questo report |

---

## 4. CORE ENGINE FREEZE — conferma

- `core/simulation/**`: **non toccato**.
- Non toccati: `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
  `SessionStateStore`, schema/DB, `repositories`, economia, store Zustand,
  checkpoint, playback, pipeline di avanzamento turno.
- Nessuna migrazione, nessun secondo motore, nessuna seconda fonte di verità:
  l'elenco politie **deriva** dalla geometria già presente.

---

## 5. Test reali (esito)

| verifica | comando | esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1154 passed / 135 file** (erano 1151/134) |
| TypeScript backend | `npx tsc --noEmit` | exit 0 |
| Build backend | `npm run build` | exit 0 |
| Frontend test | `cd frontend && npx vitest run` | **318 passed / 49 file** |
| TypeScript frontend | `npx tsc --noEmit` | exit 0 |
| Build frontend | `npm run build` | exit 0 |
| E2E mock | `npm run test:e2e:mock` | **23 passed** |
| A11y | `npm run test:a11y` | **3 passed** |
| Perf | `npm run test:perf` | 2.05 MB, **entro la baseline** |

**I test provano il bug.** Con il codice storico (politie = solo `country_codes`)
`tests/map-complete-route.test.ts` fallisce:

```
× una nazione fuori dai country_codes esiste, ed è giocabile
  AssertionError: expected 500 to be 200
```

Il preset sintetico del test ha **due province di `AAA`** e una nazione **`BBB`
assente dai `country_codes`**: prima della correzione la generazione per `BBB`
veniva rifiutata (la nazione non esisteva), ora il mondo contiene **3 regioni**
(2 province di `AAA` + 1 di `BBB`) e `BBB` è giocabile. Il test verifica anche che
il modello sia chiamato **una sola volta** (solo la nazione curata) e che
rigenerare lo stesso mondo **non costi altre chiamate**.

---

## 6. Prima → dopo

| preset | politie | regioni | copertura mappa |
| --- | --- | --- | --- |
| `europa_1815` | 15 → **243** | 15 → **243** | ogni codice della mappa ha una regione |
| `europa_1914` | 21 → **224** | 1 379 → **4 475** | idem (province complete) |
| `mondo_1936` | 39 → **224** | 814 → **1 591** | idem |
| `mondo_1989` | 31 → **243** | 31 → **243** | idem |

**Costi LLM invariati:** il modello è interrogato solo per le nazioni curate
(15/21/39/31 → 1/2/3/2 batch da 16), esattamente come prima; le ~200 politie
aggiuntive non generano alcuna chiamata. Cache per impronta di contenuto e
`reuseExistingWorld` continuano a valere sull'intero elenco: la seconda
generazione dello stesso mondo costa **zero** chiamate (verificato da test).

---

## 7. Limiti dichiarati (non aggirati)

- **Le politie non curate hanno un baseline deterministico, non dati storici.**
  `population = 8M`, indici `gdp`/`military = 5`, status `minor`. Non sono
  presentati come stime storiche; servono a rendere il territorio esistente e
  giocabile. Una fase successiva può curare più nazioni (basta aggiungerle a
  `countries`/`country_codes` del preset: nessuna modifica di codice).
- **Anacronismo sulle mappe moderne.** Le geometrie native sono a confini
  moderni: in `europa_1914`/`mondo_1936` compaiono come politie anche entità che a
  quella data non esistevano (es. una provincia moderna diventa una polity col
  nome moderno). È il rovescio della medaglia della completezza: chiudere i buchi
  senza geometrie storiche significa mostrare i confini moderni. La soluzione
  corretta è la fase già proposta in `WORLD-ALIVE-2`: **mappe storiche**
  (`map.geojson` 1815/1914) o una mappa di proprietà storica
  (`country_owners` nel preset) che assegni le province moderne all'impero del
  periodo. Dichiarato, non aggirato: nessuna proprietà storica inventata.
- **Entità non sovrane incluse.** La mappa standard contiene 243 codici, tra cui
  dipendenze e territori (`ABW`, `ATA`, `VAT`, `SOL`, `KOS`, `YUG`). Sono
  politie come le altre: preferibile un buco in meno che una mappa incompleta.
  Se serve escluderle, va deciso a livello di contenuto (fase successiva).
- **Nomi delle mappe provinciali.** Le province Pax non hanno `nameEn`: per i
  codici fuori registro si usa il dizionario della mappa standard (`Luxembourg`,
  `Kosovo`, …); per i pochissimi assenti da tutte le fonti resta il codice
  (`SDS`).
- **Costo di lettura.** `mapPolitiesForPreset` rilegge il GeoJSON a ogni
  `GET /api/templates/:id` (~7 MB per le mappe Pax, decine di ms con la cache del
  filesystem). Non è stato introdotto un ulteriore livello di cache per non
  rischiare dati stantii dopo l'editing di un preset; se servirà, la cache va
  invalidata sull'import/editing della mappa.
- **Peso del mondo.** `europa_1914` passa da 1 379 a 4 475 regioni: più righe in
  `world_regions` e più poligoni sulla mappa. È esattamente la mappa completa
  richiesta; il costo si paga una volta per mondo generato.
