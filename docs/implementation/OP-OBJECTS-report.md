# OP-OBJECTS — Sala di governo: oggetti reali, non numeri aggregati

**Base** `36cd8c0` · **Commit** `2b12574` (P1 motore) · `04207ef` (P2 UI) · `f0a714e` (P3 lavorazioni)
· **Mergiata** `1e140ea` (#63) · **Deploy** Worker `21184407-8f1f-41c3-b06e-dfacfb46985a`, `build.frontend 1e140ea`
· **FIX** (numeri del personale, titoli delle opere) `docs` §36 · **Report** `docs/implementation/OP-OBJECTS-report.md`

Direzione del lavoro: **STOCK → CONSUMO → PRODUZIONE → COSTO → AZIONE → CONSEGUENZA**.
Principio invariato e mai violato: **ENGINE DATA → READ MODEL → UI**. La UI non inventa
regole economiche o militari: legge, formatta, raggruppa. Ogni numero che il giocatore
vede esiste già nel payload del motore.

---

## 1. Problema attuale

La parte gestionale raccontava il paese con **aggregati** («10 fabbriche», «84.000
attivi», «capacità 146») e con molto testo. Il giocatore non percepiva **che cosa
possiede davvero**, **che cosa consuma e produce**, **quanto costa**, **che cosa gli
manca** e **che cosa succede se agisce**. Era un report con una mappa, non uno Stato.

## 2. Obiettivo di gameplay (punto 1)

Il giocatore deve capire a colpo d'occhio: cosa possiede · quanto produce · quanto
consuma · quanto costa · quanto è efficiente · cosa gli manca · cosa sta facendo ·
quale conseguenza avrà una decisione. Vale per eserciti, reparti, fabbriche, miniere,
cantieri, porti, università, costruzioni, progetti, flotte, navi. Non un ERP: una
**sala di governo leggibile**, dove ogni oggetto importante ha una scheda operativa.

## 3. Grammatica visiva universale (punto 2)

Una sola grammatica per tutti gli oggetti, nell'ordine dichiarato in
`SECTION_ORDER` (`frontend/src/components/Game/operationalObjects.ts`):

```
STATO · CAPACITÀ · PERSONALE · INPUT · OUTPUT · COSTI · AUTONOMIA/SCORTE · PROBLEMI · AZIONI
```

`FactSection` e `FactUnit` sono tipi del motore: le sezioni presenti dipendono
dall'oggetto (una miniera non ha «Personale militare»), le sezioni vuote **non
compaiono**. Problemi e azioni hanno severità e stato (`enabled` + `blockedReason`)
**stabiliti dal motore**, non dalla UI.

## 4. Due livelli (punto 3)

- **Livello A — settore/nazionale**: `Forze armate`, `Industria`, `Marina`, `Risorse`.
  Headline + 4–5 cifre chiave + problemi aperti + «Apri N oggetti».
- **Livello B — oggetto concreto**: `1ª Armata`, `Acciaierie Taranto`, `Cantiere
  Genova`, `Ferrovia transnazionale`, `Miniera di ferro`, `Marina`, `1ª Flotta`,
  `Fregata Sardegna`. Clic sull'oggetto → grammatica completa, problemi, azioni.

Se un settore non esiste (paese senza sbocco al mare, nessuna unità navale in
servizio) **la scheda non compare**: assente ≠ zero.

## 5. Ridurre il testo (punto 4)

Niente paragrafi nella vista principale: `valore · unità · problema · conseguenza`.
Le spiegazioni del motore (`why` dell'oggetto, base del piano, note dei fatti,
convenzioni) vivono **sotto «Perché?»** o nel blocco «Catene e convenzioni», chiusi
per default. Il test di rendering lo verifica: da chiusi, le spiegazioni **non
compaiono affatto** nel markup iniziale.

Target indicativo rispettato: ~70% numeri/stato · ~20% etichette · ~10% spiegazione.

## 6. Azioni con costo PRIMA → DOPO (punti 5, 29, 30)

L'azione disponibile oggi è la più importante per il ciclo di gioco: **creare un
reparto**. Flusso: `anteprima (GET, sola lettura) → COSTO IMMEDIATO · MATERIALE
NECESSARIO · righe PRIMA → DOPO · Perché? → Conferma (POST) → conseguenza reale`.

```
CREA 1 REPARTO
Costo immediato 8 mld · materiale dal deposito
11.000 uomini · 8.800/8.800 fucili · 2/2 apc · 4/4 artiglierie
Effetto        Prima        Dopo
Reparti        8            9
Uomini in armi 96.000       108.000
Prontezza      64%          67%
Carburante     0,83 /mese   1,04 /mese
Spesa militare 1,234 mld    1,241 mld
```

Ogni riga è un `delta` calcolato dal motore con `WorldStateEngine.accounts()` su una
copia del mondo **con l'armata in più** — sulle province reali (popolazione, PIL,
potenza militare, oggetti), non su una nazione impoverita. L'anteprima non scrive
nulla (c'è un test che lo dimostra confrontando arsenale e conti prima/dopo).

## 7. Eserciti (punto 6)

`OPERATING_KIND: force | army | facility | construction | navy | fleet | ship | mine`.

- **`force`** — contenitore nazionale: uomini in armi, riserva, riservisti
  richiamabili, prontezza, fabbisogni (carburante/armamenti/cibo), spesa mensile,
  autonomia carburante in mesi, problemi = driver di prontezza non positivi.
- **`army`** — una armata per **oggetto `army` reale della mappa** (nome e provincia
  del mondo) più un «schieramento nazionale» che raccoglie i reparti derivati dal
  profilo del paese. La somma dei reparti delle armate è **esattamente** `forces`
  (test dedicato). Ogni armata ha una quota coerente di personale, prontezza,
  copertura, fabbisogni e spesa, **in proporzione ai suoi reparti**.

## 8. Creazione esercito (punto 7)

`formationPlan` → `formationImpact` → `applyFormationPlan` → `raiseFormation`.
Creare un reparto **consuma davvero**: manpower (la riserva non cresce),
equipaggiamento **preso dal deposito**, cassa e — se serve — credito; e **dopo**
alza fabbisogni, consumi e spesa mensile. Il motore rifiuta con un codice
(`formation_blocked`) quando il deposito non basta; la UI mostra l'azione
**disabilitata con il motivo**, non un errore generico.

Il fatto nuovo è un **oggetto `army` nel mondo**, persistito come gli altri oggetti
di regione (`syncRegionsToDB`): le forze non sono una seconda contabilità, sono la
conseguenza dell'oggetto sulla mappa.

## 9. Personale militare (punto 8)

`militaryManpower` (COUNTRY-CLARITY ENGINE): `activePersonnel`, `reservePersonnel`,
`mobilizedPersonnel`, `availableReserve`, `mobilizationCap`, `mobilizationHeadroom`,
`overMobilized`. La creazione di reparti mostra sempre `Uomini in armi` e `Riserva
addestrata` PRIMA → DOPO: nessun aumento di forze scollegato dagli uomini.

## 10. Equipaggiamento esercito (punto 9)

Riusa `MilitaryDoctrine` (`establishment`, `equipmentCoverage`, `individualWeaponShare`)
e il catalogo `MilitaryIndustry`. La dotazione richiesta di un reparto è **la stessa
funzione** che calcola la copertura nazionale; l'anteprima valorizza il materiale al
**costo di catalogo**. Il motore non registra quale reparto possiede quale pezzo:
la quota di equipaggiamento di una armata è **una convenzione dichiarata** (in
proporzione ai reparti), con la somma delle armate pari al totale nazionale. Regola
documentata nell'oggetto e nell'elenco `conventions` del payload.

## 11. Fabbisogni operativi (punto 10)

Forze armate e armate dichiarano `Carburante`, `Armamenti`, `Cibo` (flussi mensili) e
l'**autonomia in mesi** dalle scorte reali. Nessun materiale nuovo è stato introdotto.

## 12. Fabbriche (punti 11–12)

Non più «10 fabbriche»: un oggetto per impianto, con nome dichiarato
(`PLANT_NAME_POOL`) e provincia assegnata (le più popolose / costiere).

```
Acciaieria Italia · Impianto industriale · Operativo
Linee di lavorazione 4 · Utilizzo 40% · Ritmo di lavoro 40%
Output: Armamenti 0,7/mese · Vestiario 0,4/mese
Input: Carburante 0,2/mese · Minerali ferrosi 0,34/mese · Carbone 0,52/mese
Personale: Addetti 9.000 · Costo operativo 0,44 mld
Ordine in lavorazione: Fucili d'assalto ×30 · 42%
Consegna prevista: 20 giu 1951
```

Produzione e input di un impianto sono il **contributo marginale** calcolato con
`advanceStock` sul profilo di quell'impianto (`marginalProduction`), riportato alla
scala del singolo stabilimento; le linee occupate vengono da `plantAllocatedLines`
sulla capacità reale del motore.

## 13. Fabbriche militari (punto 13)

Ogni impianto dichiara **la lavorazione che gli è assegnata**: ordine, quantità
ancora in lavorazione, avanzamento in % e data di consegna prevista. Gli ordini di
terra sono distribuiti sugli impianti a rotazione (`plantOrders`): un ordine va a
**un solo** impianto, così le schede non si contraddicono e il totale resta quello
nazionale. Impianto fermo (nessuna linea) → output **zero**, con problema critico.

## 14. Catena produttiva (punto 14)

`chains` nel payload: ogni catena è una sequenza di anelli con valore, tono e
dettaglio, più `broken` e una sintesi. La catena degli armamenti segue il magazzino
reale (`balance` del motore) e termina sull'esercito, dichiarando la copertura. La
catena navale resta rotta finché non c'è una nave **in servizio**. Tutto **emerge dai
dati del motore**, non da testo narrativo.

## 15. Industria nazionale (punto 15)

Scheda `Industria`: impianti, linee totali, occupate, libere, cantieri, più i
problemi critici degli impianti e — se il motore lo dichiara — `Produzione bloccata:
nessuna capacità`. Da lì si apre il singolo impianto.

## 16. Costruzioni (punti 16–17)

Oggetto `construction` per ogni progetto reale: avanzamento, linee occupate, mesi al
completamento, materiali, spesa in corso e **`Beneficio 0`** con la nota del motore
«Nessuno prima del completamento». Un'opera in costruzione occupa capacità e
materiali ma **non è contata fra gli impianti** (il cantiere è un `construction_site`,
non una fabbrica): test dedicato.

## 17. Marina · flotte · navi (punti 18–23)

Gerarchia `force → navy → fleet → ship`, derivata dalle **unità navali realmente in
arsenale** (`navalInventory`):

- **Marina**: navi in servizio/operative/in manutenzione/in costruzione, equipaggi,
  prontezza, copertura navale, composizione per tipo, carburante, spesa della marina,
  autonomia in mesi.
- **Flotta** (per categoria): navi, equipaggi, prontezza, carburante, munizionamento
  disponibile, spesa, problemi (unità in manutenzione, munizionamento assente).
- **Nave**: equipaggio dal catalogo, prontezza, missili disponibili, carburante
  per unità, **costo operativo in milioni** (uno scafo costa una frazione di
  miliardo, quindi si legge in `mln`), autonomia in % con i mesi di scorte
  nazionali, stato di manutenzione.

**Nessuna nave prima del completamento**: gli scafi in costruzione sono separati
(`Scafi in costruzione`) e la catena navale resta rotta finché non entrano in
servizio. Le navi rappresentate sono al massimo `MAX_REPRESENTATIVE_SHIPS` (4) per
tipo, per non generare venti schede identiche.

## 18. Manutenzione (punto 24)

Stati `operational | degraded | maintenance | idle | under_construction | critical`.
La manutenzione consuma cassa e capacità (linee `maintenance` del motore) e rende le
unità **non pienamente operative**: la singola nave in manutenzione lo dichiara nei
fatti e nei problemi. Nessuna simulazione di usura nuova.

## 19. Cantieri navali (punto 22)

I cantieri sono i **porti** del paese: senza sbocco al mare non esistono. Ogni
cantiere mostra linee, utilizzo, scafi in costruzione con ordine/avanzamento/data,
acciaio e componenti, carburante movimentato, addetti, costo operativo, unità in
manutenzione e la regola «lo scafo in costruzione non è una nave».

## 20. Università e ricerca (punto 26)

Oggetto `facility` per ateneo: linee di ricerca, linee occupate da progetti, punti
ricerca mensili, addetti, costo; se esiste un progetto di ricerca reale, progetto in
corso, avanzamento e mesi al completamento, con il problema «la tecnologia si sblocca
solo a progetto completato».

## 21. Miniere e risorse (punto 27)

Un oggetto `mine` per ogni giacimento **dichiarato dal registro del paese** (assente
≠ zero), con giacimento, contributo mensile, sfruttamento, addetti, costo operativo.
Il contributo è il **delta di produzione** che il motore calcola aggiungendo una unità
di quella risorsa (`endowmentContribution`), e il problema «Contributo nullo» compare
quando la tecnologia attuale non lo valorizza.

## 22. Porti ed economia (punti 25, 28)

I porti sono i cantieri (capacità, utilizzo, navi in manutenzione, scafi in
costruzione). L'economia sintetica — cassa, saldo, debito/PIL, spesa militare,
industria — resta il quadro già consegnato con COUNTRY-CLARITY (riuso, non
duplicazione: nessuna nuova scheda economica in questa consegna).

## 23. Conseguenze e PRIMA → DOPO (punti 29–30)

La conferma di un'azione è composta dai delta del motore, non da una spiegazione:
`Uomini in armi 96.000 → 108.000 · Spesa militare 1,234 → 1,241 mld`. La stessa
tabella è usata nell'anteprima e nel riepilogo post-azione.

## 24. Paese come sistema (punto 31)

Le dipendenze sono visibili dove il motore le conosce: persone → esercito/impianti
(addetti, uomini in armi); risorse/miniere → produzione (contributo marginale);
impianti → equipaggiamento (output mensile); cantieri → navi (scafi in costruzione);
carburante → eserciti e flotte (autonomia in mesi); denaro → tutto (spesa, costi
operativi, cassa e credito dell'azione).

## 25. Progressive disclosure e mobile (punti 32–34)

`Settore → oggetto → dettaglio completo → Perché?`. Nessun elenco di venti metriche
insieme: ogni scheda mostra 4–8 cifre, i problemi aperti e le azioni; il resto è a un
clic. Su mobile le schede di settore passano a una colonna, le righe PRIMA → DOPO si
comprimono e le tabelle non traboccano (test e2e a 390 px).

## 26. Riuso del motore (punto 35)

Riusati **senza duplicare**: `MilitaryDoctrine` (epoch, manpower, establishment,
copertura, prontezza, seed, armi individuali), `MilitaryService` (arsenale, capacità
industriale, produzione, procure), `MilitaryProduction`, `MilitaryIndustry` (catalogo,
forza, equipaggi), `IndustrialCapacity` (totale, occupazione, saturazione, blocco,
assegnazioni), `MaterialEconomy` (`advanceStock`, `materialNeeds`, `ResourceStock`),
`WorldStateEngine.accounts` (forze e conti del «dopo»), `NationCapacity`,
`NationStateService` (scorte, debito, credito), oggetti e regioni del mondo, progetto
e manutenzione già pubblicati.

Nessuna formula riscritta: manpower, copertura, prontezza, capacità industriale,
ritmo di produzione e bilanci materiali restano **una sola implementazione**.

## 26-bis. Personale e costi degli impianti: convenzioni dichiarate

Il motore non pubblica l'occupazione industriale. La prima versione ricavava gli
addetti da una quota di popolazione (11%): la verifica live su un gioco reale ha
mostrato **923.314 addetti in una acciaieria** e 44.319 per miniera — un numero che
nessun giocatore può credere. La convenzione è stata sostituita con un valore **per
linea**, plausibile e dichiarato (`STAFF_PER_LINE`: 900 per linea di fabbrica, 1.200
per linea di cantiere, 600 per linea di ricerca; miniere: 340 addetti per punto di
giacimento). Il costo operativo resta la quota di spesa civile ripartita per linee.

Dettaglio della correzione in §36.

## 27. Nuovi modelli (punto 36)

Un solo modulo nuovo: **`backend-nest/src/core/simulation/OperationalObjects.ts`**
(puro, senza I/O, nessuna scrittura, nessuno stato). Non è un framework astratto: è
la struttura minima che serve a dare nome, gerarchia, grammatica, problemi e azioni
agli oggetti che il motore già conosce. Nessuna tabella nuova, nessuna migrazione,
nessun endpoint nuovo se non le due rotte dell'azione (`GET/POST
/api/games/:id/military/formation`).

## 28. Ordine di implementazione (punti 37–38)

| Fase | Contenuto | Dove |
| --- | --- | --- |
| P1 | Grammatica, tipi, oggetti concreti, testo ridotto | `OperationalObjects.ts`, read model, `ObjectsBoard` |
| P2 | Armata/reparto + creazione reale | `formationPlan/Impact/apply`, rotte, azione UI |
| P3 | Fabbrica/impianto | oggetti `facility` + lavorazione assegnata |
| P4 | Costruzioni | oggetto `construction` (beneficio 0) |
| P5 | Marina/flotte | `navy`, `fleet` |
| P6 | Singole navi | `ship` (equipaggio, munizionamento, costi, manutenzione) |
| P7 | Cantieri | cantieri/porti con scafi in costruzione |
| P8 | Miniere/università/altri impianti | `mine`, atenei |
| P9 | Before/after delle azioni | anteprima + conferma (reparto) |
| P10 | Polish e mobile | CSS, e2e a 390 px, testo ridotto |

Le fasi P1–P9 sono nella consegna; P10 è coperta da CSS ed e2e (nessun restyling
grafico ampio, come da vincolo).

## 29. Test obbligatori (punto 39)

`backend-nest/tests/operational-objects.test.ts` — **29 test**:

- **Esercito**: piano (armi individuali dalla quota uomini, mezzi per reparto);
  blocco senza fucili; valorizzazione al costo di catalogo; creazione che consuma
  manpower, alza fabbisogno/consumi/spesa; conteggio nella sola provincia scelta;
  problema delle armi mancanti sulla singola armata; copertura di tutte le categorie
  del catalogo.
- **Fabbrica**: impianto fermo → output 0 e problema critico; industria satura →
  produzione rallentata per tutti; **input insufficiente (nessun giacimento di ferro)
  → produzione più bassa**; nessuna capacità → blocco con fattore 0; linee attribuite
  senza superare quelle dell'impianto; **lavorazione assegnata con avanzamento e data**;
  rotazione senza duplicati.
- **Costruzione**: occupa capacità e materiali, non aumenta gli impianti, dichiara
  beneficio 0 e tempo residuo; cantiere senza capacità → problema critico.
- **Navi**: solo quelle consegnate (scafi separati); nave operativa consuma e costa;
  manutenzione → non pienamente operativa; catena navale rotta senza navi.
- **Catene**: input ↓ → produzione ↓ → output ↓; magazzino come anello finale;
  inventario navale solo dalle voci navali.

`backend-nest/tests/op-objects-integration.test.ts` — **8 test** di sessione: payload
`/arsenal.objects`, somma delle armate = `forces`, armata reale con nome e provincia,
marina/flotta/nave dopo l'acquisto, anteprima senza scritture, creazione che aggiunge
l'oggetto `army` **persistito** e alza forze e spesa, rinforzo di una armata esistente,
rifiuto dal motore con codice.

`frontend/src/components/Game/operationalObjects.test.ts` — **12 test**: unità e
decimali (0,83 ≠ 1; 0,004 mld; 812,5 mln), date di gioco, ordine della grammatica,
sezioni vuote assenti, note del motore, problema più grave/toni, selezione e figli,
schede di settore (assente ≠ zero; blocco ≠ rallentamento), vista dell'azione
(costo, materiale, righe PRIMA → DOPO) e riepilogo esito.

`frontend/src/components/Game/objectsBoard.test.tsx` — **5 test** di rendering:
livello A con i numeri, problemi aperti, **testo ridotto** (nessuna spiegazione lunga
nella vista principale), catene e convenzioni, vincolo di sola presentazione
(nessuna chiamata di rete, nessun `useEffect`).

`e2e/tests/op-objects.spec.mjs` — **8 casi** mock: settori, oggetto con grammatica,
cantiere senza beneficio, fabbrica con lavorazione e consegna, azione PRIMA → DOPO e
conferma, azione bloccata con motivo, catene/convenzioni, mobile senza traboccamenti.

## 30. Regressioni (punto 40)

Nessuna regressione ammessa e nessuna rilevata: COUNTRY-CLARITY (7 read model + quadro
d'insieme), COUNTRY-CLARITY ENGINE (manpower, copertura, prontezza, capacità
industriale, seed, armi individuali), procurement, consegna della produzione,
playback, crisi, rewind, branching, mappa e mobile restano invariati. La suite e2e
mock completa (**45** casi) è verde, inclusi gli 8 preesistenti di country-clarity e
gli 11 di mappa/preset.

## 31. Quality gate (punto 41) — eseguito davvero

| Comando | Esito |
| --- | --- |
| backend `npx tsc --noEmit` | ✅ 0 errori |
| backend `npx vitest run` | ✅ **153 file / 1407 test** |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ 0 errori |
| frontend `npx vitest run` | ✅ **67 file / 485 test** |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **45/45** |

Inventario endpoint rigenerato (`docs/implementation/q02-endpoint-inventory.json`):
le due nuove rotte sono contate come mutazione + lettura.

## 32. Definizione di fatto (punto 42)

Il giocatore clicca su un esercito, una fabbrica, una costruzione, una flotta, una
nave e legge in pochi secondi: cosa è, quanto vale, quante persone usa, cosa consuma,
cosa produce, quanto costa, cosa gli manca, cosa sta facendo, quali azioni può fare. E
quando decide, vede `prima → azione → dopo` senza leggere un paragrafo.

## 33. CORE ENGINE FREEZE — nota obbligatoria

`OperationalObjects.ts` è **nuovo** e **puro**: nessuna scrittura, nessun timer,
nessun secondo stato. I file toccati fuori dal perimetro erano già autorizzati per
questa consegna (wiring minimo, come per COUNTRY-CLARITY):

- `MilitaryService.ts` — accessori di contesto (`playerRegions?`, `addArmyObject?`),
  `getOperatingPicture()`, `formationPreview()`, `raiseFormation()`, aggiunta di
  `objects` al payload di `/arsenal`. **Nessuna formula esistente modificata.**
- `game-session.ts` — `playerRegionsForObjects()`, `addArmyObjectForSession()`
  (persistenza con `syncRegionsToDB`), inoltro di `formationPreview`/`raiseFormation`.
- `MilitaryIndustry.ts` — solo la mappa `EQUIPMENT_CREW` (equipaggio per scafo) per
  dare un fatto reale alle navi.
- `routes/games/state.routes.ts` + `helpers.ts` — due rotte e un elenco di codici.
- Frontend: `api.ts`, `useNationSnapshot.ts`, `GameScreen.tsx`, `DeskContent.tsx`,
  `NationDock.tsx`/`types.ts`, `index.css` (solo classi nuove `obj-*`).

Non sono stati toccati: crisi, playback, branching, rewind, `FactionMemory`,
`NpcAgenda`, `Commitments`, `PeacetimePressures`, `WorldStateEngine`,
`MaterialEconomy`, schema/database, checkpoint, `TurnOrchestrator`,
`TurnPipelineService`. **Nessuna migrazione, nessuna tabella nuova.**

## 34. Limiti dichiarati (onestà, non promesse)

1. **Equipaggiamento per armata**: il motore non registra quale reparto possiede
   quale pezzo. La quota per armata è una **convenzione** proporzionale ai reparti;
   la somma delle armate è il totale nazionale. Se in futuro il motore assegnerà
   materiale alle armate, il read model leggerà quel dato.
2. **Navi e flotte**: il motore conta gli **scafi per tipo**, non le squadre. Il
   raggruppamento in flotte per categoria e i nomi/ordinali delle navi sono
   convenzioni dichiarate; al massimo 4 navi rappresentate per tipo.
3. **Nomi degli impianti**: dichiarati (`PLANT_NAME_POOL`) con provincia assegnata per
   popolazione/costa; il motore conta le fabbriche, non gli stabilimenti.
4. **Addetti e costo operativo di un impianto**: convenzione dichiarata — addetti
   **per linea** (900 fabbrica · 1.200 cantiere · 600 ricerca; 340 per punto di
   giacimento) e spesa civile ripartita per linee. Il motore non pubblica
   l'occupazione industriale: la scheda non la ricava dal PIL (vedi §36).
5. **Manutenzione per singola nave**: quando il motore ha lavori aperti, l'attribuzione
   alle unità è convenzionale (il motore conosce le linee, non l'ordine di cantiere).
6. **PRIMA → DOPO disponibile solo per la creazione di reparti** (P9): procurement,
   ordini di produzione e progetto nave mostrano i costi esistenti, ma non una tabella
   di impatto calcolata come quella dei reparti. Estenderla richiede di definire il
   «dopo» del motore per ciascuna azione (proposta separata, non in questa consegna).
7. **Porti**: movimentazione merci e blocchi portuali non sono pubblicati dal motore,
   quindi non vengono mostrati (assente ≠ zero).
8. **Integrità dello scafo, munizionamento AA/siluri, intervallo di manutenzione
   «tra N mesi»** (§21): non disponibili nel motore come dati per unità; mostriamo ciò
   che esiste (equipaggio, missili disponibili in arsenale, carburante, stato).
9. **Beneficio futuro di un'opera** (§16, §17): il motore non pubblica l'effetto al
   completamento in forma strutturata; la scheda dichiara `Beneficio 0` e il tempo
   residuo, senza inventare l'incremento futuro.
10. **Economia sintetica** (§28): resta il quadro COUNTRY-CLARITY, non duplicato qui.
11. **Missione della flotta** (§20): non esiste nel motore.
12. **`landOrders`/`navalOrders`**: gli ordini non consegnati sono ora usati per le
    lavorazioni assegnate; il progresso è quello dell'ordine (aggregato nazionale), non
    un progresso per impianto registrato dal motore.

## 36. FIX post-deploy — numeri plausibili e titoli brevi

La verifica live (dopo il merge `1e140ea`, Worker `21184407…`) ha mostrato due
difetti che i test non coglievano perché non guardavano la **plausibilità** del
numero, solo la coerenza della struttura:

1. **Addetti assurdi.** `workforce = popolazione × 11%` distribuito sulle linee
   produceva `923.314` addetti per una acciaieria e `44.319` per una miniera su un
   gioco reale del 1815. Intervento: `STAFF_PER_LINE` (per linea, dichiarato) e
   `STAFF_PER_MINE_POINT` (per punto di giacimento); la convenzione nel payload è
   aggiornata; due test nuovi verificano il valore per linea e che il totale degli
   addetti resti una frazione plausibile della popolazione.
2. **Titoli delle opere = paragrafi.** Le costruzioni derivavano il `label` dal
   titolo grezzo del progetto: fino a 300 caratteri nel punto più visibile della
   scheda, contro la regola «la vista principale è di numeri». Intervento:
   `shortTitle()` (78 caratteri, taglio all'ultima parola) e titolo completo
   riportato sotto «Perché?» (`Opera: …`). Un test nuovo copre il taglio e la
   conservazione del testo integrale.

3. **Riga «Spesa militare» ferma.** L'anteprima mostrava `Spesa militare 5,543 mld →
   5,543 mld` mentre `Spese dello Stato` saliva di 0,216 mld: la quota di difesa che
   il motore pubblica è **arrotondata allo 0,1% del PIL**, quindi un singolo reparto
   non la muove (il costo reale è 0,07 punti di PIL). La riga ferma è stata tolta —
   una riga che non si muove non è una conseguenza — e il costo mensile si legge in
   `Spese dello Stato` e `Saldo mensile`, con la spiegazione in «Perché?».
4. **Nome provincia vuoto.** In alcuni mondi la provincia non ha nome: la notifica
   dopo la creazione non stampa più «in linea a ». La UI non inventa un toponimo.

5. **Altre righe ferme.** `Consumo armamenti 0,2 → 0,2`: l'incremento di un reparto è
   sotto il terzo decimale pubblicato. Regola generale nella vista: si mostrano solo
   le righe che **cambiano ai decimali con cui si leggono** — una riga ferma non è una
   conseguenza. Con un lotto grande (10 reparti) la riga ricompare da sola, perché il
   consumo cambia davvero.

Nessuna formula del motore è stata toccata: solo convenzioni di presentazione
dichiarate, la scelta delle righe da mostrare e la lunghezza di un'etichetta.
Backend **153 file / 1409 test**; frontend **67 file / 485 test**.

## 37. Verifica live post-deploy (attraverso il Worker)

Worker **`db0d21e4-e313-4ef8-bbcf-0b3e5f55aa9a`**, `build.frontend c6338ab`, 51 tabelle,
`auth: open-single-user`. Numeri reali dall'API pubblica, non da fixture:

**Gioco del 1815 `246c9cda8b8f`** (Eserciti pre-industriali) — 11 oggetti:
`{force:1, army:1, facility:2, construction:3, mine:4}`. Forze armate: 3.200 uomini in
armi, riserva 1.440, prontezza 4%, 11,8 mesi di carburante. Armata: «Reparti di
guarnigione», 3 reparti (somma = `forces`), azione **bloccata** con motivo
«Mancano 2.720 pezzi — Armi individuali». Addetti: acciaieria **9.000**, ateneo
**1.200**, miniere 340–1.360. Tre opere con etichetta ≤ **77 caratteri** e titolo
integrale sotto «Perché?». Catena degli armamenti **rotta** (copertura 5,6%), catena
navale senza navi.

**Gioco moderno `23fd1fe361ae`** — 25 oggetti:
`{force:1, army:1, facility:17, mine:6}`. Forze armate: 96.000 uomini, riserva 86.400,
prontezza 47%, 5,3 mesi di carburante. Ogni acciaieria **9.000 addetti** (prima
923.314), ogni ateneo 1.200. Nessuna riga ferma: anteprima della creazione di un
reparto →

```
Reparti                 8 → 9
Uomini in armi          96.000 → 108.000
Riserva addestrata      86.400 → 97.200
Copertura armi indiv.   100% → 77,8%
Pronto operativo        47% → 35%
Carburante (scorte)     5,3 → 5,1 mesi
Consumo carburante      0,74 → 0,77 /mese
Spese dello Stato       15,299 → 15,515 mld
Saldo mensile           13,495 → 13,279 mld
```

(L'azione è disponibile: 72.000 fucili in deposito su 9.000 richiesti; costo immediato
41.000 mln.) Nessun errore di schema, nessuna migrazione: 51 tabelle prima e dopo.

## 35. File toccati e commit

**Nuovi**
- `backend-nest/src/core/simulation/OperationalObjects.ts`
- `backend-nest/tests/operational-objects.test.ts`
- `backend-nest/tests/op-objects-integration.test.ts`
- `frontend/src/components/Game/operationalObjects.ts` (+ `.test.ts`)
- `frontend/src/components/Game/ObjectsBoard.tsx` (+ `.test.tsx`)
- `e2e/tests/op-objects.spec.mjs`
- `docs/implementation/OP-OBJECTS-report.md`

**Modificati**
- `backend-nest/src/game/MilitaryService.ts`, `backend-nest/src/game-session.ts`,
  `backend-nest/src/core/simulation/MilitaryIndustry.ts`,
  `backend-nest/src/routes/games/state.routes.ts`, `backend-nest/src/routes/games/helpers.ts`
- `docs/implementation/q02-endpoint-inventory.json`
- `frontend/src/services/api.ts`, `frontend/src/hooks/useNationSnapshot.ts`,
  `frontend/src/components/Game/{GameScreen,NationDock}.tsx`,
  `frontend/src/components/Game/NationDock/types.ts`,
  `frontend/src/components/Shell/DeskContent.tsx`, `frontend/src/index.css`
- `e2e/mock-api.mjs`

**Commit**
1. `2b12574` — **OP-OBJECTS P1** — motore: oggetti operativi concreti e creazione reparti
2. `04207ef` — **OP-OBJECTS P2** — sala di governo in UI: oggetti concreti, testo ridotto
3. `f0a714e` — **OP-OBJECTS P3** — lavorazioni assegnate agli impianti e date di consegna

Nessuna modifica al preset non tracciato
`backend-nest/data/presets/modern_world_provinces/preset.json` (non nostro).
