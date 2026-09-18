# COUNTRY-CLARITY — National Operating Picture

**Obiettivo.** Il giocatore deve capire come funziona il proprio paese senza interpretare decine di numeri isolati: un solo schermo che risponde alle domande del governo («come sta il paese?», «quanti reparti ho in armi?», «quanto posso resistere?», «che cosa produco e che cosa devo importare?», «chi mi sostiene e chi è arrabbiato?»).

**Principio rispettato.** `ENGINE DATA → READ MODEL → UI`. Nessun motore parallelo, nessuna riscrittura, nessun uso nuovo dell'LLM: **tutte** le diagnosi, le statistiche, la prontezza, i mesi di autonomia e i saldi sono deterministici e derivano da numeri già pubblicati dal motore.

---

## 1. Audit iniziale dei dati già esistenti

| Dominio | Dato richiesto | Fonte attuale | Endpoint | Read model | UI attuale | Mancante? |
|---|---|---|---|---|---|---|
| Situazione | conto, stabilità, tensione, sforzo bellico | `WorldStateEngine` accounts | `/national-state` | `nationDossier.ts`, `strategicBriefing.ts` | Situazione + briefing compatto | no |
| Economia | entrate, spese, saldo, PIL, crescita, debito, interessi | accounts + `resources.debt*` | `/national-state` | `nationalVerdict`, `BudgetBreakdown` | Cassa | no |
| Finanza | titoli, tasso, scadenza, credito residuo | `resources.debts/creditLimit` | `/national-state` | `DebtPortfolio` | Cassa | no |
| Popolazione | abitanti, province, città | accounts + mappa | `/national-state` | `summarizeNationalAssets` | Sintesi | no |
| Società | stabilità, tensione sociale | accounts | `/national-state` | `governmentDossier.ts` | Governo/Politiche | no |
| Governo | fazioni, potere, soddisfazione, domanda, memoria | `GovernmentFactions` | `/national-state` + voci LLM on-demand | `governmentDossier.ts` | Governo | no |
| Industria | fabbriche, porti, atenei, base nazionale | `NationCapacity` | `/national-state`, `/arsenal` | `summarizeNationalAssets` | Risorse | destinazione per-fabbrica: **non modellata** |
| Risorse | stock, tetto, produzione, consumo, saldo, deperimento | `MaterialEconomy` | `/national-state` | `materialBalance.ts` (MATERIEL-CLARITY) | Risorse | import/export: **non modellati** |
| Energia | carburante | `MaterialEconomy` | `/national-state` | `materialBalance.ts` | Risorse | no |
| Forze armate | reparti attivi, riserve richiamate, base | `WorldStateEngine` + `NationCapacity` | `/national-state` | — | Sintesi (`assets.forces/baseForces`) | «uomini» in teste: **non modellato** (il motore conta reparti) |
| Arsenale | righe per categoria/dominio, quantità, qualità, potenza | `MilitaryService` | `/arsenal` | `arsenalSummary.ts` | Armamenti | no |
| Produzione militare | ordini, quantità, avanzamento, date, qualità persa | `MilitaryProduction` | `/arsenal` | `arsenalSummary.ts` | Armamenti | no |
| Commercio | mercato risorse naturali | `resources.market` | `/national-state` | `ResourceTradeRow` | Risorse | import/export di materiali: **non modellati** |
| Infrastrutture | fabbriche, porti, atenei, base | `NationCapacity` | `/national-state` | `summarizeNationalAssets` | Risorse | no |
| Ricerca | punti ricerca, tecnologie sbloccate | `MaterialEconomy`, `resources.technologies` | `/national-state` | — | Conoscenze | no |
| Progetti | processi in corso/completati, ambito, scadenza | registro processi + `projectCategory.ts` | `/national-state` | `groupProjectsByCategory` | Progetti | no |
| Diplomazia | relazioni, potenze del teatro | `RelationshipMatrix`, `WorldIntelService` | `/national-state`, agenda | `powersAgenda.ts`, `diplomacyPresence.ts` | Mappa/Diplomazia | **fuori dai cinque domini** (vedi limiti) |
| Crisi | rivolta, insolvenza, invasione, epilogo | `NationCrisis` | `/crisis` | `crisisPanel.ts` | Situazione | no |
| Pressioni | sfide di pace, finestra, esito | `PeacetimePressures` | `/pressures` | `pressureWindow.ts` | Situazione | no |
| Impegni | trattati, promesse, ultimatum, scadenze | `Commitments` | `/national-state` | — | Governo | no |

## 2. Dati realmente mancanti (e come li ho risolti)

1. **Manpower: nessun numero di teste.** Il motore conta **reparti** (`forces`, `mobilized`, `capacityBase.forces`), non uomini. Convertire in teste avrebbe richiesto un fattore inventato, quindi la conversione **non è stata fatta**: il read model pubblica reparti, richiamati, base nazionale e quota di richiamati, e dichiara `reservePool: null` e `shareOfPopulationPct: null` («non modellato»). Anche la domanda in UI è stata riscritta di conseguenza («Quante forze ho sotto le armi?») con la nota esplicita *il motore conta reparti, non teste*.
2. **Copertura per categoria di equipaggiamento.** Il motore ha solo righe di arsenale; la dotazione di riferimento (quanti fucili/mezzi *dovrebbe* avere un reparto) non esisteva. Le due costanti **ancorate al motore** sono quelle del seed dell'arsenale (`MilitaryService.arsenalUnits`: 40 fucili per reparto, 1,5 corazzati per reparto); le altre quattro sono dichiarate come `ESTABLISHMENT` nel modulo, con i pesi usati nella prontezza, e coperte da test.
3. **Prontezza operativa.** Non esisteva. Costruita come media pesata della copertura modulata da carburante, scorte di armamenti, qualità media e riserve richiamate: ogni fattore compare nei `drivers`, così il numero non è opaco.
4. **Capacità industriale usata/libera.** Il motore non attribuisce le fabbriche per settore (giusto non inventarlo). Convenzione dichiarata: **una lavorazione attiva occupa una linea**; `capacityTotal = stabilimenti`, `capacityUsed = min(total, lavorazioni attive)`, dove le lavorazioni sono ordini di produzione in corso + processi/progetti aperti + manutenzioni carenti.
5. **Mesi di autonomia.** Trasformazione puramente descrittiva `scorta / |saldo netto|`, con guardie per consumo zero, saldo positivo, dato assente e tetto «>12 mesi».
6. **Import/export.** Il motore non li traccia per i materiali: restano `null` e la UI non li mostra (nessun numero a zero inventato).

**Nessuna nuova struttura backend, nessuna migrazione, nessun nuovo endpoint, nessuna nuova chiamata LLM.** Il dato «manpower» è derivabile dallo snapshot già caricato (`account.forces`, `account.mobilized`, `account.capacityBase.forces`), quindi è rimasto nel read model frontend: aggiungere un campo a `/arsenal` avrebbe creato una seconda fonte di verità per gli stessi numeri.

## 3. Read model creati (frontend, puri e testabili — nessuna API, nessun React, nessun side-effect)

`frontend/src/components/Game/`

| Modulo | Contenuto |
|---|---|
| `domainStatus.ts` | linguaggio comune: `DomainStatusLevel` (solido/stabile/sotto pressione/fragile/critico), `DomainDriver` con `tone`, priorità dei driver, ordine delle attenzioni, `autonomyMonths/autonomyText`, guardie (`finiteOrNull`, `sharePct`), traduzione dei toni per il CSS del Dossier |
| `economyOperatingPicture.ts` | cifre chiave, diagnosi deterministica (AVANZO / DISAVANZO PERSISTENTE / BILANCIO NON DISPONIBILE), debito/PIL, peso interessi, mesi di cassa, trend dallo storico |
| `resourceOperatingPicture.ts` | righe stock/flusso (riusa `deriveMaterialRows`), autonomia per materiale, giacimenti in esaurimento, riga carburante |
| `industryOperatingPicture.ts` | capacità totale/usata/libera, occupazione in %, `assignments[]` (produzione, progetto, manutenzione) con il blocco in chiaro, settori, ordini con ritmo ed efficienza reale, `ports`/`universities` |
| `militaryOperatingPicture.ts` | `manpowerPayload()` dai numeri del motore, `equipmentCoverage()` su sei categorie, `readinessPicture()`, `procurementRows()` (produzione interna contro acquisto, `canBuild`/`canBuy`/`reasons` del motore), scorte militari, `orderRatePerMonth()` |
| `governmentOperatingPicture.ts` | fazioni che sostengono / insoddisfatte con motivo, dominante e più arrabbiata, `promiseSummary()` (mantenute, tradite, aperte, in scadenza), stabilità e tensione |
| `nationalOperatingPicture.ts` | compositore: cinque domini, stato complessivo, attenzioni ordinate, e la **sala operativa** con venti risposte deterministiche |

## 4. File modificati (oltre ai read model)

| File | Modifica |
|---|---|
| `NationDock/types.ts` | `NationAccount.debtServicePct` (il motore lo pubblica nel conto: tipizzato, non ricavato) |
| `NationDock/useNationDockModel.ts` | derivazione del quadro d'insieme **una sola volta**, in `useMemo`, sui dati già caricati |
| `NationDock.tsx` | quadro d'insieme in testa alla Situazione, blocco di dominio in testa a Governo, Cassa, Risorse e industria, Armamenti; salto di sezione |
| `OperatingPictureBoard.tsx` (nuovo) | presentazione: verdetto, attenzioni, cinque carte di dominio, griglia delle risposte, pulsanti di sezione. Nessun `fetch`, nessuno stato, nessun `Date.now`/`Math.random` |
| `index.css` | stili del quadro (griglie auto-fit, toni, 1 colonna sotto i 640 px) |
| `e2e/tests/country-clarity.spec.mjs` (nuovo) | quattro percorsi offline |

Nessun file in `backend-nest/src` è stato toccato: **zero rischio sulle meccaniche**.

## 5. Nuova struttura del Dossier

```
SITUAZIONE
  ├─ QUADRO D'INSIEME                  ← nuovo, primo blocco
  │    verdetto (stato + frase + sintesi)
  │    «Da decidere per primo» (massimo 5 attenzioni, con dominio e causa)
  │    5 carte di dominio: 4 cifre + sintesi + problemi + «Apri <sezione>»
  │    sala operativa: 20 risposte brevi
  ├─ briefing strategico (esistente)
  ├─ sintesi, crisi, sfide del momento (esistenti)
GOVERNO   → blocco «Quadro del governo»  (sostegno, opposizione, promesse, tenuta)
PROGETTI  → invariato (progetti e scadenze)
CASSA     → blocco «Quadro economico»    (diagnosi, debito/PIL, interessi, cassa)
RISORSE   → blocco «Quadro di risorse e industria» (scorte/flussi/autonomia + capacità)
ARMAMENTI → blocco «Quadro delle forze armate» (reparti, copertura, prontezza, dipendenze)
CONOSCENZE / POLITICHE → invariati
```

L'invariante del Dossier (all'apertura la sezione attiva è «Situazione») **non è stata toccata**: il quadro d'insieme è il primo blocco della Situazione, non una nona scheda.

## 6. Nuova struttura della scheda militare

La sezione **Armamenti** si apre con il quadro del dominio:

```
Forze armate                    [Sotto pressione]
Prontezza 76% · 8 reparti sotto le armi · 1 sistemi prodotti in casa.
Sotto le armi 8      Prontezza 76%
Copertura armi individuali 71%   Prodotti in casa 1
• Copertura armi individuali 71% — 240 in servizio su 340 della dotazione di riferimento.
• Carburante: 2,0 mesi di operazioni — servono 2/mese: sotto i 3 mesi la prontezza cala.
[Apri Armamenti]
```

Il dettaglio già esistente (scorte di armamenti con saldo, righe dell'arsenale, schede tecniche espandibili, catalogo con Produci/Importa) resta **sotto** il quadro, invariato.

## 7. Manpower

`manpowerPayload(account, assets)` → `{ population, active, mobilized, standing, baseline, reservePool, mobilizedPct, shareOfPopulationPct }`.

* `active = account.forces` — reparti in servizio permanente;
* `mobilized = account.mobilized` — reparti di riserva richiamati;
* `standing = active + mobilized` — reparti sotto le armi oggi (mai doppio conteggio);
* `baseline = assets.capacityBase.forces` — base di reparti calcolata da `NationCapacity`;
* `reservePool = null`, `shareOfPopulationPct = null` — **non modellati dal motore**, dichiarati assenti;
* `mobilizedPct = mobilized / standing` — derivato.

Il payload è `null` solo quando non ci sono né reparti né base: in quel caso la risposta dice «Dato non pubblicato».

## 8. Readiness

```
readinessPct = clamp( Σ(copertura_categoria × peso_categoria) / Σ pesi
                      × fattore_carburante × fattore_armamenti × fattore_qualità × fattore_mobilitazione )
```

* pesi: armi individuali 0,30 · mobilità corazzata 0,20 · artiglieria 0,15 · supporto aereo 0,15 · armi di supporto 0,10 · supporto navale 0,10;
* fattore carburante/armamenti = `min(1, scorta / (fabbisogno × 3 mesi))`, `1` se il fabbisogno non è pubblicato (un dato mancante non punisce);
* fattore qualità = `0,75 + min(0,25, qualityIndex/400)`;
* fattore mobilitazione = `1 − min(0,15, richiamati/totale × 0,3)` — le riserve consumano equipaggiamento per diventare operative;
* soglie di stato: ≥80 solido · ≥65 stabile · ≥50 sotto pressione · ≥35 fragile · <35 critico;
* driver generati per **ogni** copertura sotto l'85%, per il carburante sotto i 3 mesi, per le scorte di armamenti insufficienti, per la qualità e per le riserve richiamate.

## 9. Industria e produzione

* `capacityTotal = stabilimenti`; **una lavorazione attiva occupa una linea**; `capacityUsed = min(total, assegnazioni)`; `capacityFree`, `usedPct`.
* `assignments[]`: ordini di produzione in corso, processi/progetti aperti, manutenzioni carenti — ciascuno con settore e, se c'è, il **blocco** (`acciaio 8 mancante`).
* Per ogni ordine: prodotto, quantità, ritmo mensile ricostruito dalle date del motore, unità consegnate, efficienza (rapporto fra scorte di armamenti/carburante e fabbisogno dell'ordine con i limiti in chiaro).
* La **destinazione** delle fabbriche per settore non è modellata dal motore: non viene inventata; i settori mostrati derivano dalle lavorazioni realmente in corso.

## 10. Risorse e autonomia

Stock, tetto, produzione/mese, consumo/mese, saldo con segno, stato (`sufficiente`/`teso`/`critico` dalla riga di `MaterialEconomy`), **autonomia**:

* saldo negativo → `scorta / |saldo|` in mesi, con tetto «>12 mesi»;
* saldo ≥ 0 → «non critica»;
* consumo 0 / dati assenti / scorta 0 → «non critica» / «dato non disponibile» / «esaurita».

Nessun numero infinito o ingannevole (test dedicato, inclusi input estremi). Import/export restano `null`: non modellati.

## 11. Economia e governo

* **Economia**: PIL, crescita, entrate, spese, saldo, cassa, debito, debito/PIL, interessi annui, peso degli interessi sulle entrate, mesi di cassa, trend di saldo/cassa/debito dallo storico del motore; diagnosi deterministica `AVANZO` / `DISAVANZO PERSISTENTE` (con quota di spesa e avviso che il debito cresce) / `BILANCIO NON DISPONIBILE`.
* **Governo**: fazioni che sostengono (soddisfazione ≥ 60 o alleate), insoddisfatte (con domanda e ultimo evento di memoria politica come motivo), dominante, più arrabbiata, coesione, pressione, indice di fiducia; promesse mantenute/tradite/aperte/in scadenza dal registro `Commitments`.

## 12. Layout finale (descrizione precisa)

**Frase di testa.** Quando il paese non tiene, la testa cita il **problema** del dominio peggiore (il suo primo driver non positivo, con la causa), mai la sintesi: una sintesi positiva accanto a uno stato critico sarebbe fuorviante. Il dominio peggiore è il primo in ordine canonico con quello stato (economia → risorse → industria → forze armate → governo), quindi nessuna scelta arbitraria a parità di gravità.

**Desktop (>1100 px).** In Situazione: verdetto a tutta larghezza con pill di stato colorata a sinistra; sotto, «Da decidere per primo» con una riga per attenzione (bordo sinistro colorato per gravità, etichetta, dominio, causa); poi una griglia di 5 carte di dominio (`auto-fit, minmax(230px, 1fr)` → 4–5 per riga), ciascuna con nome, pill di stato, frase di sintesi, 4 cifre in monospazio tabulare su due colonne, al massimo 3 problemi con bordo colorato e il pulsante «Apri …»; infine la sala operativa in griglia `auto-fit, minmax(240px, 1fr)` (3–4 risposte per riga).

**Tablet (700–1100 px).** Le carte scendono a 2–3 per riga, le risposte a 2: nessuna modifica strutturale.

**Mobile (≤640 px).** Una colonna per carte e risposte, cifre su due colonne, padding ridotto; verificato a 390 px con `scrollWidth − clientWidth ≤ 2` (nessun traboccamento orizzontale). Le schede di sezione restano toccabili.

## 13. Test aggiunti

| File | Test | Copre |
|---|---|---|
| `domainStatus.test.ts` | 6 | stati, priorità, attenzioni, autonomia (negativo/positivo/zero/assente/estremi), guardie |
| `economyOperatingPicture.test.ts` | 6 | disavanzo, avanzo, debito/interessi critici, trend, dati mancanti/zero, scenario 1815 |
| `resourceOperatingPicture.test.ts` | 7 | stock positivo con deficit, saldo positivo, critico, consumo zero/assente, carburante, giacimenti |
| `industryOperatingPicture.test.ts` | 7 | capacità, nessun ordine, saturazione, senza stabilimenti, ordine completato, ritmo/efficienza, storico |
| `governmentOperatingPicture.test.ts` | 6 | sostegno/opposizione, pressione critica, memoria assente, dati mancanti, promesse, storico |
| `militaryOperatingPicture.test.ts` | 9 | copertura per categoria, fabbisogno nullo, prontezza piena/scarsa, fattori mancanti, manpower, produzione contro acquisto, quadro completo, dati mancanti, storico |
| `nationalOperatingPicture.test.ts` | 8 | composizione, 20 risposte piene, cifre chiave, ordini/blocchi industriali, dati mancanti, 1815, catalogo vuoto, zeri |
| `operatingPictureBoard.test.ts` | 5 | resa HTML (verdetto, domini, risposte), navigazione, presenza in ogni sezione, assenza di fetch/stato/random |
| `e2e/tests/country-clarity.spec.mjs` | 4 | apertura sul quadro, 20 risposte con i numeri della fixture, salto al dettaglio, mobile 390 px |

Requisiti richiesti e coperti: normal / warning / critical / missing data / zero values / historical scenario; manpower; copertura; readiness con scorte sufficienti e con carburante scarso; `canBuild false` + `canBuy true`; ordini di produzione; industria (totale/usata/libera, nessun ordine, satura, ordine completato); risorse (stock, consumo, saldo, autonomia, zero, assente).

## 14. Quality gate

| Comando | Risultato |
|---|---|
| backend `npx tsc --noEmit` | pulito |
| backend `npm test` | **148 file / 1299 test** verdi |
| backend `npm run build` | OK |
| frontend `npx tsc --noEmit` | pulito |
| frontend `npx vitest run` | **65 file / 453 test** verdi (da 57/399) |
| frontend `npm run build` | OK |
| `npm run test:e2e:mock` | **37 passati** (da 33) |

Regressioni verificate: nessun file del motore toccato; playback, crisi, rewind, branching, ordini, produzione, acquisti militari, mercato risorse, fazioni, progetti, mappa e layout mobile restano invariati (suite completa verde).

## 15. Commit

```
COUNTRY-CLARITY P1   linguaggio comune dei domini e quadro d'insieme
COUNTRY-CLARITY P2   forze armate: reparti, copertura, prontezza, produzione
COUNTRY-CLARITY P3/P4/P5/P6  economia, risorse, industria, governo (read model)
COUNTRY-CLARITY P1   sala operativa nazionale — un solo schermo
COUNTRY-CLARITY P7/P8  quadro d'insieme nelle sezioni del Dossier
COUNTRY-CLARITY      e2e mock del quadro d'insieme
COUNTRY-CLARITY P7   ricerca e infrastrutture nella sala operativa
```

## 16. Limiti residui (dichiarati, non nascosti)

1. **Manpower in teste non esiste.** Il motore conta reparti; la conversione in uomini non è modellata e non è stata inventata. Se in futuro il motore pubblicasse `population`→`mobilitabile`, il payload ha già i campi pronti (`reservePool`, `shareOfPopulationPct`) che oggi valgono `null`.
2. **Riserva richiamabile**: non modellata (`null`).
3. **Import/export di materiali**: non tracciati dal motore (`null`); la risposta «Quali devo importare?» parla di sistemi d'arma (dove `canBuild`/`canBuy` esistono davvero), non di materie prime.
4. **Destinazione civile/militare delle fabbriche**: non modellata; i settori mostrati derivano dalle lavorazioni in corso, mai da un'attribuzione inventata.
5. **Input industriali specifici (acciaio, gomma…)**: il motore non li modella come input di produzione; l'efficienza usa solo armamenti e carburante, che esistono.
6. **Diplomazia (priorità 10)**: resta nelle schede esistenti (potenze del teatro, presenze) e non è entrata nei cinque domini del quadro d'insieme.
7. **Ricerca e infrastrutture** hanno una risposta dedicata nella sala operativa e cifre nel dominio Risorse/Industria, ma non una sezione nuova: le schede «Conoscenze» e «Risorse» esistenti restano il dettaglio.
8. **Trend dei domini non economici**: dove lo storico del motore non esiste (industria, governo) il trend non viene mostrato, invece di essere stimato.
9. **`ESTABLISHMENT`**: quattro delle sei dotazioni di riferimento sono convenzioni del read model (dichiarate e testate), non dati del motore; le altre due sono ancorate al seed dell'arsenale.
