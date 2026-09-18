# COUNTRY-CLARITY ENGINE — la dottrina militare e l'industria diventano dati del motore

**Obiettivo.** Chiudere COUNTRY-CLARITY intervenendo **solo sui dati strutturali**
che impedivano al Dossier di rappresentare il paese: niente rifacimento della UI,
niente secondo motore, niente regole inventate nel browser.
Principio invariato: **ENGINE DATA → READ MODEL → UI**.

**Esito.** Tredici problemi confermati (P1–P13) chiusi. Due moduli puri nuovi nel
motore (`MilitaryDoctrine`, `IndustrialCapacity`), un servizio esteso
(`MilitaryService`), un cablaggio minimo in `GameSession`, tre read model del
frontend riscritti per **leggere** invece di **calcolare**. Zero endpoint nuovi,
zero chiamate LLM, zero migrazioni.

---

## 1. Problema

Il Dossier Nazione era leggibile, ma alcune cifre che mostrava non erano dati:
erano regole di presentazione. Le più fragili erano militari e industriali.

| # | Problema confermato | Dove viveva la regola | Che cosa mostrava davvero |
|---|---|---|---|
| P1 | Manpower: riserva mobilitabile `null` | frontend, dichiarata assente | «non modellata», quindi nessuna risposta utile |
| P2 | `ESTABLISHMENT` (dotazioni di riferimento) | `frontend/.../militaryOperatingPicture.ts` (costante) | una tabella valida per ogni epoca, anche per il 1815 |
| P3 | Copertura per categoria | frontend, da `forces`/`mobilized` e dalle righe dell'arsenale | nessun uomo, nessuna dottrina |
| P4 | Prontezza operativa | frontend (formula + soglie) | una formula del browser, non del motore |
| P5 | `capacityUsed = min(capacityTotal, assignments.length)` | frontend | «un ordine = una linea»: convenzione, non dato |
| P6 | Nessuna assegnazione reale per stabilimento/progetto/impianto | frontend | conteggio, non attribuzione |
| P7 | `deliveredUnits = quantity × progress / 100` | frontend | unità dichiarate consegnate mentre la linea lavora ancora |
| P8 | Produzione interna vs import | frontend, parziale | «producibile in casa» senza distinguere l'importazione obbligata |
| P9 | Molte chiamate necessarie | — | rischio di N endpoint per N numeri |
| P10 | Read model che ricalcolavano il motore | 3 moduli frontend | doppia verità |
| P11 | Scheda FORZE senza personale/dotazioni | — | reparti sì, uomini no |
| P12 | Scheda INDUSTRIA senza assegnazioni | — | capacità occupata non leggibile per lavorazione |
| P13 | Compatibilità fra scenari | frontend, costante unica | carri armati in un mondo del 1815 |

La causa comune è una sola: **le regole strutturali non erano nel motore**, e
senza un'autorità il browser doveva inventarle.

---

## 2. Intervento

### P1 — `MilitaryDoctrine`: una sola autorità per le regole militari
Nuovo modulo puro `backend-nest/src/core/simulation/MilitaryDoctrine.ts`:

1. **Epoca militare** dello scenario dalla **data d'inizio del mondo** (non dalla
   data corrente: la dottrina non si riscrive mentre la partita avanza):
   `pre_industriale` (<1861), `grande_guerra` (1861–1918), `seconda_guerra`
   (1919–1945), `guerra_fredda` (1946–1989), `moderno` (≥1990). Data illeggibile
   → `guerra_fredda`, che è la data di partenza predefinita del gioco.
2. **Manpower**: i reparti del motore diventano **uomini** con un rapporto
   dichiarato (`menPerFormation`: 800 → 12.000 secondo l'epoca) e la **riserva
   addestrata** si deriva dalla popolazione in età utile (`eligibleShare`),
   con gli invarianti garantiti *per costruzione*:
   `reserve ≤ max(0, pool − active)`, `reserve ≥ mobilized`,
   `availableReserve = reserve − mobilized ≥ 0`. I reparti in servizio **non**
   vengono ridotti da una popolazione piccola: sono un fatto del motore.
3. **Establishment** per epoca: solo categorie pertinenti (in 1815 non esistono
   carri, aerei o missili), con peso dichiarato per la prontezza. Le due costanti
   ancorate al seed del motore (40 armi individuali per reparto, 50 per reparto
   richiamato) sono esportate una volta e riusate da seed, copertura e test.
4. **Copertura** dal **personale effettivo** e dall'**arsenale reale**; il filtro
   per i paesi senza sbocco al mare resta un dato del motore (`ports === 0` →
   nessun requisito navale; dato assente ≠ zero).
5. **Prontezza**: media pesata della copertura (pesi d'epoca normalizzati sulle
   categorie presenti) modulata da carburante, scorte di armamenti, qualità media
   e pressione dei richiamati, con **driver leggibili** (tono + etichetta +
   dettaglio) e soglie dichiarate (80/65/50/35).
6. **Seed d'arsenale d'epoca**: armi individuali per i reparti e mezzi di
   mobilità **solo dove l'epoca li prevede**.

### P2 — `IndustrialCapacity`: la capacità industriale come regola del motore
Nuovo modulo puro `backend-nest/src/core/simulation/IndustrialCapacity.ts`:

- **Totale** dalle linee degli impianti che il motore già conta
  (fabbriche × 10, porti × 4, atenei × 2) con l'origine dichiarata.
- **Domanda** di tre tipi di lavorazione che il motore conosce:
  ordini militari (dalle `requires` della voce di catalogo + complessità del
  dominio: **non** «1 ordine = 1 linea»), progetti in corso (proporzionale al
  lavoro residuo), manutenzione impianti (dai termini dichiarati dal catalogo).
- **Saturazione rappresentata**: `used ≤ total`, linee libere, quota difesa e
  un **fattore di rallentamento** (`overflowFactor`) che non rifiuta nulla ma
  dice la verità sui tempi; il fattore non scende sotto 0,25.

### P3 — Integrazione nel motore (minima e in un solo punto)
- `MilitaryService.getArsenal()` pubblica `epoch`, `epochLabel`,
  `establishment`, `manpower`, `coverage`, `readiness`, `industrialCapacity`.
- `MilitaryService.advanceProduction()` applica `overflowFactor` ai mesi di
  lavorazione (un solo punto) e lo dichiara nel bollettino; `getProduction()` usa
  lo stesso fattore per la data di consegna prevista, così avanzamento ed ETA
  non si contraddicono.
- `GameSession` fornisce al servizio data d'inizio scenario, progetti in corso e
  termini di manutenzione. Il catalogo degli impianti è letto **una volta per
  partita** (memo), mai a ogni richiesta.

### P9 — Nessun endpoint nuovo
Tutto viaggia dentro `/arsenal`, già caricato dal Dossier: nessuna richiesta in
più, nessun `fetch` nuovo nel browser. `industryOperatingPicture` legge la
capacità dal payload; se il motore non la pubblica, **lo dice** invece di
calcolarla.

### P10–P12 — Read model e presentazione
- `militaryOperatingPicture.ts`: nessuna formula militare residua. Legge
  manpower/copertura/prontezza/dotazioni dal motore, formatta, e unisce il
  procurement (`canBuild`/`canBuy`/`reasons` del motore) per la dipendenza
  dall'estero.
- `industryOperatingPicture.ts`: capacità, saturazione e **assegnazioni** dal
  motore; il read model aggiunge solo contesto locale (avanzamento, date,
  vincolo) cercando le lavorazioni per lo stesso id.
- `nationalOperatingPicture.ts`: le risposte della sala operativa citano gli
  uomini, non i reparti; la capacità distingue **stabilimenti** (censiti) da
  **linee di lavorazione** (capacità).
- `OperatingPictureBoard.tsx`: le schede FORZE e INDUSTRIA mostrano i blocchi
  strutturati richiesti — **Personale / Equipaggiamento / Prontezza** e
  **Stabilimenti / Assegnazioni / Produzioni / Manutenzione**.

### P7 — Consegne
`deliveredUnits` non è più stimato dal progresso: il motore consegna **solo a
lavori finiti**, quindi un ordine in corso ha consegnato **zero**. Il read model
espone anche `projectedUnits` (formula di consegna del motore, difetti compresi)
e `inProgressUnits`.

---

## 3. File

**Nuovi (motore)**
- `backend-nest/src/core/simulation/MilitaryDoctrine.ts`
- `backend-nest/src/core/simulation/IndustrialCapacity.ts`
- `backend-nest/tests/military-doctrine.test.ts` (36)
- `backend-nest/tests/industrial-capacity.test.ts` (20)
- `backend-nest/tests/industrial-capacity-service.test.ts` (9)

**Modificati (motore)**
- `backend-nest/src/game/MilitaryService.ts` (dottrina pubblicata, seed d'epoca,
  capacità industriale, rallentamento)
- `backend-nest/src/game-session.ts` (contesto: data d'inizio, progetti,
  termini di manutenzione con memo di catalogo)
- `backend-nest/tests/military-service.test.ts` (seed d'epoca)

**Modificati (read model e presentazione)**
- `frontend/src/components/Game/militaryOperatingPicture.ts` (+ test riscritto)
- `frontend/src/components/Game/industryOperatingPicture.ts` (+ test riscritto)
- `frontend/src/components/Game/nationalOperatingPicture.ts` (+ test aggiornato)
- `frontend/src/components/Game/OperatingPictureBoard.tsx` (+ test)
- `frontend/src/services/api.ts` (tipi del payload del motore)
- `frontend/src/index.css` (`.op-detail*`)
- `e2e/mock-api.mjs`, `e2e/tests/country-clarity.spec.mjs`

**FREEZE.** Sono stati toccati `MilitaryService` (dominio militare),
`game-session.ts` (cablaggio del contesto, solo accessori in lettura) e due
moduli puri nuovi di `core/simulation/`. **Non** sono stati toccati
`TurnPipelineService`, `PlaybackService`, checkpoint, branching, crisi,
`MaterialEconomy`, `WorldStateEngine`, `NationCapacity`, schema e repository.
Nessuna migrazione: tutti i dati nuovi sono **derivati**, non persistiti.

---

## 4. Compatibilità fra scenari (P13)

| Scenario | Epoca | Categorie chieste | Corazzati nel seed |
|---|---|---|---|
| 1815 | pre-industriale | armi individuali | no |
| 1914 | grande guerra | armi individuali, artiglieria, navale (se costiero) | no |
| 1936 | seconda guerra | + mobilità corazzata, supporto aereo | sì |
| 1951 | guerra fredda | + armi di supporto | sì |
| 1990+ | moderno | tutte (individuali, corazzati, supporto, artiglieria, aereo, navale, missili, droni) | sì |

Verificato dai test: un mondo del 1815 con 4 reparti nasce **senza** `apc` e con
la sola riga di copertura delle armi individuali; un paese senza porti non ha
alcuna riga navale; il dato assente (non zero) mantiene la categoria.

---

## 5. Test

- **Backend: 151 file / 1359 test verdi** (da 148/1299): +3 file, +60 test.
- **Frontend: 65 file / 461 test verdi** (da 65/456).
- **E2E mock: 37 test verdi** (suite completa, incluso lo scenario COUNTRY-CLARITY
  aggiornato alle nuove schede).
- `npx tsc --noEmit` pulito su backend e frontend; `npm run build` (tsc) e
  `vite build` puliti.

Prove di sensibilità:
- il fattore di saturazione è verificato **sul valore passato alla lavorazione**
  (spia deterministica su `months`), non solo sul bollettino;
- la consegna a lavori finiti è verificata in `arsenal-integration` e nel read
  model (ordine al 50% → `deliveredUnits: 0`);
- invarianti del manpower verificati su epoche, reparti e popolazioni estreme
  (0, 1.000, 50 milioni), incluse le combinazioni impossibili;
- il filtro navale è verificato nei tre stati: porti 0 (esclusa), assente
  (inclusa), `null` (inclusa).

---

## 6. Limiti dichiarati

1. `menPerFormation`, `eligibleShare` e `reserveRatio` sono **convenzioni
   dichiarate** per epoca, non dati storici per paese: servono a dare una scala
   leggibile agli uomini, non a fare demografia.
2. La riserva è aggregata: il motore non modella classi di leva, anzianità o
   specialità.
3. La domanda industriale per voce di catalogo usa `requires.factories` e la
   complessità del dominio: è una **misura di occupazione**, non un ciclo
   produttivo con input intermedi (quelli restano in `MaterialEconomy`).
4. La manutenzione entra nella capacità solo per i preset che **dichiarano**
   termini di manutenzione (`FacilityType.maintenance`); un mondo senza catalogo
   impianti ha manutenzione zero — e il Dossier non la inventa.
5. La saturazione **rallenta** la produzione, non la rifiuta: la scelta è il
   comportamento minimo coerente con il motore attuale (che già lega il ritmo
   alle infrastrutture). Un eventuale blocco degli ordini sarebbe una regola di
   gameplay nuova, fuori perimetro.
6. Le importazioni restano non tracciate una per una: il read model distingue
   «producibile in casa» da «solo dall'estero» (dato del motore), non i volumi.
7. Il costo di calcolo è rimasto quello di `/arsenal`: la capacità è aritmetica
   pura, i progetti sono già in memoria, il catalogo impianti è letto una volta
   per partita.

---

## 7. Verifica live (post-deploy)

Con il gioco reale `aa8c25b40bb6` (10 aprile 2026, preset
`modern_world_provinces`, partita legacy):

- `GET /api/games/aa8c25b40bb6/arsenal` → `epoch: "moderno"`,
  `epochLabel: "Era moderna"`, 8 categorie di dotazione, manpower con uomini
  (attivi, riserva, richiamabili), copertura per categoria e prontezza con
  driver, `industrialCapacity` con totale/occupazione/allocazioni.
- Il Dossier mostra le nuove schede FORZE (Personale, Equipaggiamento,
  Prontezza) e INDUSTRIA (Stabilimenti, Assegnazioni, Produzioni) senza
  richieste aggiuntive al motore.

*(Sezione aggiornata con l'output reale al momento del deploy.)*

---

## 8. Commit

| Fase | Contenuto |
|---|---|
| P1 | `MilitaryDoctrine` (epoca, manpower, establishment, copertura, prontezza, seed) + test |
| P2–P3 | `IndustrialCapacity` + integrazione nel servizio, seed d'epoca, pubblicazione in `/arsenal` + test |
| P4 | Read model del frontend (forze, industria, compositore) + presentazione delle schede + test |
| P5 | E2E mock aggiornato, report |
