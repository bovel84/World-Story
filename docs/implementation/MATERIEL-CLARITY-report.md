# REPORT — MATERIEL-CLARITY (armamenti e risorse: si deve capire subito cosa si ha e cosa si produce)

Base: `origin/main` = `4131ba0` (DECISION-IMPACT merged). Segnalazione di Andrea sul Dossier
nazionale · Confederazione Germanica · tab **Armamenti**: «Armamenti o risorse non so quante ne ho e
se ne sto producendo o altro: deve essere più chiaro e rapido per il giocatore.»

---

## 1. Problema trovato

La scheda «Armamenti» apriva con schede **tecniche** molto dettagliate (ruolo, descrizione, calibro,
gittata, cadenza, serventi) ma **senza la lettura che serve a decidere**: quanto ho, quanto produco,
quanto consumo, se sono in avanzo o in deficit. Nella scheda «Risorse e industria» il magazzino
mostrava scorta, tetto e «mesi di copertura», ma **nessun flusso** (produzione e consumo mensili):
il giocatore vedeva «x160 in servizio» e «4/4» senza sapere se il numero stava salendo o scendendo.

### FASE 1 — diagnosi (obbligatoria)

**a) Cosa il motore produce già** (`core/simulation/MaterialEconomy.ts`, classe di dati completa):

| Dato | Dove nasce | Esito |
|---|---|---|
| scorta per polity (`food`, `clothing`, `weapons`, `fuel`, `money`, `research`, tecnologie) | `ResourceStock` + `advanceStock` | persistita (`game_resource_stocks`) ed esposta |
| **fabbisogno mensile** (`materialNeeds`) | popolazione, forze schierate, riserve richiamate, fabbriche | esposto (`resources.needs`) |
| **tetto di stoccaggio** (`storageCapacity`) | mesi di riserva per classe di sviluppo | esposto (`resources.capacity`) |
| **flusso netto del mese** (`MaterialTick.flow` = produzione − consumo per materiale) | calcolato **a ogni avanzamento** | **calcolato e poi buttato**: finiva solo in una riga di bollettino (`🏭 Magazzino nazionale: …`), che in auto-jump non arriva nemmeno al client (vedi report DECISION-IMPACT) |
| materiale perso al tetto (`spoiled`), carenze (`shortages`), interessi, rollover | stesso tick | solo bollettino |
| produzione naturale (`extractionPerMonth` per giacimento) | `summarizeLedger` | esposta (`resources.natural`) |
| armamenti: quantità in servizio, qualità, tier, forza, quota % | `getArsenal().lines` | esposto |
| armamenti: **produzione in corso** (quantità, % completamento, data prevista) | `getProduction().orders` (con `equipmentId`) | esposto |
| armamenti: **consumo** per turno | — | **non esiste**: il consumo dei mezzi è per evento (combattimento, conquista), non un flusso mensile |

**b) Il bilancio materiale esiste?** No: il motore lo calcola (`flow`), ma **non lo conserva e non lo
espone**. Va quindi derivato — senza toccare il motore.

**c) Evidenza misurata sui dati reali** (partita `246c9cda8b8f`, DEU, turno 7, 1816-04-20; sonda
temporanea su `data/open-pax.db`, poi rimossa):

```
scorte:   cibo 2 (tetto 2) · vestiario 1,5 (tetto 1,5) · armi 4 (tetto 4) · carburante 2 (tetto 2)
fabbisogno/mese:  cibo 0,44 · vestiario 0,12 · armi 0,20 · carburante 0,17
flusso/mese:      cibo +3,14 · vestiario +0,62 · armi +0,86 · carburante +0,23
materiale perso:  cibo 3,14 · vestiario 0,62 · armi 0,86 · carburante 0,23   ← surplus al tetto
```

Lettura che il Dossier **non** dava: la nazione produce molto più di quanto consuma, ma **il
magazzino è al tetto e il surplus va perduto**. È esattamente il «sto andando bene o male?» che
mancava: «in accumulo», non «in deficit».

**d) Gap esatto**

1. manca il **flusso** (produzione/consumo/saldo) accanto alla scorta → riga di sintesi assente;
2. il dettaglio tecnico è il **primo livello** della scheda: la sintesi non esiste affatto;
3. per gli armamenti manca «quanti ne sto producendo» (l'ordine in corso vive in un blocco separato,
   non sulla riga del mezzo).

## 2. Correzione applicata

### Motore (additivo, non congelato)

- **`backend-nest/src/game/materialBalance.ts`** (nuovo, puro): `materialBalance(stock, account,
  endowment, days = 30)` riusa **le stesse funzioni del motore** (`advanceStock`, `materialNeeds`,
  `storageCapacity`) sullo stato corrente e restituisce, per ciascun materiale:
  `stock`, `capacity`, `productionPerMonth` (= fabbisogno + flusso netto), `consumptionPerMonth`
  (= fabbisogno), `balancePerMonth` (= flusso netto), `spoiledPerMonth` (materiale perso al tetto).
  Nessuna scrittura, nessuna seconda simulazione, nessuno stato duplicato: il numero mostrato è
  quello del motore, ricomposto.
- **`NationStateService.getResources()`** espone `balance` (read model già servito da
  `/national-state` e `/resources`: **nessun nuovo endpoint**, nessuna fetch in più nel Dossier). Nei
  giochi in **modalità stretta** il magazzino non avanza: lì `balance` è `null` e il Dossier lo dice,
  invece di mostrare un ritmo che non si applica.

### Client (read model puro + presentazione)

- **`frontend/src/components/Game/materialBalance.ts`** (nuovo, puro): righe del motore → righe
  scansionabili con disponibilità, produzione/mese, consumo/mese, saldo **con segno** (tono verde =
  avanzo, rosso = deficit) e stato: `critico` (meno di un mese di copertura), `teso`, `sufficiente`,
  `in accumulo` (magazzino al tetto: il surplus va perso), `ignoto` (il motore non pubblica il
  bilancio). Importi con la formattazione condivisa `utils/format`.
- **`frontend/src/components/Game/arsenalSummary.ts`** (nuovo, puro): produzione in corso per
  armamento (somma degli ordini aperti, completamento medio ponderato sulle quantità, prima consegna
  prevista), riga di sintesi del mezzo e fotografia dell'arsenale («2 voci · 43 unità in servizio ·
  1 ordine in corso (40 pezzi)»).
- **`MaterialBalanceList.tsx`** (nuovo): presentazione unica della sintesi, usata in **due** schede
  (Risorse: tutti i materiali, senza ripetere la disponibilità già mostrata sopra; Armamenti: solo le
  scorte di armi, che sono l'input della produzione).
- **`NationDock.tsx`**:
  - tab **Armamenti**: nuovo blocco in testa «Quanto hai e quanto produci» (scorte di armamenti con
    saldo e stato + fotografia dell'arsenale), *prima* dei blocchi esistenti;
  - ogni scheda di mezzo apre con la **riga di sintesi** («×160 in servizio · in produzione ×40 (42%,
    consegna 20 giu 1951) · forza 13,0 (77,8% dell'arsenale)») e il **dettaglio tecnico** (ruolo,
    descrizione, calibro, gittata) passa in una sezione **espandibile** `<details>`, quindi resta
    disponibile ma non è più il primo livello;
  - tab **Risorse e industria**: sotto il magazzino, «Ritmo del mese: quanto produci e quanto
    consumi» (righe di sintesi dei quattro materiali).
- **`nationDossier.ts` / `NationDock/types.ts`**: normalizzazione e tipo del nuovo campo `balance`
  (solo righe con un materiale riconoscibile; il resto non viene inventato).

## 3. File modificati

**Motore (non congelato):** `backend-nest/src/game/materialBalance.ts` (nuovo),
`backend-nest/src/game/NationStateService.ts` (`getResources().balance`).
**Client:** `frontend/src/components/Game/materialBalance.ts` + `.test.ts` (nuovi),
`arsenalSummary.ts` + `.test.ts` (nuovi), `MaterialBalanceList.tsx` (nuovo),
`NationDock.tsx`, `NationDock/useNationDockModel.ts`, `NationDock/types.ts`, `nationDossier.ts`,
`frontend/src/index.css`.
**Test/E2E/docs:** `backend-nest/tests/material-balance.test.ts` (nuovo), `e2e/mock-api.mjs`
(`balance` fittizio + `resources` sovrascrivibile), `e2e/tests/materiel-clarity.spec.mjs` (nuovo),
`docs/implementation/MATERIEL-CLARITY-report.md` (questo report).

## 4. Conferma CORE ENGINE FREEZE

`core/simulation/**` **non è stato toccato**: nessuna modifica a `MaterialEconomy`, `ResourceMarket`,
`MilitaryIndustry`, `WorldStateEngine`, né a schema/db, repository, checkpoint, run o pipeline. Il
bilancio materiale si ottiene **chiamando in sola lettura funzioni pure già esistenti del motore**
(`advanceStock`, `materialNeeds`, `storageCapacity`); nessun nuovo motore, nessuna seconda verità,
nessuna migrazione, nessun nuovo endpoint.

## 5. Test eseguiti (esito reale)

- **Backend** `tests/material-balance.test.ts` (nuovo, 10 test, solo funzioni pure): etichette;
  **il saldo è esattamente il flusso del motore** e `produzione − consumo = saldo`; il consumo è il
  fabbisogno del motore (60 mln + 200 reparti → 13,2 cibo, 2,48 vestiario); nazione con terra e
  industria → avanzo su tutti e quattro i materiali; grande esercito e poca terra → deficit reale (con
  produzione comunque leggibile); tetto e materiale perso dallo stesso tick; magazzino al tetto →
  surplus perduto; senza conto nazionale nessun numero; riga di sintesi leggibile; ritmo mensile=30
  giorni. **Suite backend completa: 139 file / 1189 test verdi** (era 138/1179).
- **Frontend** `materialBalance.test.ts` (10 test): disponibilità/produzione/consumo/saldo con segno,
  tono e stato; deficit → «teso» con tono negativo; sotto un mese → «critico»; al tetto con avanzo →
  «in accumulo» e surplus dichiarato perso; bilancio assente → valori «—» e stato «non pubblicato»
  (nessun numero inventato); righe duplicate ignorate; etichetta di riserva; filtro per materiale;
  capacità assente → nessun tetto inventato.
  `arsenalSummary.test.ts` (10 test): ordini aperti sommati con completamento ponderato e consegna più
  vicina; ordini conclusi/falliti/di altri armamenti ignorati; senza ordini nessuna produzione
  inventata; riga di sintesi completa; «nessun ordine in corso» dichiarato; fotografia dell'arsenale
  (voci, unità, pezzi in produzione); dati assenti → fotografia vuota.
  **Suite frontend completa: 53 file / 354 test verdi** (era 51/334).
- **E2E mock** `e2e/tests/materiel-clarity.spec.mjs` (nuovo, 3 test, browser + API mockate):
  1. Risorse e industria: una riga per materiale con Produce/Consuma/Saldo; avanzo verde
     (`+0,30/mese`) e **deficit rosso** (`−0,50/mese`) con stato `critico` e «meno di un mese di
     copertura»;
  2. Armamenti: la sintesi è in testa (disponibilità 160/200, saldo, fotografia «2 voci · 43 unità in
     servizio · 1 ordine in corso (40 pezzi)», **solo** le scorte di armi), la riga del mezzo dice
     quante unità sono in servizio e quante in produzione, e il dettaglio tecnico è **chiuso** ma si
     apre mostrando calibro e gittata;
  3. senza bilancio pubblicato dal motore **nessuna** riga e nessun importo inventato.
  **Suite E2E mock completa: 30 test verdi** (era 27).
- `tsc --noEmit` pulito su backend e frontend; build frontend verde.

## 6. Limiti residui (dichiarati, non aggirati)

1. **Il bilancio è il ritmo del mese corrente**, ricalcolato a ogni lettura dalle funzioni del motore
   sullo stato attuale (non è un dato storico). Non è persistito: dopo un avanzamento i numeri
   cambiano con lo stato, come deve essere, ma non esiste una **serie storica** del flusso. Proposta
   non applicata: conservare il flusso del tick accanto allo snapshot del conto (nessuna migrazione,
   una chiave in più nel payload già esistente) — da valutare come intervento separato.
2. **Modalità stretta**: il magazzino non avanza e il bilancio non viene pubblicato (`null`); il
   Dossier lo dichiara invece di mostrare cifre non applicabili.
3. **Consumo per armamento**: il motore non lo registra (i mezzi si consumano per evento —
   combattimento, conquista — non con un flusso mensile). La riga del mezzo dichiara quindi «nessun
   ordine in corso» e non inventa un consumo; la leva materiale visibile resta quella delle **scorte
   di armi** (cibo/vestiario/carburante/armi), che è ciò che il motore produce e consuma davvero.
4. **Il tetto di stoccaggio può rendere «in accumulo» una nazione che produce molto**: è il
   comportamento reale del motore (il surplus si perde) ed è dichiarato nella riga, non nascosto.
5. Il «come migliorare» resta **qualitativo** (fabbriche, università, cassa o credito, catalogo di
   produzione): non viene promesso un incremento numerico per fabbrica, che dipenderebbe da bonus e
   tecnologie e sarebbe una stima del Dossier, non un dato del motore.
6. La legenda «Come si legge l'arsenale» resta dov'era (dopo la sintesi, prima dell'elenco): spiega le
   formule dei numeri, non è dettaglio tecnico di un singolo mezzo.
