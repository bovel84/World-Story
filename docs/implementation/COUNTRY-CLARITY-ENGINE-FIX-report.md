# COUNTRY-CLARITY ENGINE FIX — i quattro residui strutturali

**PR:** `feat/cc-engine-fix` · **Base:** `main` (`d9f5452`)
**Ambito:** chiusura dei **quattro residui** rimasti aperti dopo COUNTRY-CLARITY ENGINE (#59/#60).
**Principio:** `ENGINE DATA → READ MODEL → UI`. Nessun sottosistema nuovo, nessun secondo calcolo, nessuna regola nuova in UI.

Questo intervento **non** rifà COUNTRY-CLARITY, **non** tocca il playback, la crisi, il branching, il rewind, gli NPC, `FactionMemory`, `Commitments`, `PeacetimePressures`, la diplomazia, `WorldStateEngine`, `MaterialEconomy`. Il campo d'azione è: `MilitaryDoctrine.ts`, `IndustrialCapacity.ts`, `MilitaryProduction.ts`, `MilitaryService.ts`, il prezzo unitario delle armi individuali nel catalogo, i read model e i test.

---

## 1. Causa esatta dei quattro residui (verificata sul codice, prima di toccarlo)

| # | Residuo | Causa reale nel codice |
|---|---------|------------------------|
| **R1** | **Armi individuali fuori scala** | `MilitaryDoctrine.ts` chiedeva `perFormation: 40` / `perMobilized: 50` **per reparto** (`RIFLES_PER_FORMATION = 40`). Con `moderno.menPerFormation = 12000`, sei reparti = **72.000 uomini** a fronte di un fabbisogno di **240 fucili** → copertura 100% falsa. Errore di **unità di misura**: il catalogo conta *pezzi*, la dottrina contava *lotti impliciti* mai dichiarati. |
| **R2** | **Capacità industriale zero = produzione al 25%** | `IndustrialCapacity.industrialCapacityOf`: `overflowFactor: Math.max(0.25, overflow)` **senza distinguere `total === 0`**. Con zero fabbriche, porti e atenei e un ordine aperto, `overflow = 0` ma il fattore finiva a **0,25** → produzione inventata dal nulla; `MilitaryService.advanceProduction` calcolava `months = (days/30) * 0.25` e il bollettino diceva «avanza al 25% del ritmo». |
| **R3** | **La quantità non contava nulla** | `militaryOrderAllocation` costruiva `base = max(4, requires.factories × 4) + domainBonus` **senza leggere `order.quantity`** (commento esplicito: «Non dipende dalla quantità»). 1 carro e 500 carri occupavano la stessa capacità: `productionRate()` non conosce la quantità, quindi **1 = 500 = stesso tempo**. |
| **R4** | **`maxMobilizedShare` costante morta** | Dichiarata nei cinque profili d'epoca (`MANPOWER_PROFILES`, 0,35→0,8) e **mai usata** in `militaryManpower()`: nessun tetto, nessuna testa di richiamo, nessuna segnalazione. |

**Diagnosi comune:** quattro regole dichiarate ma non applicate (o applicate con l'unità sbagliata). Nessuna richiedeva un nuovo sottosistema: tre erano già nel motore, la quarta era una costante orfana.

---

## 2. Intervento — file toccati

### Motore (produzione)
| File | Intervento |
|------|-----------|
| `backend-nest/src/core/simulation/MilitaryDoctrine.ts` | `ManpowerProfile.individualWeaponShare`; `individualWeaponDemand()`; `EstablishmentCategory.demand: 'per_formation' \| 'personnel_share'`; copertura e seed sulla nuova regola; `mobilizationCap` / `mobilizationHeadroom` / `overMobilized`; driver critico di over-mobilization; percentuali leggibili sotto il 10%. |
| `backend-nest/src/core/simulation/IndustrialCapacity.ts` | `REFERENCE_BATCH_BY_CATEGORY` / `REFERENCE_BATCH_BY_DOMAIN`; `referenceBatchFor()`, `quantityFactor()`, `allocationCapFor()`; domanda militare **crescente col lotto** (logaritmica, sub-lineare); `blocked` + `overflowFactor = 0` senza impianti. |
| `backend-nest/src/core/simulation/MilitaryProduction.ts` | `advanceOrder(…, months ≤ 0)`: nessun avanzamento **e nessun imprevisto** a tempo zero (un ordine bloccato non può arretrare né fallire). |
| `backend-nest/src/core/simulation/MilitaryIndustry.ts` | Prezzo e consumo unitari delle **armi individuali**: `costMln 800 → 4`, `weaponsCost 4 → 0,02` (unità = singolo pezzo, non più «lotto» implicito). |
| `backend-nest/src/game/MilitaryService.ts` | `MAX_PROCUREMENT_QUANTITY = 200 000`; rifiuto di `build` senza **nessuna** capacità industriale; `advanceProduction` con ramo **bloccato** (bollettino dedicato, loop saltato); `getArsenal` pubblica `perFormation: null`, `personnelSharePct`, `demand` per l'establishment. |

### Read model e presentazione
| File | Intervento |
|------|-----------|
| `frontend/src/services/api.ts` | Tipi: `EstablishmentCategoryPayload` (`perFormation`/`perMobilized` nullable, `personnelSharePct`, `demand`), `MilitaryManpowerPayload` (`mobilizationCap`, `mobilizationHeadroom`, `overMobilized`), `IndustrialCapacityPayload.blocked`. |
| `frontend/src/components/Game/militaryOperatingPicture.ts` | `EstablishmentRow` con `demand`/`personnelSharePct`; `ManpowerPayload` con il tetto di richiamo. Nessuna formula nuova. |
| `frontend/src/components/Game/industryOperatingPicture.ts` | `blocked` letto dal motore: driver critico, titolo e stato dedicati; i messaggi «X% del ritmo» non scattano più quando la produzione è bloccata. |
| `frontend/src/components/Game/OperatingPictureBoard.tsx` | Dottrina: «Armi individuali: 75% degli uomini in armi» invece di «40 per reparto»; frazioni di dotazione con un decimale; blocco industria dichiarato in chiaro. |

### Test e verifica
`tests/military-doctrine.test.ts`, `tests/industrial-capacity.test.ts`, `tests/industrial-capacity-service.test.ts`, `tests/military-service.test.ts`, `tests/arsenal-integration.test.ts`, `frontend/.../militaryOperatingPicture.test.ts`, `industryOperatingPicture.test.ts`, `operatingPictureBoard.test.ts`, `e2e/mock-api.mjs`, `e2e/tests/country-clarity.spec.mjs`.

**Non toccati:** `TurnPipelineService`, `PlaybackService`, checkpoint, branching, crisi, `MaterialEconomy`, `WorldStateEngine`, `NationCapacity`, schema/database, repositories, route. Nessuna migrazione.

---

## 3. La nuova regola delle armi individuali (R1)

**Fonte unica:** `MANPOWER_PROFILES[epoca].individualWeaponShare`.

| Epoca | Quota con arma individuale | Perché |
|-------|---------------------------|--------|
| pre-industriale | **90%** | coscrizione di massa, quasi nessuna coda logistica |
| grande guerra | **90%** | milioni di fanti in linea |
| seconda guerra | **85%** | servizi, comando e logistica già consistenti |
| guerra fredda | **80%** | eserciti meccanizzati, più supporto |
| moderno | **75%** | la coda (comando, supporto, logistica) è la parte più grande |

La categoria `individualWeapons` porta `demand: { kind: 'personnel_share' }` e **non ha più** `perFormation`/`perMobilized`: le costanti `RIFLES_PER_FORMATION`/`RIFLES_PER_MOBILIZED_FORMATION` sono state **rimosse** (erano la causa dell'errore di unità). Le altre categorie (corazzati, artiglieria, aerei, navi, missili, droni) **restano per reparto**: i mezzi appartengono al reparto, i fucili ai soldati.

```
fabbisogno_armi_individuali(epoca, reparti, reparti_richiamati) =
  round( (reparti + reparti_richiamati) × uomini_per_reparto(epoca) × quota_epoca )
```

Esempio (P10): `moderno`, 6 reparti, 12.000 uomini/reparto → 72.000 uomini → **54.000 armi richieste** (non 240).

---

## 4. Manpower → fabbisogno (relazione dichiarata)

`militaryManpower()` resta l'unico punto che converte i **reparti** (fatto del motore: `account.forces`, `account.mobilized`) in **uomini**, e ora pubblica anche il tetto di richiamo:

| Grandezza | Formula |
|-----------|---------|
| `activePersonnel` | `reparti × menPerFormation(epoca)` |
| `totalMilitaryPool` | `popolazione × eligibleShare(epoca)` |
| `mobilizedPersonnel` | `min(richiamati × menPerFormation, max(0, pool − activePersonnel))` |
| `reservePersonnel` | `min(max(0, pool − active), max(mobilizedPersonnel, active × reserveRatio))` |
| **`mobilizationCap`** | `round(totalMilitaryPool × maxMobilizedShare)` |
| **`mobilizationHeadroom`** | `max(0, mobilizationCap − mobilizedPersonnel)` |
| **`overMobilized`** | `round(richiamati × menPerFormation) > mobilizationCap` |

Invarianti preservate (già testate): `active + reserve ≤ max(active, pool)`, `reserve ≥ mobilized`, `availableReserve + mobilized = reserve`.

Il fabbisogno di armi individuali usa i **reparti dichiarati dal motore**, non il personale limitato dal bacino: il fatto canonico è quello, la riserva è un altro conto (coerente con R4, sotto).

---

## 5. Aggiornamento del seed (P11)

`arsenalSeedUnits(epoca, forces, mobilized)` usa la **stessa funzione** della copertura:

```
seed.fucili = individualWeaponDemand(epoca, forces, mobilized)
```

Conseguenze:
- una nazione **nasce armata esattamente al 100%** delle armi individuali che la sua dottrina le chiede → **nessun trucco numerico diverso** fra seed e copertura (test D11);
- i mezzi di mobilità restano `reparti × perFormation` e compaiono **solo se l'epoca li prevede** (1815 nessun corazzato);
- il seed è coerente con la nuova scala unitaria del catalogo: 8 reparti moderni → **72.000 fucili** (verifica live §13).

---

## 6. Capacità zero: blocco, non rallentamento (P12)

```
blocked          = (total === 0 && demand > 0)
overflowFactor   = total > 0 ? max(0.25, total/demand) : (blocked ? 0 : 1)
```

- **impianti presenti ma insufficienti** → saturazione e rallentamento, mai sotto il quarto del ritmo (`total > 0`: la regola P14 è intatta);
- **nessun impianto con lavoro da fare** → fattore **0**: `advanceProduction` **salta il ciclo**, gli ordini restano aperti, il progresso **non si muove** e i bollettini dicono «Produzione bloccata: nessuna capacità industriale disponibile», non «25% del ritmo»;
- **nessun impianto e nessun lavoro** → fattore 1 (non c'è niente da rallentare);
- **ETA**: `withOrderEta` con fattore 0 restituisce `expectedDate: null` — una data non si inventa;
- `advanceOrder(…, 0)` non può più generare imprevisti (un ordine fermo non arretra): guardia esplicita a tempo zero;
- `procureEquipment('build')` **rifiuta** l'ordine quando `total === 0` con `build_unavailable: nessuna capacità industriale disponibile`, così non si crea un ordine che non avanzerà mai.

La UI distingue: «Produzione bloccata — nessuna capacità industriale disponibile» (critico) contro «industria satura, il lavoro avanza al X% del ritmo».

---

## 7. Quantità → capacità → tempo (P13)

**Lotto di riferimento** (natura del mezzo, non prezzo):

| Categoria | Lotto di riferimento | Dominio (fallback) |
|-----------|----------------------|--------------------|
| Fanteria | **1.000** | terra 200 |
| Corazzati | **50** | aria 10 |
| Artiglieria | **100** | mare 2 |
| Difesa aerea | **50** | missili 20 |
| — | — | droni 100 |

```
quantityFactor   = 1 + max(0, log10(quantità / lotto_riferimento))
capacityDemand   = clamp(round(base × quantityFactor), 4, allocationCapFor(base))
allocationCapFor = max(40, base × 5)          // base = max(4, fabbriche_richieste × 4) + bonus_dominio
```

- **fino al lotto di riferimento la domanda non cambia** (un ordine normale non paga una penalità);
- oltre, la crescita è **logaritmica**: 10 lotti raddoppiano la domanda, non la decuplicano → **un solo effetto**, niente doppio conteggio con la complessità della voce (che resta nel `base`);
- il **tempo** cambia di conseguenza **via saturazione**: la stessa voce, saturando le linee, fa scattare `overflowFactor < 1` e la consegna slitta (`expectedDate` più lontana), senza un secondo moltiplicatore sui mesi;
- esempio (test): `apc` 1 carro → 8 linee; 100 carri → 10; 500 → 12; 5.000 carri su 10 linee → industria satura, fattore 0,25, consegna più tarda (entrambi i criteri P13 soddisfatti: **domanda** e **tempo**).

---

## 8. `maxMobilizedShare` non è più una costante morta (R4)

**Interpretazione scelta e dichiarata:** il tetto è una quota del **bacino mobilitabile** — «non si possono tenere sotto le armi come riserva, in una volta, più di `maxMobilizedShare × pool` uomini».

Applicazione **senza riscrivere i fatti del motore** (vincolo R4.2):
- la testa disponibile è pubblicata (`mobilizationCap`, `mobilizationHeadroom`) e **limita i richiami futuri** (è il numero che il motore espone a chi mobilita);
- i reparti richiamati **già dichiarati** (`account.mobilized`) **non vengono cancellati né ridotti**: se superano il tetto, `overMobilized: true` e la prontezza porta un **driver critico** «Richiamo oltre il tetto d'epoca: N su M» con il dettaglio dei reparti;
- nessuna discrepanza fra conto nazionale e quadro: stesso `mobilizedFormations`, stesso personale.

Esempio live: `guerra_fredda`, bacino 170.000 → tetto **119.000**, richiamati 22.000 → testa 97.000, nessuna over-mobilization.

---

## 9. Impatto sulla prontezza (P5)

La prontezza **non è stata aggiustata a mano**: scende da sola perché la copertura delle armi individuali è ora vera.

- Caso di scuola: 72.000 uomini con **240 fucili** → copertura individuale **0,4%**, readiness **19/100 `critical`** (prima: 100% e un numero gonfiato).
- Nazione con il seed corretto: 72.000 uomini con **72.000 fucili** → copertura **100%** → readiness invariata rispetto alla lettura precedente a parità di arsenale (**47/100 `fragile`** nella verifica live): la correzione non punisce chi è armato.
- I driver escono dal motore e ora distinguono i decimali (`0,4%`, non `0%`).

---

## 10. Prezzi unitari e tetto di richiesta — coerenza di scala

Cambiare l'unità delle armi individuali ha **obbligato** a riallineare il catalogo: con `costMln 800` per pezzo, riarmare 54.000 fucili sarebbe costato 43.200 miliardi di dollari (una nazione non lo potrebbe mai fare).

| Voce | Prima | Dopo | Effetto |
|------|-------|------|---------|
| `fucili.costMln` | 800 (per «lotto» implicito) | **4** (per pezzo) | un reparto moderno armato resta ~36.000 mln (era ~32.000) |
| `fucili.weaponsCost` | 4 | **0,02** | stesso ordine di grandezza del consumo di scorte per reparto |
| `MAX_PROCUREMENT_QUANTITY` | 1.000 | **200.000** | un riarmo completo non richiede più decine di ordini |

Il **tetto di credito** resta il vero limite economico: una richiesta fuori scala finisce in `credit_exhausted`.

*(Limite dichiarato §14: è una scala di gioco, non un listino storico.)*

---

## 11. Test

### Test obbligatori richiesti
| Requisito | Test |
|-----------|------|
| **P10** armi individuali dal personale | `military-doctrine.test.ts` → «le armi individuali si misurano sul personale, non sul numero di reparti»: 72.000 uomini → **54.000 richieste**, `≠ 240`; con 240 fucili copertura **0,4%**, missing 53.760, readiness < 30 con driver di copertura |
| **P11** seed coerente | «usa la stessa regola della copertura (P11: seed completo → 100%)» su **tutte** le epoche + «il seed copre esattamente il fabbisogno» (`seed.fucili === required`) |
| **P12** industria zero | `industrial-capacity.test.ts` «senza impianti la produzione è bloccata…» (`total 0`, `used 0`, `overflowFactor 0`, `blocked`, `satisfactionPct 0`); `military-service.test.ts` end-to-end: progresso **invariato a 25**, `expectedDate null`, ordine ancora `in_progress`, bollettino «Produzione bloccata» e **nessun** «25%» |
| **P13** quantità | `industrial-capacity.test.ts` `apc` 1 → 8, 100 → 10, 500 → 12, sub-lineare; `military-service.test.ts` 5.000 carri su 10 linee → saturazione e **consegna più tarda** |
| **P14** saturazione | «il fattore di rallentamento non scende sotto un quarto» (con `total > 0`) + «senza impianti e senza lavori» (`overflowFactor 1`, `blocked false`) |
| **P15** manpower su tutte le epoche | «regge popolazioni piccole e grandi, mobilitazione zero e alta» (5 epoche × 3 popolazioni × 4 configurazioni) + «il tetto di richiamo non è una costante morta» + «l'over-mobilization è un driver critico» |
| **P16** non regressione storica | «1815 e 1914 non chiedono nulla che non esista ancora» (niente corazzati/aerei/missili/droni; seed 1815 senza `apc`) + «un paese senza porti non ha requisiti navali in nessuna epoca» |

### Non regressione aggiuntiva
- **P8 consegne**: semantica di #59 **non toccata** (`in_progress → deliveredUnits 0`, `completed → unità reali nette dei difetti`); i test di `industryOperatingPicture` restano verdi e il test e2e verifica `consegnate 0`.
- **P9 acquisti**: `buy` resta **consegna immediata** e non consuma scorte di armamenti; la capacità industriale riguarda solo `build`.
- **Read model**: nuovi test che provano che la UI **mostra** i dati del motore senza ricalcolarli (`establishmentRows` con `personnelSharePct`/`demand`, tetto di richiamo nel manpower, blocco industria, `blocked: false`).
- **Integrazione servizio**: «la dotazione di riferimento dichiara la quota di personale, non un finto per-reparto» (75%, `perFormation null`).

### Conteggi
| Suite | Prima | Dopo |
|-------|-------|------|
| Backend | 151 file / **1359** test | 151 file / **1370** test (+11) |
| Frontend | 65 file / **461** test | 65 file / **467** test (+6) |
| E2E mock | 37 | **37** (Playwright, mock API) |

---

## 12. Quality gate (eseguito, non dichiarato)

| Comando | Esito |
|---------|-------|
| `backend-nest`: `npx tsc --noEmit` | ✅ nessun errore |
| `backend-nest`: `npm test` | ✅ **151 file / 1370 test** |
| `backend-nest`: `npm run build` | ✅ `tsc` pulito |
| `frontend`: `npx tsc --noEmit` | ✅ nessun errore |
| `frontend`: `npx vitest run` | ✅ **65 file / 467 test** |
| `frontend`: `npm run build` | ✅ `vite build` (9,97 s) |
| root: `npm run test:e2e:mock` | ✅ **37 passed** (3,7 m) |

Suite mirate tutte verdi: `military-doctrine`, `industrial-capacity`, `industrial-capacity-service`, `military-service`, `military-production`, `arsenal-integration`, `militaryOperatingPicture`, `industryOperatingPicture`, `nationalOperatingPicture`, `operatingPictureBoard`.

---

## 13. Verifica live (backend locale = quello servito dal tunnel)

### 13.1 Partita esistente `aa8c25b40bb6` — il caso del DoD

`GET /api/games/aa8c25b40bb6/arsenal` (preset `modern_world_provinces`, era moderna):

```
epoch: "moderno"  epochLabel: "Era moderna"
manpower: activePersonnel 72.000 (6 × 12.000), reservePersonnel 64.800,
          mobilizationCap 3.211.880 (= round(6.423.760 × 0,5)),
          mobilizationHeadroom 3.211.880, overMobilized false
establishment[0]: { category "individualWeapons", perFormation null, perMobilized null,
                    personnelSharePct 75, demand "personnel_share" }
coverage[0]: { required 54.000, available 240, coveragePct 0.4, missing 53.760,
               items ["Fucili d’assalto ×240"] }
readiness: 19 / "critical"
industrialCapacity: total 38, used 26, free 12, saturated false, blocked false
```

**72.000 uomini non possono essere armati da 240 fucili:** il motore lo dice (0,4%, mancano 53.760). L'arsenale di questa partita è un **seed salvato con la vecchia regola** (240 «lotti»): vedi §14.

### 13.2 Partita nuova `23fd1fe361ae` — il seed corretto

Creata per la verifica (`POST /api/games`, mondo `e3cb38dbbf42`, regione `e3cb38dbbf42_GBHLD`, polity `GBR`):

```
epoch: "moderno"
manpower: activePersonnel 96.000 (8 × 12.000), mobilizationCap 4.856.144
          (= round(9.712.287 × 0,5)), overMobilized false
units: { fucili: 72.000, apc: 12 }
coverage[0]: { required 72.000, available 72.000, coveragePct 100, missing 0 }
readiness: 47 / "fragile"
industrialCapacity: total 114 (10 fabbriche × 10 + 7 atenei × 2), blocked false
catalog.fucili: canBuy true, buildCostMln 4, buyCostMln 6
```

Il seed **è** il fabbisogno: 96.000 uomini in armi → 72.000 armi (75%), copertura 100%. Nessun numero diverso fra seed e copertura.

*(La partita `23fd1fe361ae` è nata per la verifica: può essere cancellata senza conseguenze.)*

---

## 14. Limiti dichiarati

1. **Partite già avviate con il vecchio seed.** L'arsenale è una riga persistita per partita/polity e non viene riscritto: chi ha una partita creata prima di questo intervento legge il proprio arsenale storico con la **nuova** dottrina (es. 240 fucili su 54.000 richiesti → 0,4%). È la lettura **onesta** di ciò che quella nazione possiede, ma la partita resta sotto-armata e il riarmo completo è un'operazione industriale lunga. *Proposta fuori ambito (non eseguita): una migrazione una-tantum della scala del seed, da autorizzare separatamente.*
2. **Scala dei prezzi.** `4 mln` per arma individuale e `0,02` di scorte sono una **scala di gioco** calibrata per conservare il costo per reparto precedente, non un listino storico.
3. **`individualWeaponShare` è una convenzione d'epoca**, non un dato per paese: entro l'epoca tutte le nazioni hanno la stessa quota. Una differenziazione per paese richiederebbe una fonte che il motore non ha.
4. **La quantità agisce sui tempi via saturazione.** Un ordine grande che **non** satura l'industria ha lo stesso tempo di uno piccolo: è la conseguenza voluta del modello «quantità → capacità → saturazione», senza un secondo moltiplicatore sui mesi.
5. **Il tetto di richiamo non taglia i fatti.** `maxMobilizedShare` limita la **testa** (`mobilizationHeadroom`) e **segnala** l'eccesso (`overMobilized`), ma non riscrive `account.mobilized`: nessun automatismo di smobilitazione (sarebbe una regola nuova, fuori ambito).
6. **`arsenalStrength` cambia scala.** La «forza dell'arsenale» (quantità × qualità × dominio) passa da 84 a 25.200 per la stessa nazione armata: il numero resta coerente, ma è su una **scala nuova**. Il termine di copertura di `arsenalCombatFactor` era **già saturo** prima della correzione e lo resta (1,331 → 1,319 nello stesso confronto): nessuna variazione di combattimento. Un ricalibro del fattore è una decisione di **bilanciamento**, non un fix.
7. **Lotto di riferimento per categoria/dominio.** Fanteria/corazzati/artiglieria/aerea/mare/missili/droni hanno un lotto dichiarato; categorie nuove senza voce ricadono sul dominio (o su 200). Non è una misura fisica, è una convenzione esplicita.
8. **Manutenzione e progetti** restano quelli di #59 (non riguardano questi quattro residui).

---

## 15. Commit

| Commit | Contenuto |
|--------|-----------|
| `R1/R4/R5` | `MilitaryDoctrine.ts`: quota d'armi individuali, `individualWeaponDemand`, `demand` per categoria, tetto di richiamo, driver di over-mobilization, percentuali sotto il 10% |
| `R2` | `IndustrialCapacity.ts` (`blocked`, fattore 0) + `MilitaryProduction.ts` (guardia a tempo zero) + `MilitaryService.ts` (ramo bloccato, rifiuto di `build`) |
| `R3` | `IndustrialCapacity.ts`: lotto di riferimento, `quantityFactor`, tetto per lavorazione |
| `scala` | `MilitaryIndustry.ts` (prezzo/consumo unitario armi individuali) + `MAX_PROCUREMENT_QUANTITY` |
| `UI` | `api.ts`, `militaryOperatingPicture.ts`, `industryOperatingPicture.ts`, `OperatingPictureBoard.tsx` |
| `test` | Backend (P10–P16, servizio, integrazione), frontend (read model, board), e2e mock |
