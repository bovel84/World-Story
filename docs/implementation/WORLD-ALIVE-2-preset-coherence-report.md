# WORLD-ALIVE / PARTE 2 — Coerenza storica dei preset (nomi e potenze)

Branch: `fix/preset-historical-coherence` · Base: `main` @ `77324bc`.
Classe: **A/D** — dati del preset (`preset.json`) + uso di un campo **già supportato**
(`countries: PresetCountry[]`), nessuna migrazione, nessuna modifica al motore.

---

## 1. Problema trovato (causa reale)

- `europa_1914` dichiarava **37 `country_codes`** ma usava
  `map_base: pax_modern_provinces` (confini moderni) e includeva Stati che nel
  1914 **non esistevano** (Polonia, Cecoslovacchia, Ungheria, Croazia, Slovenia,
  Slovacchia, Ucraina, Bielorussia, Paesi baltici, Finlandia, Irlanda, Bosnia,
  Macedonia, Moldavia): erano entità nate da Versailles o dalla dissoluzione
  jugoslava/sovietica.
- I **nomi** dei polity erano quelli moderni del registro
  `data/countries.json`: la Turchia appariva come «Turchia» e non come
  **Impero Ottomano**; l'Austria-Ungheria non era rappresentata.
- **Causa tecnica:** nessuno dei 4 preset usava il campo opzionale `countries`
  (`PresetCountry { code, name, color }`, già presente in `preset-loader.ts` e
  già consumato da `worlds.routes.ts` →
  `BalanceAgent.generateInitialWorldState(preset, preset.countries, …)`).

**Punto delicato del consumo:** in `balance-agent.ts` l'override è
`countriesOverride.map(...)` **senza filtrare per `country_codes`**: se
`countries` non copre esattamente i `country_codes`, le nazioni mancanti
spariscono dal mondo. Il test nuovo impone l'uguaglianza dei due insiemi.

---

## 2. Correzione applicata

Per **tutti e 4** i preset (`europa_1815`, `europa_1914`, `mondo_1936`,
`mondo_1989`):

1. **Nomi storici** via `countries`: ogni codice ha un nome di periodo
   (es. 1914 `TUR` → «Impero Ottomano», `AUT` → «Austria-Ungheria», `RUS` →
   «Impero Russo», `DEU` → «Impero Tedesco», `GBR` → «Impero Britannico»).
2. **Allineamento dei `country_codes`**: rimossi i codici dei moderni Stati che
   alla data d'inizio non esistevano (o erano repubbliche di unioni ancora in
   essere), con la regola: *se il territorio era parte di un polity del periodo
   già presente nel preset, il codice moderno viene tolto*.
3. I **colori** restano quelli del registro `data/countries.json`: **nessun
   cambio estetico**, cambiano solo i nomi. L'anti-`dark` di `resolveRegionColor`
   continua a valere.
4. **Copertura territoriale** riverificata con `nativeMapInfo` (`info.codes`) e
   `nativeMapMissingCodes`-style: nessun codice scoperto.

### Regola di rimozione — riepilogo per preset

| preset | codici | rimossi | n. rimosso |
| --- | --- | --- | --- |
| `europa_1815` | 15 | BEL, GRC, CZE, HUN, ROU, BGR, SRB, HRV, SVN, SVK, UKR, BLR, LTU, LVA, EST, FIN, IRL, ALB, BIH, MNE, MDA | 21 |
| `europa_1914` | 21 | POL, CZE, HUN, HRV, SVN, SVK, UKR, BLR, LTU, LVA, EST, FIN, IRL, BIH, MKD, MDA | 16 |
| `mondo_1936` | 39 | HRV, SVN, MKD | 3 |
| `mondo_1989` | 31 | SVK, HRV, SVN, UKR, BLR, LTU, LVA, EST, KAZ, GEO, ARM, AZE, UZB | 13 |

### Perché ogni gruppo è stato rimosso

**1815** (data: 9 giugno 1815, Atto finale del Congresso di Vienna)
- `BEL` — non esiste: il Belgio è annesso al **Regno Unito dei Paesi Bassi** (1815-1830), che resta su `NLD`.
- `GRC` — non esiste: indipendenza 1830; nel 1815 è territorio ottomano (`TUR`).
- `CZE, HUN, SVK, HRV, SVN` — terre della corona asburgica (`AUT`); nessuno Stato nazionale.
- `ROU, BGR, SRB, ALB, MNE, BIH, MKD, MDA` — province ottomane (o russe) nel 1815; nessuno Stato nazionale balcanico (la Serbia autonoma nasce dal 1815-1817, fuori data).
- `UKR, BLR, LTU, LVA, EST, FIN` — governatorati / granducato dell'**Impero Russo** (`RUS`).
- `IRL` — parte del **Regno Unito** (`GBR`).

**1914** (data: 28 giugno 1914, Sarajevo)
- `POL` — nessuno Stato polacco: territorio diviso fra Russia, Germania e Austria.
- `CZE, SVK, HUN, HRV, SVN, BIH` — **Austria-Ungheria** (`AUT`).
- `UKR, BLR, LTU, LVA, EST, FIN` — **Impero Russo** (`RUS`).
- `IRL` — **Regno Unito** (`GBR`).
- `MKD, MDA` — Serbia / Russia (Bessarabia).
- **`ALB` e `MNE` NON sono stati rimossi**: l'Albania è indipendente dal 1912 e il Montenegro è un regno indipendente fino al 1918. L'elenco nel task li dava per inesistenti, ma la verifica storica dice il contrario: la regola «tieni solo le entità realmente presenti» prevale, quindi restano con i nomi «Principato di Albania» e «Regno del Montenegro». **Deviazione esplicita e motivata dall'elenco del task.**

**1936** (data: 1 gennaio 1936)
- `SVK` non c'era già (la Cecoslovacchia era rappresentata da `CZE`).
- `HRV, SVN, MKD` — **Regno di Jugoslavia** (`SRB`), creato nel 1918/1929.

**1989** (data: 4 giugno 1989)
- `SVK` — **Cecoslovacchia** (`CZE`).
- `HRV, SVN` — **Jugoslavia (RSFJ)** (`SRB`).
- `UKR, BLR, LTU, LVA, EST, KAZ, GEO, ARM, AZE, UZB` — **Unione Sovietica** (`RUS`).

### Mappa nome storico → codice moderno (campo `countries`)

| codice | 1815 | 1914 | 1936 | 1989 |
| --- | --- | --- | --- | --- |
| GBR | Regno Unito di Gran Bretagna e Irlanda | Impero Britannico | Impero Britannico | Regno Unito |
| FRA | Regno di Francia | Repubblica Francese | Repubblica Francese | Repubblica Francese |
| RUS | Impero Russo | Impero Russo | Unione Sovietica | Unione Sovietica |
| AUT | Impero d'Austria | Austria-Ungheria | Repubblica d'Austria | — |
| DEU | Confederazione Germanica | Impero Tedesco | Germania nazista | Repubblica Federale di Germania |
| ITA | Stati Italiani pre-unitari | Regno d'Italia | Italia fascista | Repubblica Italiana |
| TUR | Impero Ottomano | Impero Ottomano | Repubblica di Turchia | Repubblica di Turchia |
| POL | Regno di Polonia (Congresso) | — | Seconda Repubblica Polacca | Repubblica Popolare Polacca |
| SRB | — | Regno di Serbia | Regno di Jugoslavia | Jugoslavia (RSFJ) |
| CZE | — | — | Cecoslovacchia | Cecoslovacchia |
| HUN | — | — | Regno d'Ungheria | Repubblica Popolare Ungherese |
| … | (vedi `preset.json` per la tabella completa dei 15/21/39/31 nomi) | | | |

**Proxy dichiarati (1815):** `DEU` = «Confederazione Germanica» (entità reale
creata nel 1815) e `ITA` = «Stati Italiani pre-unitari» (nessuno Stato unico:
il codice moderno aggrega un insieme di Stati del periodo). Sono approssimazioni
esplicite, rese necessarie dalle geometrie moderne.

---

## 3. Prova di copertura territoriale completa

Calcolata con i moduli reali (`nativeMapInfo`, `resolveMapSource`,
`resolveMapDetail`, `deriveGroups`) in `tests/preset-rebuild.test.ts`:

| preset | `map_base` | feature mappa | paesi mappa | nazioni | **scoperti** | province coinvolte | regioni |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `europa_1815` | `standard` | 243 | 243 | 15 | **nessuno** | 15 | 15 |
| `europa_1914` | `pax_modern_provinces` | 4475 | 224 | 21 | **nessuno** | 1379 | 1379 |
| `mondo_1936` | `pax_modern_provinces` | 4475 | 224 | 39 | **nessuno** | 2393 | 814 |
| `mondo_1989` | `standard` | 243 | 243 | 31 | **nessuno** | 31 | 31 |

`missing = country_codes.filter(c => !info.codes.includes(c))` → `[]` per tutti.
Ogni nazione ha almeno una regione (`byCountry.size === country_codes.length`).

Le rimozioni **riducono** i requisiti di copertura, quindi non possono scoprire
codici; il vantaggio è che le mappe non contengono più polity anacronistiche.

---

## 4. File modificati

| file | intervento |
| --- | --- |
| `backend-nest/data/presets/europa_1815/preset.json` | `country_codes` 36→15, nuovo `countries` (15 nomi storici) |
| `backend-nest/data/presets/europa_1914/preset.json` | `country_codes` 37→21, nuovo `countries` (21 nomi storici) |
| `backend-nest/data/presets/mondo_1936/preset.json` | `country_codes` 42→39, nuovo `countries` (39 nomi storici) |
| `backend-nest/data/presets/mondo_1989/preset.json` | `country_codes` 44→31, nuovo `countries` (31 nomi storici) |
| `backend-nest/tests/preset-rebuild.test.ts` | conteggi attesi per preset; `countries` = `country_codes` (nome+colore validi); nomi storici chiave; codici anacronistici assenti |
| `docs/implementation/WORLD-ALIVE-2-preset-coherence-report.md` | questo report |

`lore.md` e `rules.md` **non** sono stati modificati: descrivevano già le
dinamiche reali (imperi multi-etnici, questione d'Oriente, Jugoslavia,
Cecoslovacchia) e restano coerenti con i nuovi nomi.

Nessuna modifica a `preset-loader.ts`, `native-maps.ts`, `worlds.routes.ts`,
`balance-agent.ts` o al motore.

---

## 5. Conferma CORE ENGINE FREEZE

`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB, `repositories`, checkpoint, economia, store
Zustand, pipeline di avanzamento: **non toccati**. L'intervento è **dati del
preset** + un campo già supportato (`countries`). Nessuna migrazione.

---

## 6. Test eseguiti (esito reale)

| verifica | comando | esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1127 passed / 131 file** |
| Frontend test | `cd frontend && npx vitest run` | **318 passed / 49 file** |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| Build backend | `cd backend-nest && npm run build` | exit 0 |
| Build frontend | `cd frontend && npm run build` | exit 0 |
| E2E mock (tutti) | `npm run test:e2e:mock` | **23 passed** |

Diagnostica reale dei preset (stampata dal test con `--reporter=verbose`):

```
[PRESETS-REBUILD] europa_1815: 15 nazioni · map=standard (243 feature, 243 paesi) · detail=nations → nations · province coinvolte=15 · regioni=15 · copertura=OK
[PRESETS-REBUILD] europa_1914: 21 nazioni · map=pax_modern_provinces (4475 feature, 224 paesi) · detail=full → full · province coinvolte=1379 · regioni=1379 · copertura=OK
[PRESETS-REBUILD] mondo_1936: 39 nazioni · map=pax_modern_provinces (4475 feature, 224 paesi) · detail=grouped → grouped · province coinvolte=2393 · regioni=814 · copertura=OK
[PRESETS-REBUILD] mondo_1989: 31 nazioni · map=standard (243 feature, 243 paesi) · detail=nations → nations · province coinvolte=31 · regioni=31 · copertura=OK
```

### Nota sui conteggi (superamento parziale di PRESETS-REBUILD)

PRESETS-REBUILD imponeva 25–45 nazioni per preset. WORLD-ALIVE P2 rimuove
deliberatamente gli Stati anacronistici, quindi `europa_1815` scende a **15** e
`europa_1914` a **21**. Il test è stato aggiornato a un conteggio **esatto per
preset**, più stringente della banda precedente e con la motivazione nel codice.
È una scelta richiesta esplicitamente da questo task (coerenza storica > numero).

---

## 7. Limiti residui (dichiarati, non aggirati)

1. **Le geometrie restano a confini moderni.** I nomi si cambiano, i confini no.
   - «Austria-Ungheria» (`AUT`) ha la geometria dell'**Austria moderna**: perde
     Ungheria, Boemia, Croazia, Galizia.
   - «Impero Ottomano» (`TUR`) ha la geometria della **Turchia moderna**: perde
     i vilayet balcanici e arabi.
   - «Impero Russo» (`RUS`) ha la geometria della **Federazione Russa**; i
     governatorati baltici, ucraini, bielorussi e finlandesi **non sono più
     regioni di gioco** (sono le aree rimaste senza owner).
   - «Regno di Jugoslavia» (`SRB`) e «Cecoslovacchia» (`CZE`) hanno le geometrie
     di Serbia e Cechia.
   - Conseguenza visibile: **aree senza owner** (Polonia e Balcani nel 1914;
     Europa centro-orientale nel 1815) e **superfici non proporzionali** agli
     imperi. Non è un bug: è il limite delle mappe native.
2. **Proxy inevitabili**: `DEU`/`ITA` nel 1815 non sono singoli Stati.
3. **Nessuna mappa storica**: `map_base` resta una delle 4 mappe native moderne.

### Fase successiva proposta (fuori da questo intervento)

1. **Mappe storiche dedicate** (`map.geojson` del 1815/1914 con confini
   dell'epoca) caricate come `map_geojson` di preset — richiede dataset storici
   (es. Natural Earth historical / HGIS) e la pipeline di validazione già
   esistente (`has_custom_map`, whitelist, coverage guard).
2. **In alternativa (più economica): `map_grouping` imperiale.** Le mappe
   provinciali moderne hanno già granularità provinciale: un `map_grouping` che
   mappi le province su macro-aree («Austria-Ungheria», «Impero Ottomano»,
   «Impero Russo») permetterebbe di raggruppare province moderne in un'unica
   politia imperiale **senza ridisegnare i confini**. Serve però un'estensione
   di `deriveGroups` per raggruppare **oltre** i confini nazionali (oggi raggruppa
   solo dentro un `owner`) — da valutare come intervento a sé, con test di
   copertura.
3. **Aree senza owner**: se si vogliono evitare i «buchi», si può aggiungere un
   owner neutrale/indipendente per le province non assegnate (design decision,
   non in questo task).
