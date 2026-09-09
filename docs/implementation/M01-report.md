# M01 — Cataloghi, preset e qualità dei dati

## Fotografia

- **Pacchetto:** M01, micro-consegne 1–5 (µ1: formato catalogo `simulation/` per il maestro §4, loader/validatore con import strict, script `validate:scenario`, fixture tecnica `realism_test_world`; µ2: catalogo pilota `cold_war_1951_v2` in NUOVA versione del preset con fonti reali verificate; µ2-bis: contratto **multi-valuta** retrocompatibile + URSS nel pilota; µ3: modalità strict/authored operative nel percorso di generazione mondo + cache e riuso per **impronta di contenuto**; µ4: editor del catalogo con checklist, errori per campo, copertura e **import strict bloccato** su errori irrisolti).
- **Stato:** µ1 completata e verificata; µ2 completata e verificata, ma il pilota **non è completo e non è approvato**: copre solo la polity USA con la filiera energetica 1951 (carbone + greggio). **Il gate di realismo storico resta CHIUSO** (DoD): servono fonti per acciaio/ferro/grano, riserve minerarie, saldo di cassa 1951, supporto multi-valuta per l'URSS, più revisione indipendente.

## Audit coperto

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT01 | Import strict rifiutato con percorso e motivo: riferimento a risorsa inesistente, ciclo nel grafo delle conoscenze, quantità non canonica, valuta di conto diversa dal manifest, file di catalogo mancante | Verde (`scenario-catalog.test.ts`) |
| MAT02 (parte) | Giacimento senza quantità nota né stima → `unknown_quantity` come WARNING, mai dato fabbricato; mai fallback moderno silenzioso | Verde |
| MAT18 (base) | Hash di contenuto per ogni file di catalogo; contenuto diverso → hash diverso, stesso contenuto → stesso hash (basis cache di versione) | Verde |
| MAT34 (base) | Ricetta amplificatrice sulla stessa risorsa rifiutata senza `allowsRecycle`; durata 0 rifiutata (niente cicli a tempo zero); l'estrazione senza input NON è amplificazione | Verde |
| §4.4 chiusura | Chiusura transitiva delle filiere: input senza stock iniziale, giacimento estraibile o filiera ricorsiva → `unjustified_input` bloccante; catena intera giustificata accettata a punto fisso | Verde |
| §4.1 codec | `IntString` canonico (no `-0`, `01`, `1.5`, `0x10`, numeri IEEE-754); saldi/quantità come stringhe decimali intere; ratei `numerator/denominator` con denominatore > 0 | Verde |
| §4.3/§4.3.1 | Tipi dominio: `EconomicActor` distinto da `Polity`, matrice di autorità R1 con i tre consensi separati (`user`/`institutional`/`counterparty`), `Deposit.known: null` = ignoranza distinta da assenza, `EstimatedRange` low/base/high con `Evidence` | Verde (tipi + fixture) |

**µ2 (pilota `cold_war_1951_v2`)** — test in `scenario-pilot.test.ts`:

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT02 (µ2) | Filiere senza fonti verificate (acciaio, ferro, grano) ESCLUSE dal catalogo; giacimenti `known: null` → 2 warning `unknown_quantity` attesi e verificati, zero errori; saldo cassa 1951 non raggiunto → `0` dichiarato come ancoraggio di modellazione in `sources.md` | Verde |
| MAT24 (spirito) | Nessun valore inventato per attivare il pilota: le produzioni portano `evidence.quality: 'sourced'` con `sourceRefs` e `methodVersion` dichiarata | Verde |
| §4.3.1 (µ2) | Attori economici reali 1951 con i sei tipi (treasury/public_enterprise/private_sector/bank/carrier/household); la matrice R1 copre i tre consensi senza mescolarli; la produzione privata richiede `counterparty` | Verde |
| Piano passo 1 (µ2) | Il pilota è una NUOVA versione (`cold_war_1951_v2`): il preset v1 NON è toccato e resta legacy dichiarato (`no_catalog`) | Verde |
| Fonti (µ2) | Produzione USA 1951 da Energy Institute/OWID/EIA (pre-1965: Etemad & Luciani, dichiarata stima): carbone 3.938,8542 TWh → `round(3938854/365) = 10791 GWh/giorno`, greggio 3.532,659 TWh → `9679`; conversione dichiarata in `methodVersion`; capacità distinta dalle quantità | Verde |
| Censimento (µ2) | Popolazione USA 1950 = 151.325.798 (U.S. Census Bureau) usata come pool proxy dichiarato al 1951, senza tassi di crescita inventati | Verde |

**µ2-bis (multi-valuta + URSS)** — test in `scenario-pilot.test.ts` (blocco «µ2-bis»):

| Audit / Test | Asserzione | Esito |
|---|---|---|
| §4.1 (µ2-bis) | Contratto multi-valuta: `manifest.currencies[]` (id + sottomultiplo obbligatorio); le tesorerie possono stare in CIASCUNA valuta dichiarata; una valuta NON dichiarata è SEMPRE rifiutata; senza `currencies` il comportamento resta identico a µ1 (retrocompatibile) | Verde |
| Fonti (µ2-bis) | Produzione URSS 1951 dalla medesima fonte verificata: carbone 1.606,4044 TWh → `round(1606404/365) = 4401 GWh/giorno`, greggio 491,40237 TWh → `1346`; attribuita all'industria di stato AGGREGATA (design dichiarato); `evidence.quality: 'sourced'` | Verde |
| Popolazione URSS (µ2-bis) | 181.582.000 media annuale 1951 (Goskomstat/Demoscope) usata come pool proxy dichiarato, nessun aggiustamento inventato | Verde |
| §4.3.1 (µ2-bis) | Attori sovietici reali esistenti nel 1951 (MinFin, industria di stato aggregata, Gosbank, MPS, famiglie); tesoreria in rubli (SUR); autorità sovietiche: stanziamento e produzione di stato richiedono consenso istituzionale | Verde |
| Nessuna regressione (µ2-bis) | Ricette USA invariate; fixture `realism_test_world` valida; preset v1 legacy dichiarato | Verde |

**µ3 (piano passo 4)** — test in `balance-mode.test.ts`:

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT18 | Cache balance per impronta di CONTENUTO: stesso template + impronte diverse → cache diverse e LLM richiamato; stessa impronta → cache hit; template legacy (senza impronta) non eredita la cache di un catalogo | Verde |
| MAT18 (riuso) | Riuso baseline guardato: mondo con impronta diversa NON riusato; mondo con la STESSA impronta riusato (LLM non chiamato); template legacy non vede mondi con catalogo (COALESCE guard in SQL) | Verde |
| Piano passo 4 (strict) | `balanceWorld(mode)`: in **strict** nessuna declassazione/promozione di potenze e nessuna alleanza forzata (input intatto); in **authored** il comportamento esistente è invariato | Verde |
| Impronta | `catalogFingerprint(hashes)`: deterministica (ordine chiavi non conta), cambia al variare delle regole; il pilota ha impronta a 24 hex ≠ null | Verde |

**µ4 (piano passo 5)** — test in `scenario-editor.test.ts`:

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT01 (µ4) | Import strict di un preset zip con catalogo ROTTO → 400 con «Import strict rifiutato» + percorso e motivo (`duplicate_id`), NESSUNA scrittura su disco (la dir del preset non esiste) | Verde |
| MAT01 (µ4) | Import strict di un preset zip con catalogo VALIDO → 201 e `simulation/` estratto su disco, `loadSimulationCatalog` ok | Verde |
| Piano passo 5 (µ4) | `GET /templates/:id/scenario` → rapporto per l'editor: hasCatalog, errori/warning con percorsi JSON, `coverage` (giustificate/mancanti/giacimenti unknown), hash di contenuto; preset legacy → `hasCatalog: false, report: null` (nessun finto rapporto); preset inesistente → 404 | Verde |
| §4.4 (µ4) | `coverage.missing` espone le risorse richieste senza fonte (chiusura transitiva), `coverage.justified` le filiere chiuse | Verde |

## File

- `backend-nest/src/scenario/types.ts` — **nuovo**: tipi del catalogo (maestro §4.2/§4.3): `IntString`+codec, `Evidence`, `SourceQuality`, `ScenarioManifest` (valuta, modalità strict/authored, dichiarazione synthetic/rigorous/estimated/ucronia), `ResourceDefinition`, `KnowledgeNode`, `Recipe`, `FacilityType`, `EconomicActor`, `AuthorityRule`, `Polity`, `Deposit`, `InventoryLot`, `TreasuryAccount`, `WorkforcePool`, `FacilityInstance`, `SimulationCatalog`.
- `backend-nest/src/scenario/loader.ts` — **nuovo**: `validateCatalog` (validazione in memoria con rapporto `ScenarioIssue[]` con percorsi JSON precisi) e `loadSimulationCatalog` (caricamento da disco), `catalogHash` (SHA-256 per file, base cache MAT18).
- `backend-nest/src/scenario/cli.ts` — **nuovo**: CLI `validate:scenario` — rapporto JSON su stdout + sintesi umana su stderr, exit 1 su errori bloccanti; preset senza `simulation/` dichiarati legacy con warning.
- `backend-nest/data/presets/realism_test_world/` — **nuova fixture**: `preset.json` + `simulation/{manifest,polities,resources,technologies,recipes,facilities,actors,authorities,initial-state}.json` + `sources.md`. Sintetica, deterministica, dichiaratamente non storica: valuta `TEST` (convenzione di test, §4.1.8), 2 polities fittizie, filiera minerale+carbone→acciaio→utensili, grano con riciclo `allowsRecycle` esplicito, deposito `hidden` con stima `estimated` per distinguere ignoranza da assenza.
- `backend-nest/tests/scenario-catalog.test.ts` — **nuovo**: 14 test (codec §4.1, fixture valida, hash MAT18, MAT01 ×5, amplificazione/chiusura ×5, legacy dichiarato).
- `backend-nest/package.json` — script `validate:scenario` (`tsc && node dist/scenario/cli.js`; nota: `tsx`/esbuild non eseguono su questo macOS, la CLI usa il `dist/` compilato con `tsc`).

**µ2 (pilota storico)**
- `backend-nest/data/presets/cold_war_1951_v2/` — **nuovo preset pilota** (NUOVA versione, non modifica `cold_war_1951` v1 né alcuna partita): `preset.json` + `simulation/*` completi. Perimetro: polity USA; risorse carbone e greggio in GWh; 2 ricette di estrazione con `evidence.quality: 'sourced'` e `methodVersion` (conversione annuale→giornaliera dichiarata); tecnologie datate (Spindletop 1901, brevetto Burton–Humphreys 1908); attori reali (Tesoro, TVA, Fed, Pennsylvania Railroad, settori privati AGGREGATI dichiarati, famiglie); matrice di autorità R1; censimento 1950 come proxy dichiarato; giacimenti `known: null` (ignoranza dichiarata); tesoreria USD con saldo `"0"` dichiarato ancoraggio di modellizzazione, non dato storico.
- `backend-nest/data/presets/cold_war_1951_v2/simulation/sources.md` — fonte di verità delle fonti: tabella di conversione, limiti del metodo dichiarati, sezione «dati non inclusi» (acciaio/ferro/grano, riserve, cassa, URSS multi-valuta, quote regionali).
- `backend-nest/tests/scenario-pilot.test.ts` — **nuovo**: 23 test (import e dichiarazione, fonti reali e metodo, ignoranza dichiarata MAT02, matrice R1, contratto multi-valuta, URSS su fonti reali, nessuna regressione su fixture e preset v1).

**µ2-bis (modifica contratto + URSS)**
- `backend-nest/src/scenario/types.ts` — `ScenarioManifest.currencies?: Array<{id, minorUnitName}>` (opzionale, retrocompatibile).
- `backend-nest/src/scenario/loader.ts` — validazione di `manifest.currencies[]` (id e sottomultiplo obbligatori); le tesorerie sono accettate in qualunque valuta dichiarata; valuta non dichiarata sempre rifiutata.
- `backend-nest/data/presets/cold_war_1951_v2/simulation/*` — estesi: `manifest.currencies` (USD cent, SUR kopeck), polity `USSR`, attori sovietici reali (MinFin, industria di stato, Gosbank, MPS, famiglie), ricette estrazione URSS 1951 (`4401`/`1346` GWh/giorno con `methodVersion`), pool popolazione URSS (181.582.000, proxy), depositi `known: null`, tesoreria `acc_ussr_treasury` in SUR, autorità sovietiche; `sources.md` con le sezioni `produzione-energetica-urss-1951` e `popolazione-urss-1951` e il punto 4 di «dati non inclusi» marcato RISOLTA.

**µ3 (modalità + impronta)**
- `backend-nest/src/scenario/loader.ts` — `catalogFingerprint(hashes)`: SHA-256 canonico sugli hash di contenuto ordinati (basis di cache e riuso, MAT18).
- `backend-nest/src/database.ts` — migrazione additiva `worlds.catalog_fingerprint TEXT DEFAULT NULL` (pattern F02: guard su duplicate column).
- `backend-nest/src/repositories/world.repository.ts` — `create`/`createWithRegions` accettano e persistono `catalogFingerprint`; `WorldRecord.catalog_fingerprint`; `findById` lo restituisce (SELECT *).
- `backend-nest/src/agents/balance-agent.ts` — `generateInitialWorldState(template, override?, onProgress?, options?: SimulationGenerationOptions)` con `mode` e `catalogFingerprint`; `CACHE_VERSION` 2→3; chiave cache include `catalog`; il file di cache porta `catalogFingerprint` (difesa su load); `reuseExistingWorld` filtra con `COALESCE(catalog_fingerprint,'') = COALESCE(?,'')` (mondi con catalogo ↔ stessa impronta, legacy ↔ legacy); `balanceWorld(countries, mode)`: in strict ritorna SENZA riequilibrare (niente declassazione/promozione/alleanze forzate).
- `backend-nest/src/routes/worlds.routes.ts` — `runWorldGeneration` carica il catalogo del preset (`loadSimulationCatalog`), passa `{mode, catalogFingerprint}` al BalanceAgent e registra l'impronta sul mondo creato; preset legacy senza `simulation/` mantengono il comportamento invariato.
- `backend-nest/tests/balance-mode.test.ts` — **nuovo**: 6 test (strict vs authored, cache per impronta ×2, riuso guardato, impronta del pilota).

**µ4 (editor del catalogo)**
- `backend-nest/src/scenario/loader.ts` — `ScenarioReport.coverage: { justified: string[], missing: string[], unknownDeposits: number }` (chiusura delle filiere esposta all'editor); percorso legacy con coverage vuota.
- `backend-nest/src/utils/preset-zip.ts` — l'archivio ammette `simulation/*.json|md`; il catalogo è validato IN MEMORIA **prima di ogni scrittura su disco**; con errori bloccanti → `PresetZipError('INVALID_PRESET', 'Import strict rifiutato: …path [code] message…')` e nessuna estrazione; `buildPresetZip` esporta `simulation/` (round-trip senza perdita).
- `backend-nest/src/routes/presets.routes.ts` — `GET /templates/:id/scenario`: rapporto per l'editor (hasCatalog, report o null per legacy, 404 su preset inesistente).
- `backend-nest/tests/scenario-editor.test.ts` — **nuovo**: 6 test (route rapporto ×3, import valido/rotto, coverage).
- `frontend/src/services/api.ts` — `templatesApi.getScenarioReport(id)` + tipi `ScenarioIssueView`/`ScenarioCoverageView`/`ScenarioReportView`.
- `frontend/src/components/Game/PresetEditorModal.tsx` — **tab «4. Catalogo»**: checklist dei 9 file di catalogo con esito ✓/✗ e hint, errori per campo (`path [code] message`), stato **Import strict BLOCCATO/disponibile**, anteprima copertura delle filiere, avvisi `unknown` (dati non fabbricati); preset legacy mostrati come dichiaratamente non migrati.
- `frontend/src/index.css` — stili per la tab catalogo (checklist, errori, copertura, avvisi).

## Comportamento prima

Non esisteva alcun catalogo di scenario: i preset avevano solo metadati (`preset.json`, lore, regole testuali) e nessuna validazione di riferimenti, DAG, unità, bilanci o chiusura delle filiere. Non era possibile distinguere un dato `sourced` da un dato inventato, né un preset legacy da uno migrato.

## Contratto API

- `loadSimulationCatalog(presetDir)` → `{ catalog: SimulationCatalog | null, report: ScenarioReport }`; `catalog` è null se il catalogo è assente (legacy) o non valido (mai catalogo parziale).
- `validateCatalog(files)` → `ScenarioReport { presetId, ok, errors[], warnings[], catalogHashes }`; ogni issue ha `path` JSON preciso, `code` (`unknown_ref`, `dag_cycle`, `bad_int`, `bad_duration`, `amplifying_recipe`, `unjustified_input`, `currency_mismatch`, `missing_file`, `no_catalog`, `unknown_quantity`, …) e `severity`.
- CLI: `npm run validate:scenario [presetDir…]` — exit 0/1.

## Algoritmo (punti notevoli)

- **Chiusura transitiva (§4.4)** a punto fisso: una risorsa è giustificata se ha stock iniziale, un giacimento noto non-`hidden`, o una ricetta i cui output E input sono tutti giustificati (la catena intera, non i singoli passi).
- **Amplificazione**: rifiutata solo se la stessa risorsa è input E output con output > input senza `allowsRecycle` esplicito; l'estrazione senza input non è un ciclo. Le magnitudini per risorsa sono raccolte come valori positivi (difetto corretto in fase di test: la prima versione accumulava segni negativi e non flaggava mai).
- **DAG conoscenze**: DFS con stato visiting/visited; ciclo → bloccante.
- **Ignoranza vs assenza (MAT02)**: `Deposit.known: null` senza stima → warning `unknown_quantity`, mai errore né dato inventato.

## Migrazioni

Nessuna. La fixture è un preset nuovo; i preset esistenti non sono toccati (dichiarati legacy dal validatore con warning, mai migrati silenziosamente). Nessun tocco a `data/world-story.db`.

## Comandi test

```
npm --prefix backend-nest test                       # 36 file; 328/328 verdi (14 µ1 + 23 pilota + 6 µ3 + 6 µ4)
npm --prefix backend-nest run build                  # tsc OK
npm --prefix backend-nest run validate:scenario      # ok: true, blocking: 0; cold_war_1951_v2: 0 errori, 4 warning unknown_quantity attesi (2 USA + 2 URSS)
cd frontend && ../node_modules/.bin/vitest run       # 14/14 (invariata)
npm --prefix frontend run build                      # tsc + vite OK
```

## Cosa NON è implementato / dipendenze mute

- **Il pilota NON è completo né approvato** (gate realismo storico CHIUSO). Chiusura richiesta da `sources.md#dati-non-inclusi`:
  1. fonti per acciaio, minerale di ferro e grano 1951 (AISI/UN Statistical Yearbook/FAOSTAT non raggiunte in sessione);
  2. riserve minerarie 1951 per USA e URSS (oggi `known: null` dichiarato — 4 warning `unknown_quantity` attesi);
  3. saldi di cassa 1951 (oggi `"0"` = ancoraggi di modellizzazione, NON dati storici — finanza operativa in M02);
  4. quote regionali/per-impresa e per-ministero 1951;
  5. revisione indipendente delle fonti (revisore ≠ implementatore).
- ~~Supporto multi-valuta~~ **RISOLTO in µ2-bis** (`manifest.currencies`, retrocompatibile): URSS nel pilota con tesoreria in rubli, produzione energetica 1951 verificata e popolazione proxy.
- ~~**µ3 (piano passo 4):**~~ **FATTA in µ3** — separazione operativa strict/authored nella generazione mondo (strict ⇒ nessun bilanciamento di alleanze/potenze) e cache/riuso per impronta di contenuto (MAT18). Residuo dichiarato: la **scelta della modalità resta legata al catalogo del preset** (un mondo creato da un preset con catalogo strict nasce rigoroso); la commutazione a runtime di una partita esistente non è prevista dal piano (il manifest è immutabile per partita/ramo, §4.3).
- ~~**µ4 (piano passo 5):**~~ **FATTA in µ4** — editor con checklist, errori per campo, anteprima copertura e import strict bloccato su errori irrisolti. Residuo dichiarato: la tab **Catalogo è di lettura/validazione** (checklist + rapporto): l'editing dei file `simulation/*.json` avviene sul disco o via zip, non direttamente nel modal; il salvataggio del preset non riscrive il catalogo.
- **µ4 (piano passo 5):** UI editor con checklist materiali/tecnologia/unità/fonti.
- Le entità del catalogo non sono ancora collegate al motore: il collegamento (TurnOrchestrator/EffectValidator) è M06; aritmetica ledger/riserve è M02.

## Decisione revisore

Da definire con revisione indipendente (revisore ≠ implementatore).

---

# M01 µ2 — Catalogo pilota `cold_war_1951_v2` (storico con stime dichiarate)

## Fotografia

- **Pacchetto:** M01, micro-consegna 2 (piano passi 2–3): pilota candidato
  `cold_war_1951` in una **NUOVA versione del preset** (`cold_war_1951_v2`),
  senza alcuna modifica al preset v1 né alle partite esistenti.
- **Stato:** **parziale e dichiaratamente incompleto**. Il pilota copre la
  polity **USA** con la filiera energetica 1951 (carbone + greggio) su fonti
  reali verificate. Il gate di realismo storico **resta CHIUSO** (DoD: senza
  pilota completo e approvato la µ non si chiude come «pilota approvato»).
- **Scoperta vincolante:** il validatore M01 ammette **una sola valuta per
  catalogo** (`currency_mismatch` su ogni treasury non in valuta del
  manifest): l'URSS non può entrare nel pilota finché non esiste supporto
  multi-valuta. Dati URSS 1951 comunque raggiunti e registrati in
  `sources.md#dati-non-inclusi` per la µ successiva.

## Audit coperto

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT01 | Import strict del pilota: catalogo completo (9 file), zero errori bloccanti | Verde (`scenario-pilot.test.ts`) |
| MAT02 | Giacimenti 1951 senza riserve verificate → `known: null` con warning `unknown_quantity` (2), mai stime inventate; filiere senza fonti (acciaio/ferro/grano) ESCLUSE dal catalogo | Verde |
| MAT18 | Hash di contenuto per i 9 file del pilota (`catalogHashes` nel rapporto CLI) | Verde |
| MAT24 (base) | Dichiarazione `historical_estimated` + `mode: strict` esplicita nel manifest | Verde |
| MAT33 (base) | Riferimenti a risorse/impianti/attori tutti risolti (import strict) | Verde |
| MAT34 (base) | Ricette di estrazione senza input: nessun ciclo amplificatore; durata ≥ 1 giorno | Verde |
| MAT35 (base) | Tesoreria in valuta del catalogo (USD), saldo IntString canonico | Verde |
| §4.3.1 | Attori reali (Treasury 1789, Fed 1913, TVA 1933, Pennsylvania Railroad, aggregati dichiarati) con i sei tipi; tre consensi R1 separati; settore privato non magazzino del governo | Verde |
| Provenienza | Ogni quantità produttiva con `evidence.quality: "sourced"`, `sourceRefs`, `validAt: 1951-12-31` e `methodVersion` con la conversione dichiarata | Verde |

## File

- `backend-nest/data/presets/cold_war_1951_v2/` — **nuovo preset pilota**:
  `preset.json` (v2, metadati copiati dal v1 con nuovo id; v1 intoccato) +
  `simulation/{manifest,polities,resources,technologies,recipes,facilities,actors,authorities,initial-state}.json`
  + `simulation/sources.md` (fonti, metodi di conversione, dati NON inclusi).
- `backend-nest/tests/scenario-pilot.test.ts` — **nuovo**: 14 test
  (dichiarazione, conversioni annuali→giornaliere, censimento, ignoranza
  dichiarata, consensi R1, non-regressione fixture/legacy).
- **Nessun file esistente modificato** (solo `dist/` ricompilato).

## Comportamento prima

Il pilota non esisteva: `cold_war_1951` v1 è un preset ucronico legacy senza
catalogo. Non esisteva alcun esempio di catalogo storico con fonti reali,
metodo di conversione dichiarato e ignoranza modellata.

## Contratto API

- Nessun cambiamento di API runtime: il catalogo pilota è dato, non codice.
  `loadSimulationCatalog('…/cold_war_1951_v2')` → `{ catalog, report }` con
  `report.ok: true`, 0 errori, 2 warning `unknown_quantity` attesi.
- CLI: `npm run validate:scenario` → `ok: true, blocking: 0, warnings: 9`
  (7 preset legacy dichiarati + 2 del pilota).

## Algoritmo (metodo dichiarato)

- **Produzione → capacità**: l'annuale 1951 (fonte) diventa capacità
  giornaliera con `round(annuale / 365)`: carbone
  `3.938.854 GWh/anno → 10791 GWh/giorno`; greggio
  `3.532.659 GWh/anno → 9679 GWh/giorno`. Le ricette producono l'equivalente
  di un giorno per run (`durationDays: 1`); capacità e quantità restano
  distinte (§4.1.7).
- **Unità energetiche**: le fonti raggiungibili (Energy Institute/EIA via
  OWID) esprimono carbone e greggio in TWh: il catalogo usa `GWh` (interi
  canonici) invece di convertire in tonnellate con fattori non verificati.
- **Ignoranza modellata**: riserve 1951 non verificate → depositi con
  `known: null` (warning, mai dato inventato); saldo di cassa Tesoro non
  raggiunto → `0` dichiarato come ancoraggio di modellizzazione in
  `sources.md#dati-non-inclusi` (la finanza operativa è M02).

## Fonti (verificate il 2026-09-08)

- Energy Institute — Statistical Review of World Energy (2026), serie OWID
  `coal-production-by-country` / `oil-production-by-country` (righe
  `United States,USA,1951`: 3938,8542 e 3532,659 TWh; pre-1965: Etemad &
  Luciani 1991, complemento EIA). URSS 1951 (per µ futura): 1606,4044 e
  491,40237 TWh.
- U.S. Census Bureau: censimento 1950 = 151.325.798 residenti (proxy
  dichiarata al 1951-01-01, nessun aggiustamento).
- Spindletop 10/1/1901; brevetto Burton–Humphreys 8/6/1908 (date
  `validFrom` delle tecnologie).

## Migrazioni

Nessuna. Nuovo preset in directory nuova; v1 e tutte le partite intatti;
nessun tocco a `data/world-story.db` (solo test).

## Comandi test

```
npm --prefix backend-nest test                        # 34 file; 307/307 verdi (14 nuovi)
npm --prefix frontend run build && npm --prefix backend-nest run build   # OK
npm --prefix backend-nest run validate:scenario       # ok: true, blocking: 0, warnings: 9
```

## Cosa NON è implementato / dipendenze mute

- **Pilota completo**: acciaio, minerale di ferro, grano (fonti AISI/UN/
  FAOSTAT non raggiunte in questa sessione), riserve minerarie, saldo di
  cassa 1951, quote regionali/per-impresa, **URSS** (bloccata dal vincolo
  una-valuta-per-catalogo: serve estensione multi-valuta del loader, da
  concordare come µ propria).
- **µ3**: separazione operativa strict/authored + cache per hash.
- **µ4**: UI editor con checklist fonti.
- Il catalogo non è ancora collegato al motore (M06); aritmetica ledger M02.

## Decisione revisore

Da definire con revisione indipendente (revisore ≠ implementatore). Il gate
di realismo storico resta chiuso: questa µ consegna un **pilota parziale
validato**, non un «pilota approvato».

---

# M01 µ2-bis — Contratto multi-valuta e URSS nel pilota

## Fotografia

- **Pacchetto:** M01, micro-consegna 2-bis (HANDOFF §6, opzione A): estensione
  del contratto del loader a valute per-polity e ingresso dell'**URSS** nel
  pilota `cold_war_1951_v2` con fonti reali.
- **Stato:** completata e verificata. **MODIFICA DEL CONTRATTO del loader**
  (retrocompatibile): segnalata per **revisione indipendente** prima di ogni
  eventuale chiusura. Il gate di realismo storico **resta CHIUSO** (mancano
  acciaio/ferro/grano, riserve, cassa; e il pilota non è approvato).
- Il pilota ora copre **USA + URSS**: due polities, due valute (USD, SUR),
  filiera energetica 1951 completa per entrambe, popolazioni da fonte.

## Audit coperto

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT24 (contratto) | `manifest.currencies` ammette più valute; ogni `treasury.currencyId` DEVE appartenere all'insieme dichiarato (o a `currency`) | Verde (`scenario-pilot.test.ts`) |
| Retrocompatibilità | Senza `currencies` il comportamento è identico a µ1: treasury in valuta non dichiarata → `currency_mismatch` (test su realism_test_world con conto USD) | Verde |
| MAT01 | Catalogo esteso USA+URSS importato senza errori bloccanti | Verde |
| MAT02 | Depositi URSS senza riserve verificate → `known: null` con warning `unknown_quantity` (tot. 4 con USA), mai stime inventate | Verde |
| MAT18 | Hash di contenuto dei 9 file aggiornati nel rapporto CLI | Verde |
| Provenienza URSS | Carbone 1.606.404 GWh/anno → 4401 GWh/giorno; greggio 491.402 GWh/anno → 1346 GWh/giorno; `evidence.quality: "sourced"`, `methodVersion` dichiarata | Verde |
| §4.3.1 | Istituzioni sovietiche reali (MinFin, Gosbank, MPS) + aggregati dichiarati; autorità di pianificazione con consenso istituzionale | Verde |
| Popolazione | URSS 1951: media annuale 181.582.000 (tabella demografica sovietica, proxy dichiarata) | Verde |

## File

- `backend-nest/src/scenario/types.ts` — `ScenarioManifest.currencies?`
  (nuovo campo opzionale, documentato nel codice).
- `backend-nest/src/scenario/loader.ts` — insieme `declaredCurrencies` da
  `currency` + `currencies[]`; il check treasury usa l'insieme (message con
  tutte le valute dichiarate). Nessun altro comportamento toccato.
- `backend-nest/data/presets/cold_war_1951_v2/simulation/*` — manifest
  (currencies + nuova fonte), polities (+USSR), recipes (+2 ricette URSS),
  facilities (+2 tipi impianto URSS), actors (+5 attori sovietici),
  authorities (+2 regole `auth_ussr_*`), initial-state (+tesoreria SUR, +2
  depositi, +pool popolazione, +2 impianti), sources.md (+sezioni URSS,
  popolazione URSS, nota contratto multi-valuta).
- `backend-nest/tests/scenario-pilot.test.ts` — 14→23 test (+9: contratto
  multi-valuta ×3, URSS ×5, test di non-regressione USA aggiornato).

## Comportamento prima

Il validatore accettava treasury SOLO in valuta unica del catalogo
(`currency`): l'URSS (rublo) non poteva coesistere con gli USA (dollaro).
Il pilota era USA-only.

## Contratto API

- **CAMBIATO (retrocompatibile):** `ScenarioManifest.currencies?: Array<
  {id, minorUnitName}>`; il check treasury passa da «uguaglianza con
  `currency`» a «appartenenza a `currency` ∪ `currencies`».
- **INVARIATO:** senza `currencies` il comportamento è identico a µ1; il
  rapporto `ScenarioReport` non cambia forma; nessuna API HTTP toccata.
- CLI: `ok: true, blocking: 0, warnings: 11` (7 legacy + 4 pilota).

## Algoritmo

- Nessuna logica nuova: solo insieme delle valute dichiarate. Conversioni
  URSS con lo stesso metodo dichiarato µ2 (`round(annuale/365)`).
- Le ricette restano globali per catalogo: la separazione per polity passa
  dai TIPI IMPIANTO (`ft_ussr_*` con capacità URSS) e dai proprietari degli
  impianti — pattern già usato dalla fixture µ1.

## Migrazioni

Nessuna (nessun DB, nessun dato reale toccato).

## Comandi test

```
npm --prefix backend-nest test                        # 34 file; 316/316 verdi (23 nel file pilota)
cd frontend && ../node_modules/.bin/vitest run        # 14/14
npm --prefix backend-nest run build && npm --prefix frontend run build   # OK
npm --prefix backend-nest run validate:scenario       # ok: true, blocking: 0, warnings: 11
```

## Cosa NON è implementato / dipendenze mute

- Acciaio, minerale di ferro, grano (fonti 1951 non ancora raggiunte),
  riserve minerarie (USA e URSS), saldi di cassa 1951, quote per-ministero
  e per-impresa, tassi di cambio (fuori perimetro: nessuna conversione
  incrociata tra valute è mai eseguita in questa µ).
- **µ2-ter**: completare il pilota USA+URSS con le fonti mancanti.
- **M02**: ledger/riserve/finanza; può usare il pilota multi-valuta.
- **Revisione indipendente del cambio di contratto**: obbligatoria prima di
  dichiarare chiusa la questione valute (HANDOFF §6, opzione A).

## Decisione revisore

Da definire con revisione indipendente (revisore ≠ implementatore): in
particolare il nuovo campo `manifest.currencies` e la semantica
«appartenenza» al posto dell'uguaglianza. Il gate di realismo storico resta
CHIUSO.