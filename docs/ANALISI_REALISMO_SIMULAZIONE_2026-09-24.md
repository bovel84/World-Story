# World Story — Analisi del realismo della simulazione

**Data:** 2026-09-24
**Perimetro:** il motore deterministico (`backend-nest/src/core/`), i fatti di paese
(`utils/country-facts.ts`), i preset (`data/presets/`) e il loro uso reale a runtime.
**Metodo:** lettura del codice di `main` (`1adac70`), più esecuzione delle funzioni
compilate in `backend-nest/dist` e interrogazione in sola lettura del database
`backend-nest/data/open-pax.db`. Nessun file di codice è stato modificato.
**Escluso dal perimetro:** la resa narrativa dell'LLM, la UI, la mappa.

---

## 1. Giudizio complessivo

World Story ha un'architettura di realismo **più ambiziosa della media del genere**
e in un punto specifico — la separazione fra motore deterministico e LLM — è
eccellente: il modello non può scrivere numeri, può solo proporre reazioni che
`EffectValidator` e `ReactionDecisions` controllano riga per riga. Anche la scelta
di ancorare il fabbisogno materiale a **un contratto di unità di misura
esplicito** (`MaterialEconomy.ts:358-372`, con la tabella «campo / unità / chi lo
scala») è una pratica che raramente si vede in un progetto di questa dimensione.

Il difetto sistemico è un altro, e attraversa tutto il motore: **la scala
numerica interna non è ancorata a nessun fatto esterno, mentre le soglie di crisi
e i prezzi sono tarati come se lo fosse.** Da qui nascono gli errori gravi:
fucili da 4 milioni di dollari e portaerei da 6.000 miliardi; **cinque grandi
nazioni — Giappone, Singapore, Grecia, Italia e Stati Uniti — che vanno in
default sovrano dopo tre mesi di gioco senza che il giocatore abbia fatto
nulla**; un esercito cinquanta volte più grande che costa la stessa manutenzione;
Cina e India in carestia al primo turno. In parallelo, le etichette di *realismo
storico* dei preset (1815, 1914, 1936, 1989) non corrispondono ai dati che il
motore applica: la tabella storica copre solo due anni, 1939 e 1951, e ogni altro
mondo ricade su quello più vicino.

In sintesi: **il gioco è internamente coerente e onesto — dichiara ciò che non
può fare — ma la sua economia non regge il confronto con la realtà su cui
dichiara di fondarsi.** Sotto, i difetti ordinati per gravità, con le prove.

---

## 2. Difetti gravi

Sono i punti che alterano visibilmente il gioco in corso di partita, non solo
l'estetica dei numeri.

### 2.1 Cinque grandi nazioni vanno in default sovrano dopo tre mesi, senza fare nulla

È il difetto più grave del motore, e non è un'ipotesi: è misurato.

`seedStock` (`MaterialEconomy.ts:489-526`) emette il debito pubblico ereditato
come titoli di mercato, attraverso `seedInheritedDebt` (`MaterialEconomy.ts:464`),
valorizzati al tasso pieno di oggi:

```ts
// MaterialEconomy.ts:476-480, in seedInheritedDebt
const { debts: withTranche } = issueDebtTranche(debts, {
  amountMld: principal, termYears: step.termYears, date: issued, debtRatioPct,
  id: `debt-inherited-${index}`, label: `Debito ereditato ${step.termYears} anni`,
});
```

e `issueDebtTranche` applica `marketRatePct` (`SovereignDebt.ts:131-148`), cioè
base per durata più premio di rischio (`SovereignDebt.ts:77-97`). Il debito reale
di un paese però non è emesso al tasso di oggi: è uno stock a tassi storici, con
una vita media di 7-8 anni e un costo effettivo molto inferiore. Eseguendo il
codice sui dati reali del registro:

| Paese | PIL 2024 (mld) | Debito % PIL | Tasso applicato (8 anni) | Interessi % PIL | Servizio % entrate | Punteggio insolvenza | Livello |
|---|---|---|---|---|---|---|---|
| JPN | 4.190 | 214,5 | 12,8% | 27,5% | **275%** | **100** | critical |
| SGP | 572,9 | 166,0 | 10,4% | 17,3% | **173%** | **100** | critical |
| GRC | 256,2 | 155,4 | 9,9% | 15,4% | **154%** | **100** | critical |
| ITA | 2.383,4 | 134,7 | 8,4% | 11,3% | **113%** | **100** | critical |
| USA | 29.298 | 122,3 | 7,4% | 9,1% | **91%** | **91** | critical |
| FRA | 3.160,4 | 113,2 | 6,7% | 7,6% | 76% | 61,7 | watch |
| GBR | 3.695,5 | 99,9 | 5,6% | 5,6% | 56% | 22 | calm |
| DEU | 4.685,6 | 62,2 | 3,1% | 1,9% | 19% | 0 | calm |

Le ultime tre colonne sono il risultato di `assessCrisis` eseguito davvero, con
il servizio calcolato come in `game-session.ts:1646` (interessi annui / entrate
annue al 10% del PIL) e la soglia `max(45, baseline × 0,27 + 8)`
(`NationCrisis.ts:218`). **Cinque paesi partono già a livello `critical`**, non a
un soffio: il Giappone spende 2,75 volte le proprie entrate in soli interessi,
gli Stati Uniti il 91%.

Poiché `CRISIS_COLLAPSE_DAYS` è 90 giorni e la soglia è già superata, la
progressione è immediata. Simulando `advanceCrisis` con tick da 45 giorni, senza
che il giocatore tocchi nulla:

| Paese | Esito senza intervento | Pressione fiscale minima per evitarlo |
|---|---|---|
| JPN | **default dopo 3 mesi** | 28% del PIL |
| SGP | **default dopo 3 mesi** | 22% del PIL |
| GRC | **default dopo 3 mesi** | 19% del PIL |
| ITA | **default dopo 3 mesi** | 16% del PIL |
| USA | **default dopo 3 mesi** | 13% del PIL |

Tutti gli altri paesi verificati (FRA, GBR, DEU, ESP, PRT, CHN, IND, BRA) restano
in pace. La distribuzione è quindi tutta sbagliata: **le cinque economie più
indebitate del mondo sono ingiocabili, e lo sono per un errore di
valorizzazione**, non per una scelta di scenario. Il giocatore vede una crisi di
default a cui non ha contribuito, e l'unica contromisura è alzare la pressione
fiscale di 3-18 punti di PIL — con il costo politico che `fiscalEffects` applica
(`FiscalPolicy.ts:60-67`) e senza alcun indizio che quella sia la leva giusta.

Da notare che il giocatore **non riceve nessun avvertimento**: `CRISIS_MIN_EPISODES = 2`
(`NationCrisis.ts:56`) richiede due avanzamenti critici osservati, e li ottiene in
tre mesi. L'avvertimento obbligatorio che il sistema dichiara di dare è, in questo
caso, di 45 giorni.

**Correzione suggerita:** emettere il debito ereditato a un tasso effettivo
storico dichiarato (o almeno senza premio di rischio), e tarare la soglia di
servizio su quel valore. Con tassi effettivi realistici (1-2% per il Giappone) il
servizio scenderebbe sotto il 20% e la crisi tornerebbe a dipendere dalle scelte
del giocatore.

### 2.2 Il canale «debito nuovo» della crisi di default non è raggiungibile per costruzione

Il tetto di credito garantisce sempre un margine del 15% del PIL oltre il debito
di partenza:

```ts
// MaterialEconomy.ts:128,140
export const DEBT_HEADROOM_RATIO = 0.15;
const ceilingRatio = Math.max(DEBT_TO_GDP_LIMIT, inheritedDebtRatio + DEBT_HEADROOM_RATIO);
```

mentre la soglia di crisi parte da `baseline + 20` punti di PIL
(`NationCrisis.ts:217`). Il debito massimo legalmente raggiungibile è quindi
**sempre 5 punti di PIL sotto la soglia che dovrebbe punirlo**. Il canale è
letteralmente morto: la crisi di default può arrivare solo dal servizio del
debito, mai dal debito nuovo.

Va notato che `NationCrisis.ts:220-223` aggiunge anche un termine di scoperto di
cassa, ma `debtOf` (`MaterialEconomy.ts:110-113`) **include già lo scoperto** nel
debito totale: la stessa posizione viene punita due volte.

### 2.3 La manutenzione dell'esercito non cresce con l'esercito

Il fabbisogno militare a riposo è di **0,2 punti di scorte al mese per l'intero
esercito** (`MaterialEconomy.ts:312`, il floor `Math.max(0.2, troops × 0.004)`
che scatta fino a 50 reparti). Eseguendo `legacyMilitaryNeeds` sul codice
compilato:

```
forze   1 -> fabbisogno armamenti 0,200/mese
forze  50 -> fabbisogno armamenti 0,200/mese   <- floor
forze 100 -> fabbisogno armamenti 0,400/mese
```

Un esercito cinquanta volte più grande costa **la stessa manutenzione**. Non
esiste attrito di pace, né costo di esercizio proporzionale alla forza.

C'è un secondo strato dello stesso problema, che riguarda le **armate
persistenti** — il percorso che il gioco usa davvero. Il fabbisogno mensile per
reparto è

```ts
// OperationalState.ts:1415-1427
export function monthlyNeedsPerFormation(epoch: MilitaryEpoch): MaterialNeeds {
  void epoch; // la dottrina d'epoca non cambia i consumi unitari del motore
  const synthetic = { population: 0, forces: 1, mobilized: 0, factories: 0 } ...;
  const needs = materialNeeds(synthetic);
```

cioè **lo stesso floor di 0,2 armamenti, identico per ogni epoca e ogni tipo di
reparto**: un plotone di fanteria del 1815 e una divisione corazzata del 2026
consumano la stessa quantità di scorte, perché `epoch` viene esplicitamente
scartato. In `MilitaryService.ts:583` ogni nuova armata materializzata riceve
`needsForArmy(epoch, 1)`, quindi il valore è quello. L'epoca — che altrove
determina da 800 a 12.000 uomini per reparto (`MilitaryDoctrine.ts:94-100`) —
qui non conta nulla.

L'effetto sul gioco è che **il costo di esercizio di un esercito è quasi
indipendente dalla sua dimensione**, quindi raddoppiare le forze non raddoppia il
costo: la scelta «riarmo massiccio» non ha, nel bilancio materiale, il freno che
avrebbe nella realtà. È un difetto meno grave di §2.1, ma agisce in ogni partita
e in ogni epoca.

Va detto a parziale difesa: un reparto **senza alcun armamento** non è comunque
gratuito, perché `unitStatus` lo dichiara `forming` e `UNIT_STATUS_FACTOR` vale
**0,5** (`OperationalState.ts:1536-1542`): costa metà forza di combattimento.

**Correzione suggerita:** togliere il floor, rendere il fabbisogno proporzionale
alla forza (`troops × c`) e farlo dipendere dall'epoca e dal tipo di reparto,
come già fa il resto della dottrina.

### 2.4 Il cibo: tre grandi economie in deficit strutturale, e una fertilità troppo piatta

`naturalResourcesFor` (`MilitaryIndustry.ts:174-177`) legge la tabella
`ENDOWMENTS` (`MilitaryIndustry.ts:38-156`). Eseguendola su tutte le 212 nazioni
di `POPULATION_2024`, **119 hanno `fertile_land` esattamente 1**, 47 hanno 4, 24
hanno 3, 14 hanno 5 e 8 hanno 2; nessuna ha 0. È quindi una fascia molto piatta:
oltre la metà delle nazioni del mondo condivide lo stesso valore di terra fertile.
La resa agricola è

```ts
// MaterialEconomy.ts:693
const foodYield = (fertile * 0.55 + fisheries * 0.25 + popM * 0.004 * (1 + fertile * 0.08)) * foodBonus;
```

Eseguendo la resa e i due fabbisogni su tutte le 212 nazioni di
`POPULATION_2024`, con dotazione reale, crescita demografica del motore e numero
di reparti assegnato da `baselineCapacity`, **24 finiscono in deficit alimentare
permanente** (dettaglio della misura in §5). Le prime tre sono fra le maggiori
economie del gioco:

| Paese | Popolazione | Reparti | Produce/mese | Fabbisogno civile | Militare | Saldo |
|---|---|---|---|---|---|---|
| CHN | 1.409 M | 10 | 14,47 | 28,18 | 0,60 | **−14,31** |
| IND | 1.451 M | 9 | 16,86 | 29,02 | 0,54 | **−12,70** |
| USA | 340 M | 11 | 6,31 | 6,80 | 0,66 | **−1,15** |

Senza `agricoltura_meccanizzata` (che vale +35%, `MaterialEconomy.ts:659`) Cina e
India sono **in carestia al primo turno**: producono rispettivamente il 50% e il
57% di quanto serve. Il difetto di realismo sta nel fatto che a esserne colpiti
sono anche nazioni senza alcun problema agricolo reale — gli Stati Uniti
producono l'85% del fabbisogno — e che per i paesi poveri il responsabile
principale non è la terra ma l'**esercito**: per Mali e Burkina Faso il
fabbisogno militare è l'86% e l'89% di quello civile a fronte di appena 7
reparti, mentre per gli Stati Uniti è il 10%. Il floor di `legacyMilitaryNeeds`
(`Math.max(0.2, troops × 0.004)`) fa sì che l'esercito consumi quasi quanto la
popolazione in un paese povero e pochissimo in un paese ricco: il contrario di
ciò che accade nella realtà, dove il costo del soldato è alto in termini
relativi proprio nelle economie povere. La carestia non distingue quindi chi non
ha terra da chi non ha infrastrutture: distingue **la popolazione assoluta** e il
numero di reparti, perché il termine demografico del fabbisogno è `popM × 0,02`
(lineare, senza tetto) mentre quello della resa è `popM × 0,004` (40× più
debole). Il deficit arriva in modo punitivo sopra i ~700 milioni di abitanti. Con
una partita lunga 25 anni il problema
diventa cronico: la popolazione cresce dello 0,8% annuo in modo costante
(`WorldStateEngine.ts:293`, +22% in 25 anni) e il PIL cresce del 2-5% annuo
senza che nessuno dei due compaia nella formula della resa.

Da segnalare anche, sullo stesso meccanismo: il **salto di sviluppo**
(`developmentClass`, `MaterialEconomy.ts:284-290`, soglia 28.000 USD pro capite)
che dimezza le riserve alimentari — da 6 mesi a 2 — senza che nulla nell'economia
sia cambiato quel mese.

### 2.5 L'industria non ha un vero vincolo di domanda, e la resa industriale è piatta

Il calcolo della produzione materiale ha un tetto: `storageCapacity` limita ogni
scorta a una quota del fabbisogno — da **2 a 6 mesi di cibo** secondo la classe
di sviluppo (`RESERVE_MONTHS`, `MaterialEconomy.ts:430-435`), con un pavimento
(`:445-452`). Poiché il consumo civile è `popM × 0,02` al mese, il tetto del
magazzino alimentare è al più `popM × 0,12` per l'intero paese.

Messo a confronto con la resa **per fabbrica** (`MaterialEconomy.ts:712-719`),
che vale circa `0,7` di vestiario e `0,5` di armamenti al mese e non dipende da
quanti abitanti abbia la nazione, ne segue che **una manciata di fabbriche satura
il magazzino di una nazione di qualsiasi dimensione**: in pochi mesi la
produzione industriale diventa surplus che si perde (il commento lo dichiara:
«oltre la capacità il surplus si perde», `MaterialEconomy.ts:723-726`). Non
esiste una domanda industriale che assorba la capacità: costruire la fabbrica N+1
non produce più nulla di utile.

L'effetto è amplificato dal fatto che il fabbisogno militare a riposo non cresce
(vedi §2.3): con la guerra che non aggiunge sbocco strutturale, **la scala
industriale del gioco è di fatto limitata dalla dimensione dei magazzini e non
dalla domanda**. Il tetto alla crescita derivata dalla capacità
(`CAPACITY_LIMITS`, `NationCapacity.ts:55`: 14 fabbriche, 10 porti, 10 atenei,
24 reparti) conferma che il modello considera l'industria una grandezza piccola e
capace — ma il resto del motore non la usa come tale.

Sulla stessa linea, la resa agricola ignora la scala del paese (vedi §2.4) e il
numero di operai non compare in nessuna formula di produzione: `WorkEngine`,
`ProductionEngine` e `TransitEngine` (`core/economy/`) sono moduli separati che
non alimentano il bilancio materiale principale nel percorso legacy.
**Il lavoro, che è il fattore produttivo reale, non è modellato.**

### 2.6 La modalità storica copre due anni su due secoli

`HISTORICAL_GDP_BY_YEAR` (`country-facts.ts:735-750`) contiene **solo 1939 e
1951**. `historicalGdpYear` (`country-facts.ts:762-770`) sceglie l'anno più
vicino, quindi:

| Preset | Anno reale | Riga applicata | Conseguenza |
|---|---|---|---|
| europa_1815 | 1815 | **1939** | GBR «del 1815» con PIL 27 mld del 1939 — 10.000 USD pro capite su 1 M di abitanti |
| europa_1914 | 1914 | **1939** | plausibile per le 21 nazioni curate, incoerente per le altre 203 |
| mondo_1936 | 1936 | 1939 | accettabile |
| mondo_1989 | 1989 | **1951** | USA 346 mld invece di ~5.600 (0,06×); JPN 15 invece di ~3.050 (**0,005×**) |
| millennium_dawn | 2000 | fatti **2024** | USA 29.298 invece di ~10.250 (**2,9×**); CHN 18.730 invece di ~1.211 (**15,5×**) |
| modern_world / pax | 2026 | fatti 2024 | corretto |

La soglia `hasModernReferenceFacts` (`country-facts.ts:723-726`, `year >= 1990`)
è quindi mal posizionata: **il 1989 è punito con dati del 1951 e il 2000 è
premiato con dati del 2024.** Il problema non è la soglia booleana ma l'assenza
di righe storiche: servirebbero almeno il 1815, il 1914, il 1989 e il 2000.

Sul 1815 va aggiunto un anacronismo di sfondo: `preset.json` dichiara
`map_base: "standard"`, cioè la mappa Natural Earth moderna con 243 stati
contemporanei (Kosovo, Sud Sudan, Ucraina). Il Congresso di Vienna, in quel
preset, è solo testo.

### 2.7 Il realismo delle risorse naturali è fermo al 2024

`naturalResourcesFor` (`MilitaryIndustry.ts:174`) **non accetta una data**: la
tabella `ENDOWMENTS` è una fotografia contemporanea applicata a ogni epoca.
Eseguendo sui preset:

- **NOR nel 1815**: `oil5 gas5` — la Norvegia diventa una petrol-nazione
  centotrent'anni prima di Ekofisk.
- **SAU nel 1815 e nel 1936**: `oil5` — il petrolio saudita è del 1938.
- **DEU**: `coal4 iron1` — la Ruhr del 1914 aveva ferro abbondante, non carente.
- **USA nel 1815**: `oil4 gas5 lithium2 rare_earths2`.
- **CHN**: `rare_earths5 lithium3` — e, come visto in §2.4, `fertile_land 4`.

Lo stesso vale per il **catalogo tecnologico**, che non ha filtro d'epoca: un
mondo del 1815 può ricercare `intelligenza_artificiale`
(`MaterialEconomy.ts:98`, costo 320) e costruire missili ipersonici
(`MilitaryIndustry.ts:478`) se ha le fabbriche. L'epoca filtra solo copertura,
prontezza e seme iniziale.

### 2.8 I prezzi degli armamenti sono fuori scala di un fattore da 460 a 2.600

Dal catalogo reale (`MilitaryIndustry.ts:447-485`), con il commento che ammette
la finzione per i fucili:

| Voce | Prezzo di gioco | Prezzo reale approssimativo | Moltiplicatore |
|---|---|---|---|
| Fucile d'assalto | 4 mln USD | ~1.500 USD | **≈ 2.600×** |
| Caccia di 5ª generazione | 180.000 mln USD | ~80-100 mln | **≈ 2.000×** |
| Portaerei | 6.000.000 mln USD | ~13.000 mln | **≈ 460×** |

I moltiplicatori differiscono fra le voci di un fattore cinque, quindi non è una
semplice scala: sono numeri hard-coded non derivati da nulla. La tesoreria è in
miliardi, i costi in milioni (`MilitaryIndustry.ts:246-247`), e la conversione è
internamente coerente — ma **non è ancorata a un prezzo esterno**, e questo è ciò
che rende impossibile ragionare sul trade-off «un portaerei o cento scuole»
usando l'intuizione reale.

Un difetto minore ma reale dello stesso catalogo: i **numeri di equipaggio**
(`EQUIPMENT_CREW`) sono statici per tutte le epoche — una portaerei chiede lo
stesso numero di uomini nel 1815 e nel 2026 — mentre la dottrina varia da 800 a
12.000 uomini per reparto (`MilitaryDoctrine.ts:94-100`).

---

## 3. Difetti minori e incoerenze

**Soglia di guerra incoerente.** `atWar` è definita due volte con soglie diverse
sullo stesso indicatore: `warEffort >= 60` (`NationStateService.ts:882`) e
`warEffort >= 70` (`NationStateService.ts:1115`). La seconda è quella che
alimenta la crisi di invasione (`NationCrisis.ts:249`), quindi esiste una fascia
in cui il gioco narra una guerra ma la crisi non la vede.

**Commento obsoleto.** `TurnPipelineService.ts:769` parla di «tre turni critici e
la nazione cade», ma il codice misura **giorni di calendario**: 90 giorni pieni
con almeno 2 avanzamenti osservati, oppure 180 giorni in un colpo
(`NationCrisis.ts:391-414`). Il README riporta la versione obsoleta.

**La fame non ha conseguenze militari.** Anche con scorte a zero, i fattori di
rifornimento hanno un pavimento alto — carburante 0,55, armamenti 0,6, cibo 0,7
(`WarFronts.ts:122-134`) — e la forza resta al **23%**. Nessun esercito collassa
per fame, si attenua soltanto. Il carburante, inoltre, non entra nella prontezza
persistita (`OperationalState.ts:1587-1590`).

**Il terreno non esiste.** I fronti calcolano la pressione come
`personale × equipaggiamento × prontezza × ordine × rifornimenti`
(`WarFronts.ts:142-167`), tutti normalizzati 0-1. Montagna, fiumi, distanza e
clima non compaiono. Il teatro serve solo a scegliere l'obiettivo
(`WarFronts.ts:770-781`). Di conseguenza 8.000 uomini del 1916 e 12.000 del 1990
valgono entrambi 1,0 di pressione.

**Perdite lineari e saturate.** `rawLoss = 0,06 × mesi × (nemico/propri) ×
coefficiente d'ordine × jitter`, con tetto 0,35 per periodo
(`WarFronts.ts:58-64, 505, 535-539`). Qualunque inferiorità oltre ~6:1 produce il
massimo, quindi un reparto può passare da pieno a distrutto in tre mesi senza
fase intermedia. Il `withdraw` NPC scatta a 0,6 e lo sfondamento a 1,5
(`WarFronts.ts:284-289, 64`): finestre strette, crolli a scatti.

**Le riserve non si ricostituiscono, e l'organico conta due volte.** La riserva è
`min(bacino − attivi, max(mobilitati, attivi × reserveRatio))`
(`MilitaryDoctrine.ts:189-192`): una nazione **senza reparti in servizio ha zero
riserve**, quindi non è rappresentabile la chiamata alle armi da zero, e nessuna
funzione incrementa mai la riserva (`PersonnelStock.ts:40-41`). Inoltre
`unitStrength` moltiplica `personnelFactor` per un `readinessFactor` che contiene
a sua volta l'organico (`OperationalState.ts:1601`): l'organico pesa due volte.
Infine `maxMobilizedShare` esiste ma non è applicato: è solo un diagnostico
`overMobilized` (`MilitaryDoctrine.ts:181-206`).

**Un reparto distrutto non torna mai.** `ensureNpcUnits` non ricrea unità
(`OperationalState.ts:1357`) e `activePersonnel` viene riallineato ai superstiti
(`WarFrontService.ts:958-960, 1321-1325`): dopo una guerra gli NPC hanno `forces`
dichiarate ma nessun reparto vivo, e il numero di uomini crolla senza risalire.

**`weapons` è tre cose insieme:** scorta di munizioni consumata in guerra
(`WarFronts.ts:126`), input intermedio delle officine
(`OperationalState.ts:112-113`) e requisito d'acquisto (`MilitaryIndustry.ts:575`).
Un numero per tre concetti rende impossibile distinguere «non ho munizioni» da
«non ho acciaio».

**Nessun collo di bottiglia energetico.** `ResourceKind` è
`money | food | clothing | weapons | fuel | research`
(`MaterialEconomy.ts:26`): non esiste l'energia. Il carburante fa da surrogato,
ma l'industria bellica non ha un vincolo elettrico, che è il vincolo reale
principale di una produzione di guerra.

**Il modulo che esegue i lavori non è quello che fa i conti.** Le tre firme di
`core/economy/` — `WorkEngine`, `ProductionEngine`, `TransitEngine` — sono
importate solo da `EconomyCommitService.ts` e `StrictEffectProducerService.ts`,
cioè dal percorso *strict*. Il percorso *legacy*, che è quello in cui sono
registrate tutte le partite presenti in `open-pax.db`, calcola invece la
produzione con la formula sintetica di `MaterialEconomy.ts:709-721`, dove il
numero di lavoratori non compare. Nel percorso legacy l'occupazione è quindi
decorativa: non esiste un mercato del lavoro, non esiste disoccupazione, e una
scioperata non ha modo di ridurre la produzione — può solo agire sugli
indicatori di consenso (`PeacetimePressures.ts:339-343`). Da verificare in
modalità strict, che non ho percorso end-to-end.

**Soddisfazione militare con segno discutibile.**
`militarySatisfaction = clamp(52 + (defenceBurdenPct − 3) × 13 − socialTension × 0,05)`
(`GovernmentFactions.ts:154`): più tensione sociale significa militari **più**
soddisfatti. Probabilmente è un segno invertito.

**La memoria delle promesse è codice morto.** `FactionMemory.ts:23-25` dichiara i
tipi `'promise' | 'kept' | 'broken'`, ma l'unico produttore
(`factionMemoryFromPressure`) emette solo `favor | grievance | ignored`
(`FactionMemory.ts:218, 273`). Il meccanismo «mantieni la promessa, guadagni
fiducia» non è mai esercitato.

**L'agenda NPC non vincola le azioni.** `NpcAgenda` deriva obiettivi sensati dallo
stato (`NpcAgenda.ts:148-241`), ma il turno NPC legacy decide attacco e commercio
con tiri indipendenti (`SimulationEngine.ts:559-563`). Gli obiettivi
`preserve-alliance` non vengono mai raggiunti (`NpcAgenda.ts:298`, ritorna sempre
`false`). Allo stesso modo, `Commitments` non vede mai un trattato violato: lo
stato `broken` arriva solo da una proposta del modello
(`CommitmentService.ts:129-141`).

**La stabilità non ha un valore di riposo coerente.** Parte da 48
(`WorldStateEngine.ts:250`) e l'effetto fiscale è misurato rispetto all'aliquota
che il paese applicherebbe da sé (`WorldStateEngine.ts:203-207`), quindi in
assenza di manovre resta 48 — e la crisi di rivolta parte da
`0,45 × (100 − 48) = 23,4` punti di base. Non è un problema grave, ma significa
che il «disagio» non riflette la qualità reale del governo.

---

## 4. Quello che funziona, e va protetto

Non è un report di sole critiche, e diverse parti del motore sono migliori della
media del settore. Vale la pena elencarle perché una revisione futura non le
semplifichi per errore.

**La separazione motore/LLM è rigorosa.** Il contesto delle reazioni è costretto
(`ReactionContext.ts:141, 314-317`: attori ammessi = citati negli ordini,
confinanti, o con rapporto registrato; massimo 8), le decisioni sono validate
(`ReactionDecisions.ts:328-341`: l'opzione deve appartenere a quell'attore), il
repair di formato è concesso una volta sola e non può toccare gli esiti
(`ReactionDecisions.ts:406-414`), e `EffectValidator.ts:64-111` vieta in
modalità strict qualunque `worldChanges` materiale e ogni `mapChanges` narrativo.
È il pezzo più solido del sistema.

**Il contratto di unità di misura è esemplare.** La tabella in
`MaterialEconomy.ts:358-372` documenta per ogni campo l'unità e chi applica il
fattore tempo, e il commento spiega il difetto che chiude (un periodo parziale
allocava il fabbisogno mensile contro la disponibilità del periodo). È il tipo di
documentazione che impedisce i bug di scala.

**Il bilancio nazionale non inventa un secondo bilancio.** `NationalBudget.ts:1-18`
ripartisce i totali pubblicati dall'alto con il metodo del resto maggiore, e
dichiara che la difesa è l'unica voce esatta. La somma torna al centesimo.

**Gli obiettivi NPC sono derivati, non scritti.** `NpcAgenda.ts:148-241` costruisce
ostilità, alleanze e priorità da saldo, stabilità, rapporto di forza e sensibilità
del profilo, con revisione a 120 giorni e chiusura solo su condizione verificabile
(`NpcAgenda.ts:283-300`).

**La crisi ha un avvertimento obbligatorio.** `CRISIS_MIN_EPISODES = 2`
(`NationCrisis.ts:56`) impedisce il collasso a sorpresa: servono due avanzamenti
critici osservati, oppure 180 giorni in un colpo. Il giocatore ha sempre un
turno di preavviso. Il meccanismo è ben congegnato: il difetto di §2.1 è che
l'avvertimento, in quel caso, dura solo 45 giorni.

**Le pressioni di pace sono deterministiche e contrastabili.** Il seme è
`seed|polityId|turn` (`PeacetimePressures.ts:782`), le guardie di ammissibilità
legano ogni pressione a uno stato reale (tensione ≥ 38, cibo < 2 mesi, disavanzo
> 4,5%, stabilità < 46), e ogni opzione ha effetti dichiarati (`:319-720`). Si
possono prevedere e prevenire: è esattamente ciò che si vuole da un sistema di
pressioni.

**Il debito è un portafoglio, non un numero.** `SovereignDebt.ts` modella titoli
con tasso e scadenza, con rollover al tasso corrente
(`SovereignDebt.ts:161-176`). La meccanica è corretta; è la valorizzazione
iniziale che va corretta (§2.1).

---

## 5. Verifiche eseguite

Le cifre di questo report non sono stimate a occhio. Sono state prodotte
eseguendo il codice compilato in `backend-nest/dist`:

1. **Tassi e servizio del debito** — `referenceDebtToGdpPct` e `marketRatePct` per
   17 paesi (§2.1).
2. **Fabbisogno alimentare** — `materialNeeds` / `civilMaterialNeeds` per tutte le
   212 nazioni di `POPULATION_2024`, con conteggio dei deficit (§2.4).
   **Input dichiarati**, perché il risultato ne dipende: 6 province costiere e
   potenza militare di mappa 150 per `baselineCapacity` (valori mediani di una
   mappa provinciale), fabbisogno civile **più** militare, nessuna tecnologia
   ricercata. Con le sole esigenze civili i deficitari scendono da 24 a 4
   (CHN, IND, UGA, USA); il numero 24 dipende quindi dall'includere il termine
   militare, ed è per questo che il §2.4 ne parla esplicitamente. La
   distribuzione di `fertile_land` (119 nazioni a 1, poi 47 a 4, 24 a 3, 14 a 5,
   8 a 2, nessuna a 0) non dipende invece da alcun input.
3. **Dotazioni naturali** — `naturalResourcesFor` su tutte le 212 nazioni
   registrate, con la distribuzione di `fertile_land` (§2.4) e i casi puntuali
   NOR / SAU / DEU / USA / CHN (§2.7).
4. **Fabbisogno militare** — `legacyMilitaryNeeds` per forze da 1 a 100 (§2.3) e
   `monthlyNeedsPerFormation` per epoca (§2.3).
5. **Crescita** — `baselineCapacity` più la formula di `WorldStateEngine.ts:212-217`
   per 9 paesi, con e senza drag di mobilitazione (§2.3, §3).
6. **Tetti di magazzino contro resa industriale** — `storageCapacity` e
   `MaterialEconomy.ts:712-719` (§2.5).
7. **Progressione della crisi** — `assessCrisis` e `advanceCrisis` eseguiti
   davvero su otto paesi con debito alto, con tick da 45 giorni fino a 18 mesi, e
   ricerca della pressione fiscale minima che evita il collasso. È la misura che
   produce la tabella di §2.1.
8. **Database di gioco** — `open-pax.db` interrogato in sola lettura: 126 partite
   su 163 mondi, 7173 stock nazionali, distribuzione della tesoreria per anno di
   partenza (§3). **Attenzione:** questi sono residui di sessioni di sviluppo e
   di test, con `economy_mode = 'legacy'` e la maggior parte a 1-3 turni. Non
   sono partite rappresentative e non provano nulla sul bilanciamento: servono
   solo a mostrare la distribuzione dei valori iniziali. In particolare **non
   confermano né smentiscono §2.1**, perché nessuna partita salvata copre i due
   tick necessari al collasso. La tesoreria iniziale vale `gdp × 0,02`
   (`MaterialEconomy.ts:504`): i valori ricorrenti 5 mld (2.000 casi) e 8 mld
   (104 casi) sono coerenti con quel 2% su economie di 250 e 400 mld.

**Limiti delle misure.** Le simulazioni di §2.1 sono state eseguite con un
`CrisisInput` costruito dai fatti reali (PIL, debito, servizio) ma con gli
indicatori sociali fissati ai valori di riposo del motore (stabilità 48, tensione
16, crescita 3%, saldo zero). Un saldo negativo peggiorerebbe il quadro, non lo
migliorerebbe. Il tasso applicato è quello a 8 anni; la scadenza effettiva della
scalinata 3/8/15 anni (`MaterialEconomy.ts:466-468`) farebbe scattare il rollover
al tasso corrente, con lo stesso risultato.

**Non verificato, e da verificare a parte:** (a) il bilanciamento empirico di una
partita reale — servirebbe eseguire il simulatore con LLM configurato; (b) le
soglie effettive dei preset pre-1990 a runtime, dove `debtBurdenPct = 0`
(`WorldStateEngine.ts:244`) disattiva il canale default; (c) il percorso *strict*
end-to-end, che è quello che usa `core/economy/` e che non ho tracciato; (d) la
provenienza delle cache `.cache/balance/*.json`, che contengono indici di
`militaryPower` apparentemente generati da LLM e non derivati da fonti storiche.

---

## 6. Raccomandazioni in ordine di impatto

1. **Correggere la valorizzazione del debito ereditato** (§2.1): tasso effettivo
   storico invece del tasso di mercato corrente, e soglia di servizio conseguente.
   È il difetto più grave del motore: cinque grandi nazioni cadono in default
   dopo tre mesi senza intervento del giocatore.
2. **Allineare tetto di credito e soglia di crisi** (§2.2): portare
   `DEBT_HEADROOM_RATIO` sopra i 20 punti di PIL, o la soglia sotto il margine.
   Oggi il canale è morto e il doppio conteggio dello scoperto peggiora il quadro.
3. **Rendere proporzionale il fabbisogno di armamenti** (§2.3): togliere il floor
   di 0,2 e usare `troops × c` senza tetto, con c tarato sul consumo di guerra
   reale. Da solo, questo restituisce al riarmo il costo di esercizio che oggi
   non ha.
4. **Aggiungere le righe storiche mancanti** (§2.6): almeno 1815, 1914, 1989,
   2000. La soglia booleana del 1990 non è il problema; l'assenza delle righe sì.
5. **Ricalibrare la resa agricola** (§2.4): rendere il termine demografico
   sublineare (o legato al suolo) e alzare `fertile_land` per i paesi grandi.
   Oggi la carestia colpisce la dimensione, non la geografia.
6. **Separare le risorse naturali per epoca** (§2.7): rendere `naturalResourcesFor`
   dipendente dalla data e aggiungere le dotazioni storiche.
7. **Ancorare i prezzi del catalogo** (§2.8): derivare `costMln` da un prezzo
   reale di riferimento per voce, con un moltiplicatore di gioco dichiarato e
   uniforme.
8. **Sistemare le incoerenze minori** (§3): soglia `atWar` unica, commento
   dei «tre turni», `militarySatisfaction` con il segno giusto, applicazione di
   `maxMobilizedShare`, collegamento dell'agenda NPC alle azioni, e la
   `monthlyNeedsPerFormation` che ignora l'epoca.
9. **Rendere il blocco della manutenzione una scelta esplicita**: gli obblighi di
   manutenzione sono oggi solo proiettati e non eseguibili
   (`MaintenanceObligations.ts:13`). È un pezzo di realismo industriale che
   esiste sulla carta ma non nel gioco.

**Prima di tutto**, però, una nota di processo: i difetti di §2.1, §2.2, §2.4 e
§2.6 sono tutti **testabili senza LLM**, con le funzioni pure già presenti
(`assessCrisis`, `seedStock`, `marketRatePct`, `historicalNominalGdpUsdBillions`).
Un test di accettazione di poche righe — «nessuna nazione registrata può partire
a livello `critical` con gli indicatori di riposo» e «nessuna nazione può essere
in deficit alimentare con la sola dotazione di base» — li avrebbe intercettati
tutti. Vale la pena aggiungerli prima di ritarare i numeri, altrimenti la
calibrazione si riperderà alla prima modifica.

---

## 7. Nota di metodo

Le cifre di §2.1, §2.3, §2.4 e §3 sono state prodotte eseguendo il codice
compilato in `backend-nest/dist` e sono riproducibili; §2.1 in particolare è
verificata simulando `advanceCrisis` con tick reali, non dedotta da una formula.
Le parti derivate da esplorazione delegata sono state ricontrollate sui file
citati prima della stesura.

Nel corso della verifica ho **ritirato due affermazioni** che avevo scritto in
una prima stesura e che le misure hanno smentito: (a) che i reparti producano più
armamenti di un'industria nazionale — il meccanismo descritto non esiste nel
codice attuale, il §2.5 è stato riscritto su un difetto diverso e verificato;
(b) che i giocatori partano senza scorte — misurando la distribuzione reale, i
valori ricorrenti sono il 2% del PIL, quindi il §3 è stato sostituito con un
difetto reale (il lavoro non modellato nel percorso legacy). Ho anche corretto
una stima iniziale del servizio del debito che era sbagliata di un fattore quattro
verso il basso: le cifre finali di §2.1 sono tutte misurate, non stimate.

Una revisione indipendente successiva ha poi trovato e fatto correggere sei
imprecisioni minori (citazioni spostate di una riga, il nome `seedInheritedDebt`,
un modulo inesistente citato per errore, un arrotondamento incoerente) e ha
segnalato che i numeri di §2.4 dipendono da input non dichiarati: la sezione è
stata riscritta dichiarandoli, e il conteggio verificato di nuovo. Tutti i
numeri di questo report sono ora riproducibili con le assunzioni scritte in §5.

Dove una conclusione dipende da un'inferenza e non da una misura, il testo lo
dichiara; i limiti delle simulazioni sono elencati in §5.

Il giudizio di sintesi resta quello dell'apertura: **l'architettura è più solida
dei numeri che ci girano dentro.** Il lavoro di calibrazione — ancorare scala,
prezzi, dotazioni e tassi a fatti verificabili per epoca — è ciò che separa
questo progetto da un simulatore storico credibile, e non richiede di riscrivere
il motore: richiede di riempire le tabelle che il motore già sa leggere.
