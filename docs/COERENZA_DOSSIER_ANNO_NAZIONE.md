# World Story — il dossier coerente con l'anno e con la nazione scelti

**Versione:** 1.2, 25 settembre 2026.
**Stato:** **N01, N02, N03, N04, N05, N06 e N08 implementate, verificate e pubblicate online.**
N07 attende la decisione di vocabolario D-D. Le cinque decisioni di §5 restano aperte.
Le sezioni consegnate riportano, in coda, cosa è stato fatto e cosa la misura ha smentito.
Il sito `https://world-story.bovel-cannas.workers.dev` serve ora queste correzioni (§8, «Il deploy»).
**Destinatari:** sviluppatori e LLM esecutori; ogni scelta marcata «obbligatoria» è un
contratto.
**Mandato dichiarato:** **solo frontend. Il motore non si tocca.** Le fasi che
richiederebbero un dato nuovo dal motore (§5) sono elencate come decisioni da prendere,
non come lavoro da fare. Una di queste — il filtro d'epoca del catalogo armamenti — **sembrava**
frontend e non lo è: la misura ha cambiato la fase N05, non il mandato.
**Rapporto con gli altri piani:** prosegue `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md` (D01–D07,
consegnate). Quel piano ha risolto *dove* sta una cifra e *quanto* se ne capisce; questo
risolve *di quando* e *di chi* è quella cifra.

> **Il problema in una riga.** Il dossier presenta i numeri di qualunque partita con le
> etichette e il vocabolario di una partita moderna, e nel caso peggiore mostra come nome
> della nazione una provincia: **lo stesso schermo dice la stessa cosa su un mondo del 1815
> e su uno del 2026**, e sul mondo provinciale sbaglia il nome del paese del giocatore.

---

## Indice

1. Il metodo (misurato, non letto)
2. Cosa significa «coerente»
3. Diagnosi A — l'anno
4. Diagnosi B — la nazione
5. Il confine del mandato: cosa il solo frontend **non** può fare
6. Invarianti obbligatorie (N1–N7)
7. Le fasi (N01–N08)
8. Criteri di completamento e verifica
9. Cosa NON fare

---

## 1. Il metodo

Come per il piano precedente, ogni voce di questa diagnosi è **una misura**, non
un'impressione. I numeri sono stati prodotti eseguendo il codice del motore e interrogando
il database reale, non leggendo intenzioni nei commenti. Le tre misure che reggono l'intero
piano:

**Misura 1 — la forma di governo di una nazione del 1815.** Eseguito
`governmentForPolity(code)` (motore) sulle politie del preset `europa_1815`:

| Codice | Nome curato dal preset | Forma di governo mostrata dal dossier |
|---|---|---|
| FRA | Regno di Francia | Repubblica semipresidenziale |
| RUS | Impero Russo | Repubblica federale semipresidenziale |
| AUT | Impero d'Austria | Repubblica federale parlamentare |
| DEU | Confederazione Germanica | Repubblica federale parlamentare |
| ITA | *(non curato in `europa_1815`)* | Repubblica parlamentare |
| GBR | Regno Unito di Gran Bretagna e Irlanda | Monarchia parlamentare |
| PRT | Regno di Portogallo | **Forma di governo non registrata** |
| POL | Regno di Polonia | **Forma di governo non registrata** |

Il registro `GOVERNMENTS` (`backend-nest/src/utils/country-facts.ts:631`) è un registro del
**2026**, applicato a qualunque anno da `WorldStateEngine.ts:156`. Il dossier lo mostra come
«Assetto registrato per questo paese» (`NationDock.tsx:986`). Cinquecento anni di storia
diventano una repubblica presidenziale.

**Misura 2 — il catalogo armamenti di un mondo pre-industriale.** Eseguiti
`epochForDate('1815-06-09')` → `pre_industriale` e `establishmentFor('pre_industriale')`: la
dottrina dichiara **una sola** categoria pertinente, «Fanteria», con la motivazione scritta nel
motore («il catalogo dell'epoca non ha mezzi corazzati, aerei o missili»). Il catalogo servito
al dossier contiene **31 voci**: applicando il predicato reale del motore
(`match.categories ∪ match.domains`) ne risultano pertinenti **1**, «Fucili d'assalto», e
**30 fuori dalla dottrina** — carri di 4ª generazione, caccia di 5ª generazione, portaerei,
missili ipersonici, sciami di droni. Il dossier le elenca tutte, in una partita del 1815, sotto
le cinque intestazioni di dominio scritte a mano nel componente (`NationDock.tsx:905`).

La misura dice anche una cosa che il piano deve tenere: **il catalogo non ha nemmeno una voce
pre-industriale adeguata** (il fucile d'assalto è del 1944). Non mancano solo le esclusioni:
per il 1815 manca la dottrina. È il motivo per cui N05 non «filtra» ma **dichiara** — e per cui
D-A, se si vuole il filtro vero, è una decisione di contenuto prima che di codice.

**Misura 3 — il nome della nazione su un mondo provinciale.** Interrogato il database reale,
world `0af266ac3155` (preset `pax_modern_provinces`, 942 regioni): le regioni del giocatore
USA si chiamano `Alaska`, `Texas`, `Montana`… `world_regions.name` è **il nome della
provincia**. Il campo che il dossier usa come titolo
(`state.routes.ts:130-132`) restituisce perciò «United States», mentre il preset cura
«Stati Uniti d'America». Il motore ha la catena corretta (`publicPolityName`,
`game-session.ts:2067`) e la pubblica su `GET /:id/relationships` come mappa `names` — ma il
titolo non la usa, e **la mappa non è completa**: sulle politie senza relazioni diplomatiche
non ha la voce (misurato: `LKA` su 112 politie nel mondo provinciale; `AUT`, `CHE`, `KEN` su 40
nel mondo 1951). È il caso raro che N01 deve coprire senza inventare un nome.

---

## 2. Cosa significa «coerente»

Coerenza **non** è «verosimiglianza storica». Il gioco è dichiaratamente di storia
alternativa, e il motore ha già deciso che i mondi pre-1990 non ereditano i fatti moderni
(`hasModernReferenceFacts`, `country-facts.ts:718`). Coerenza qui significa una cosa sola,
verificabile:

> **Il dossier non deve affermare niente che l'anno e la nazione scelti rendano falso.**

Si rompe in tre domande, che sono anche l'ordine delle fasi:

1. **Le unità e le etichette di una cifra appartengono al suo mondo?** («mld USD» del 2026 in
   un mondo del 1815, «portaerei» in un mondo pre-industriale, «Consiglio dei ministri» in
   una monarchia assoluta.)
2. **Il nome, l'assetto e il territorio sono quelli della nazione scelta?** (Una provincia
   come nome del paese; la repubblica del 2026 come governo del 1815.)
3. **Dove l'anno manca al frontend, il dossier tace o dichiara — non indovina?** (Un dato
   che il client non ha non si stima: si presenta per quello che è, o non si presenta.)

---

## 3. Diagnosi A — l'anno

### 3.1 La valuta non è mai nominata, e quando c'è è il dollaro del 2026

Nel dossier compaiono **36 occorrenze di `currency: 'mld'` e una sola di `currency: '$'`**;
zero occorrenze di «dollari». Ogni importo si legge «12,40 mld» senza dire *di che cosa*.
L'unico simbolo di valuta in tutta l'interfaccia è `$`, sul PIL pro capite
(`NationDock.tsx:1064`).

Non è solo un'etichetta mancante: **l'unità è anacronistica per costruzione**. Il motore
calcola `account.nominalGdpUsdBillions` (dollari del 2026 per i mondi moderni, tabella
storica per gli altri) e poi `monthlyRevenue = nominalGdpUsdBillions × taxRate / 12`
(`WorldStateEngine.ts:218-245`). Quindi tesoreria, debito, entrate, uscite, saldo e prezzi di
mercato sono **grandezze in dollari del 2026** anche in una partita del 1815. Non è un difetto
da correggere nel frontend: è un fatto da **dichiarare**.

### 3.2 Il catalogo armamenti non conosce l'epoca, e il frontend non può filtrarlo da solo

`MilitaryService.ts:1248` mappa l'intero `EQUIPMENT_CATALOG` senza filtro d'epoca. Il dossier
lo rende con cinque domini scritti a mano (`NationDock.tsx:905`) e con `DOMAIN_LABELS`
(`NationDock/format.ts:46-47`) che comprende sempre «Missili» e «Droni». Un test del piano
precedente difende già i **pesi** di dominio come dati; il difetto qui è la **pertinenza**.

**Il motore pubblica le categorie pertinenti, ma non il criterio che le lega al catalogo.**
`arsenal.establishment` (`api.ts:201`) è costruito da `establishmentFor(epoch)` e pubblica, per
ogni categoria d'epoca, `category` (l'**id interno** della dottrina: `individualWeapons`,
`armoredMobility`, `artillery`, `supportWeapons`, `airSupport`, `navalSupport`), `label`
(«Armi individuali», «Mobilità corazzata»…), `demand`, `weight`, `basis`. Il predicato che
dice *quali voci di catalogo* ricadono in quella categoria — `match: { categories: [...],
domains: [...] }` (`MilitaryDoctrine.ts:308-341`) — **non esce dal motore**. Verificato: le
`label` dell'establishment («Armi individuali») non coincidono con le `category` del catalogo
(«Fanteria», «Corazzati», «Artiglieria»…), e la copertura pubblicata (`coverage[].items`)
elenca solo i pezzi **posseduti**, non l'insieme pertinente.

Conseguenza onesta: **il frontend non può filtrare il catalogo con i dati che riceve**, e non
deve inventare una tabella categoria→epoca nel client (sarebbe la seconda verità parallela che
N4 vieta). Il difetto visibile — le portaerei del 1815 presentate come scelte — si corregge
quindi **cambiando cosa il dossier presenta come autorevole**, non filtrando: N05 fa la parte
del frontend, e la filtrazione vera è una decisione di prodotto (§5, D-A).

### 3.3 Le conoscenze sono quelle del 2026

Le tecnologie sbloccabili nel dossier (17 voci, da `TECHNOLOGIES`, `MaterialEconomy.ts:65`)
includono «Intelligenza artificiale», «Missilistica avanzata», «Corazzati avanzati», ed è
mostrata la card «Tecnologie sbloccate» con la nota «accumula punti ricerca con università e
popolazione» (`NationDock.tsx:950-971`). In un mondo del 1815 l'elenco è un'anomalia visibile
e non filtrata.

### 3.4 L'epoca che il dossier conosce già

Il dossier riceve `arsenal.epoch` ed `epochLabel` dal motore (`api.ts:198-199`) e li mostra in
**tre** punti. È l'unica nozione d'epoca che arriva al client. **Non** riceve l'anno: il
payload della partita non porta `start_date`, e nessun modulo di presentazione — `economy`,
`resource`, `industry`, `military`, `nationDossier`, `governmentDossier` — ha un campo
temporale.

### 3.5 Date: due difetti di igiene, non di sostanza

Il confronto con «oggi» usa correttamente il calendario del mondo (`nationalSynthesis.ts:145`,
`:176`, `commitments.ts:50`). Restano due schegge:

- `GameScreen.tsx:332` — fallback `'1951-01-01'` nella barra: in uno scenario del 1815 o del
  2026, finché il gioco non pubblica la sua data, la HUD mostra **1 gennaio 1951**.
- Due `formatDate` concorrenti con fallback diversi (`. —` in `utils/format.ts:69`,
  «Data non pubblicata» in `NationDock/format.ts:15`), più un terzo parser con `new Date` UTC
  in `Landing.tsx:48`. Il dossier usa il secondo: coerente con sé stesso, incoerente col resto.

---

## 4. Diagnosi B — la nazione

### 4.1 Il titolo del dossier può essere il nome di una provincia

Già misurato al §1. Il campo `polityName` (`state.routes.ts:130-132`) prende il nome dal
registro **inglese** dei paesi quando la polity ha più di una regione, e altrimenti il nome
della **regione**. Conseguenze: sui mondi provinciali (1914, 1936, 2000, `pax_modern`) il
titolo è il nome inglese del registro — «Italy», «United States» — mai il nome curato dal
preset; su un mondo a regione unica il titolo è il nome della regione, corretto solo perché
in quei preset coincide col nome curato.

La conseguenza più grave è che il **motore ha già la catena giusta** (`publicPolityName`,
che applica il nome italiano curato e i nomi storici del preset) e la usa per cronaca,
diplomazia e prompt pubblici. Il dossier è l'unico punto che non la usa. C'è già una
divergenza interna provata: la stessa nazione si chiama «Italia» nella chat e «Italy» nel
dossier.

### 4.2 La forma di governo è del 2026, o è un default

Già misurato al §1. Si somma un default esplicito nel client:
`nationalContext.ts:83` restituisce **«Repubblica presidenziale»** a chiunque non sia in una
mappa di otto paesi scritta a mano nello stesso file (`:51-60`). È il caso peggiore della
famiglia: non un dato sbagliato, ma un dato **inventato dal client**.

### 4.3 Il dossier parla la lingua di un ministero del 2026

Titoli e voci che appartengono a un mondo amministrativo moderno e che il motore non
etichetta: «Consiglio dei ministri» (`NationDock.tsx:264`) mostrato anche a una monarchia
assoluta; «Nuova emissione» con durate 2/5/10/15/30 anni (`:477`); «Welfare», «Conti
pubblici», «Istruzione e ricerca» come leve di fazione (`governmentDossier.ts:38-45`);
«Province / Città e capitali» (`:718-721`). Sono etichette **del frontend**: il motore
pubblica i fatti (influenza delle fazioni, voci di bilancio, province) e il client li nomina.
Qui la coerenza si ottiene senza toccare il motore — ma richiede una decisione di vocabolario
(§7, N07).

### 4.4 Il vocabolario del motore non è una risorsa: è una fonte

Il motore pubblica già, e il frontend non usa:
`ideology` (dichiarato in `types/index.ts:60`, mai letto), `government` per polity nel conto
(`WorldStateEngine.ts:156`), `arsenal.establishment` (§3.2), `names` delle polity
(`api.ts:1565`), `epoch`/`epochLabel`. Ogni fase di questo piano preferisce queste fonti a una
seconda mappa scritta nel client: è la regola che ha già prodotto `polityDisplayNameIt` e
`getRelationshipNames` (appendice del piano precedente), e la stessa disciplina va tenuta qui.

---

## 5. Il confine del mandato: cosa il solo frontend **non** può fare

Onestà sui limiti, perché queste voci **non** sono fasi di questo piano e vanno decise come
tali.

**Il motore non pubblica la valuta d'epoca né un tasso di cambio.** Il frontend non può
convertire i dollari del 2026 in lire del 1815: non ha né deflatori né cambi, e **inventarli
sarebbe peggio del problema** (numeri falsi al posto di etichette imprecise). Perciò la fase
N03 non rinomina il denaro in moneta d'epoca: dichiara l'unità per quello che è.

**Se si vuole la moneta d'epoca** (lire, sterline, franchi, con i loro tagli) la risposta
corretta non è un'etichetta: servono scala dei prezzi, massa monetaria e conversione, cioè
**motore**. Va aperta come fase a sé, con l'autore, e questo piano non la presume. La fase N03
lascia il posto pronto: se un giorno il motore pubblicherà `currency` sul conto, il frontend
la leggerà da lì invece di dedurla.

**Il criterio di pertinenza dei domini** — quali categorie di equipaggiamento appartengono a
come si combatte in una data epoca — **non esce dal motore**. Il frontend può elencare i
domini che il motore pubblica, ma non può decidere che una portaerei non appartiene al 1815:
quella decisione vive in `MilitaryDoctrine.ts` (`ESTABLISHMENT_BY_EPOCH[].match`) e non è
serializzata. Filtrare nel client significherebbe ricopiare quella tabella — cioè una seconda
verità parallela. Va aperta come fase di motore (decisione D-A), non come lavoro di frontend.

**Il nome curato della nazione** è invece il caso che il frontend **può** risolvere da solo, con
dati già esposti (`GET /:id/relationships` → `names`, integrato da `GET /worlds/:id`): è per
questo che è la fase N01, la prima.

### Il registro delle decisioni di prodotto

Non sono fasi di questo piano: sono scelte che spettano all'autore, e ognuna ha la sua strada
già pronta.

| # | Decisione | Perché non è frontend | Strada pronta |
|---|---|---|---|
| **D-A** | Il catalogo armamenti deve escludere le categorie fuori epoca? | Il predicato `match` categoria→epoca non è pubblicato | Il motore aggiunge `match` a `establishment[]` (o filtra il `catalog` stesso); il frontend legge e non decide (N05) |
| **D-B** | Il denaro deve essere in moneta d'epoca? | Servono scala dei prezzi, massa monetaria e cambi: motore, non etichetta | N03 lascia il posto: se il conto pubblicherà `currency`, il frontend la legge da lì |
| **D-C** | Il dossier deve mostrare una forma di governo storica? | Serve un registro governo×anno | N04/N07 tolgono il default inventato; il registro è motore |
| **D-D** | «Consiglio dei ministri» resta o diventa un termine neutro? | Scelta di vocabolario, non di correttezza | N07 fa la sostituzione meccanica una volta decisa |
| **D-E** | Il catalogo tecnologie deve avere una pertinenza d'epoca? | Il motore non pubblica nessun legame tecnologia↔epoca | Il motore dichiara l'epoca minima di ogni tecnologia; N06 legge e non decide |

---

## 6. Invarianti obbligatorie (N1–N7)

**N1 — Una cifra dichiara la sua unità.** Nessun numero di denaro compare senza che l'unità
sia nominata **una volta per blocco** (nella `description` del blocco o in una `Footnote`),
non ripetuta 37 volte. Il rimando a un'unità è un'informazione, non decorazione.

**N2 — L'unità dichiarata è vera.** Ciò che il motore calcola in dollari del 2026 si dichiara
come **equivalente moderno**; non si rinomina in moneta d'epoca per sembrare storico. La
stima e la misura non si confondono.

**N3 — Nessuna schermata dichiara una pertinenza che non può provare.** Il dossier non presenta
il catalogo del motore come «la dottrina di questa nazione in quest'anno» quando il criterio
che lo legherebbe all'epoca non è pubblicato. Elenca ciò che il motore dichiara pertinente
(`establishment`) e dichiara il catalogo per quello che è. Ciò che l'epoca non prevede resta
raggiungibile (I6) ma non è presentato come la scelta del momento.

**N4 — Nessun'etichetta d'epoca o d'assetto scritta a mano nel client.** L'epoca viene da
`arsenal.epoch`; l'assetto dal conto. Se il motore non li pubblica per quella nazione, il
dossier **tace o dichiara l'assenza** — non ripiega su un default inventato.

**N5 — Il nome della nazione giocata è quello della nazione, non di una sua parte.** Nessun
titolo, riassunto o briefing ricava il nome del paese da una provincia o da un codice quando
la fonte autorevole è raggiungibile.

**N6 — L'anno entra nel dossier una volta e da una fonte sola.** Un unico punto di
derivazione (il read model di N02) fornisce l'anno ai moduli di presentazione. Nessuna
seconda lettura della data, nessun `new Date()` del browser.

**N7 — Nessun dato inventato per colmare un'assenza.** Dove il frontend non ha il dato
(governo d'epoca, moneta d'epoca), la regola è la stessa di D02: dichiarare, non stimare.

---

## 7. Le fasi

Otto fasi, in ordine di dipendenza. Ognuna è consegnabile da sola, con la sua PR e il suo
Quality Gate. **Vincolo globale: solo `frontend/`.** Ogni fase che scopre di aver bisogno di
un dato del motore si ferma e lo segnala (§5), non lo aggiunge.

### N01 — Il titolo del dossier è la nazione scelta (P0, indipendente)

**Cosa.** Risolvere il nome della nazione giocata con la fonte autorevole, senza toccare il
motore.

**Le fonti disponibili, misurate.** `GET /games/:id/relationships` risponde
`{ relationships, names }`: `names` è la mappa delle polity già usata da `DiplomacyPanel`
(`api.ts:1565`). È la fonte giusta, ed è **completa ma non esaustiva**: misurata sul database
reale, copre 111 politie su 112 (mondo provinciale `pax_modern`) e 37 su 40 (mondo `1951`).
Restano fuori le politie **senza alcuna relazione diplomatica** — `LKA` nel primo caso, `AUT`,
`CHE`, `KEN` nel secondo. Se il giocatore sceglie uno di quei paesi, `names` non ha la sua
voce: è il caso da coprire, non da ignorare.

**Criterio di decisione — catena a tre gradini, il primo che risponde vince.**

1. `relationships.names[polityId]` — la stessa catena di cronaca e diplomazia: coerenza
   interna garantita.
2. `GET /worlds/:id` → `regions[].name` della **regione capitale del giocatore** (o di una
   regione qualsiasi della polity, se la capitale non è nota). Attenzione misurata: questa
   rotta restituisce il nome grezzo della regione (`world.repository.ts:267`), quindi su un
   mondo provinciale dà «Alaska». Va usata solo dopo aver verificato che le regioni della
   polity **non** siano province, cioè quando i nomi delle regioni della polity sono uguali
   fra loro o uno solo.
3. L'**assenza dichiarata**. Mai un nome inglese del registro, mai un codice, mai il nome di
   una provincia.

**Attenzione.** Il terzo gradino si raggiunge in pratica solo con politie senza relazioni, e
solo se la capital region dà un nome di provincia: è il caso raro, ma è quello in cui un
ripiego sbagliato produce un nome **falso** invece di un nome **mancante**.

**Verifica.** Un test che, dato un mondo in cui le regioni del giocatore si chiamano `Alaska`,
`Texas`…, il titolo **non** sia «Alaska»; un test che con le relazioni disponibili il titolo sia
quello di `names`; un test che una polity senza voce in `names` produca un'assenza dichiarata e
non un codice; e un test-contratto che la mappa dei nomi nel client sia **una sola** (nessuna
seconda tabella di nomi).

**Perché per prima.** È l'unico difetto che rende il dossier **falso** su una nazione reale, è
indipendente da tutto il resto, e si chiude interamente nel frontend.

> **Consegnata** — `polityName.ts` (modulo puro) + 10 test in `polityName.test.ts`.
>
> La catena a tre gradini del piano si è ridotta a **un gradino**: misurando, il secondo
> (il nome della regione capitale, usato solo quando non è una provincia) si è rivelato
> **irrealizzabile** — `GET /worlds/:id` restituisce il nome grezzo della regione
> (`world.repository.ts:267`), quindi «non è una provincia» non è verificabile dal client senza
> una seconda euristica. La regola finale è una sola fonte: `relationships.names` del motore, e
> **assenza dichiarata** quando la voce manca (misurato: `LKA` su 112 politie nel mondo
> provinciale; `AUT`, `CHE`, `KEN` su 40 nel mondo 1951). Un nome mancante si corregge; un nome
> falso no.
>
> Effetto collaterale voluto: il `$` di `useNationSnapshot` ora **conserva** anche i `names`
> che prima scartava, e `DeskContent` mostra «Nome del paese non pubblicato» invece di «Nazione».
>
> Il test ha inoltre portato alla luce **due test esistenti che asserivano il difetto**:
> `nationalContext.test.ts` pretendeva che il nome venisse da `polityName` della regione, e che
> la forma di governo di GBR venisse da una mappa scritta a mano. Aggiornati al nuovo contratto,
> con il commento che spiega cosa asserivano prima e perché era sbagliato.

### N02 — L'anno della partita entra nel dossier (fondamenta di N03–N06)

**Cosa.** Un read model puro `worldEpoch(today)` (nome indicativo) che dalla data del mondo
ricava l'anno e l'epoca, secondo le **stesse soglie del motore** (1861/1919/1946/1990), e che
il dossier riceve una volta sola. La data è già nel dossier (`today`, `NationDock.tsx:88`): non
serve nessuna chiamata nuova per le fasi N05–N07. Solo N03/N04 beneficiano del `startDate` di
`GET /worlds/:id`, se disponibile.

**Attenzione.** Le soglie sono **copiate** dal motore (che non le esporta al client): il test
deve dichiararlo, così una futura divergenza è visibile invece che silenziosa.

**Verifica.** Test che la funzione è pura, che le soglie coincidono con quelle del motore sui
casi `1815 / 1914 / 1939 / 1951 / 2026`, e che una data illeggibile **non** produce
silenziosamente «guerra fredda» (il default del motore) ma un'assenza dichiarata.

> **Consegnata** — `worldEpoch.ts` + 8 test in `worldEpoch.test.ts`. Il test **dichiara in una
> costante** le soglie del motore (`MOTOR_BOUNDARIES`) e le confronta: se un giorno il motore le
> cambia, il test lo dice invece di restare zitto.
>
> Prima riga del dossier in cui l'anno del mondo compare come informazione: la card
> `StrategicBriefingCard` aveva una prop `context` («esempio: Italia — 14 marzo 1951») che il
> dossier **non ha mai passato**. Ora la passa, e legge da `epochView`. Una prop già prevista e
> mai usata è, di per sé, la prova che il contesto mancava.

### N03 — Ogni cifra dice di che unità è

**Cosa.** Introdurre l'unità nel read model e applicarla a tutti i punti che formattano
denaro nel dossier (36 `mld` + 1 `$`), con la distinzione obbligatoria di N2:

- le grandezze di conto (`money`, `debt`, entrate, uscite, saldo, credito, interessi, prezzi di
  mercato) sono in **unità di conto del gioco**, dichiarata una volta per blocco;
- le grandezze che il motore stima in dollari di oggi (`nominalGdpUsdBillions`,
  `gdpPerCapitaUsd`) si dichiarano **equivalente moderno** e **perdono il simbolo `$`**.

**Attenzione.** Vale la disciplina di I2/D02: nessun numero nudo. E la coerenza interna del
dossier: oggi lo stesso tipo di cifra è «mld» in un punto e «$» in un altro.

**Verifica.** Un test-contratto (stesso pattern di `nationDockSingleSource.test.ts`, lettura
del sorgente con `fs`) che fallisca su qualunque denaro formattato senza unità dichiarata e su
qualunque `currency: '$'` residuo; più la guardia contro il falso verde.

> **Consegnate** — `MONEY_UNIT` / `money()` / `index()` in `NationDock/format.ts` + 8 test in
> `moneyUnit.test.ts`. Le **36 copie** della stringa `'mld'` sono scese a **una** costante, e
> i punti che non erano denaro (pesi di dominio, quote dell'arsenale, indici di forza,
> moltiplicatori) sono passati a `index()`, che non aggiunge valuta: prima erano `formatMoney`
> senza valuta, cioè una funzione di denaro usata per numeri che denaro non sono.
>
> L'unità si dichiara **una volta per blocco**, nella `description`, con `MONEY_UNIT_NOTE` — 7
> blocchi. Il simbolo `$` è sparito: il PIL pro capite ora si legge «36.000» con
> «in dollari di oggi (stima del motore)» nel rapporto, invece di sembrare la moneta del paese.

### N04 — Il confine del denaro è dichiarato dove serve

**Cosa.** Dove il dossier presenta il PIL e il tenore di vita — le uniche cifre che il motore
dichiara in dollari correnti — dirlo, con una riga che l'autore possa approvare. Non una card
didattica (D07 lo vieta), ma il rapporto che accompagna la cifra (I2).

**Verifica.** Ricerca nel codice: nessuna card nuova; il testo di confine vive in una `hint` o
in una `Footnote`.

> **Consegnata** insieme a N03, nello stesso test-contratto. Il confine vive in una `hint`,
> come previsto: nessuna card didattica aggiunta (D07 resta rispettato).

### N05 — L'epoca militare dice cosa l'epoca prevede (la parte che il frontend può fare)

**Cosa.** Il dossier smette di **affermare** che il catalogo è la dottrina di quella nazione in
quell'anno. In concreto, tre mosse tutte interne al frontend:

1. La lista dei domini (`NationDock.tsx:905`) e le etichette (`DOMAIN_LABELS`) non si scrivono
   più a mano: derivano da `arsenal.domains`, già pubblicato con `label`.
2. La card «Produzione e acquisti» **dichiara** il proprio quadro: «catalogo completo del
   motore — cosa l'epoca prevede: …» con le categorie dell'`establishment` pubblicato, che
   portano già l'etichetta italiana e la motivazione (`basis`).
3. Ciò che l'epoca non prevede smette di essere presentato come **consigliato**: il blocco
   resta raggiungibile (I6: nessuna metrica perduta), ma non è la prima cosa che si legge.

**Attenzione — il limite, dichiarato.** Non elencare come *pertinente* ciò che non lo è è una
**decisione di motore** (§5, D-A): il predicato che lega categoria ed epoca non è pubblicato, e
il frontend non lo reinventa. N05 non filtra: toglie l'affermazione falsa e mette accanto
quella vera.

**Verifica.** Un test che, con `epoch = pre_industriale`, il dossier **non** presenti il
catalogo come «la dottrina d'epoca» e che le categorie mostrate siano quelle
dell'`establishment`; e uno che con l'epoca moderna l'elenco resti intero (guardia contro il
falso verde: la dichiarazione non deve svuotare la schermata). Un test-contratto sul sorgente
verifica che i domini non siano più una lista scritta a mano.

> **Consegnata** — `militaryDoctrine.ts` + 6 test in `militaryDoctrine.test.ts`.
> La lista `['terra','aria','mare','missili','droni']` scritta nel componente **è sparita**: i
> domini vengono da `arms.domains`, con le etichette del motore. La card dichiara «Catalogo
> completo del motore … L'epoca prevede: …», con le categorie e la motivazione
> dell'`establishment`.
>
> Un test difende il **confine**: `militaryDoctrine.ts` non deve contenere nomi di categorie del
> catalogo («Fanteria», «Corazzati»…). Se qualcuno, in futuro, prova a filtrare nel client
> ricopiando la tabella del motore, quel test lo intercetta.

### N06 — Le conoscenze dichiarano la loro epoca

**Cosa.** La sezione Conoscenze mostra le tecnologie del catalogo del motore (17 voci, da
«Agricoltura meccanizzata» a «Intelligenza artificiale») presentandole come le conoscenze di
quella nazione in quell'anno. Il motore **non pubblica** alcuna pertinenza d'epoca delle
tecnologie, quindi il frontend non può filtrare (stessa famiglia di D-A): può solo
**dichiarare** che l'elenco è il catalogo completo del motore, e dove il motore dichiara
ricerche e sblocchi, limitarsi a quelli.

**Attenzione.** Qui la disciplina di N7 è al suo caso puro: l'assenza non si colma, si dichiara.
Nessuna tabella tecnologia→epoca nel client.

**Verifica.** Un test che la card non presenti l'elenco come sbloccato da quella nazione quando
il motore non lo dichiara; e uno che le tecnologie che il motore **dichiara** sbloccate restino
visibili (guardia contro il falso verde).

> **Consegnata**, con una **smentita della diagnosi** che vale la pena registrare. Il piano
> diceva: «la sezione Conoscenze mostra le tecnologie del catalogo, non quelle della nazione».
> Misurando: la lista è `resources.technologies.map(...)`, cioè **già** le tecnologie che il
> motore pubblica come sbloccate — il catalogo non è nemmeno pubblicato al client. Il difetto
> reale era **nel testo della fonte**: la `Footnote` diceva «Catalogo tecnologie del motore»
> sopra un elenco che catalogo non era. Corretto in «tecnologie che il motore pubblica come
> sbloccate».
>
> Resta vero, ed è ora dichiarato nel dossier, che **il motore non ha un'epoca delle tecnologie**:
> in uno scenario del 1815 alcune voci possono appartenere a secoli successivi. Il dossier lo
> dice invece di far finta (N3/N7). Il filtro vero è D-E.

### N07 — Il vocabolario del dossier appartiene all'assetto, non al 2026

**Cosa.** Due mosse, entrambe nel frontend.

1. **Togliere il default inventato** («Repubblica presidenziale», `nationalContext.ts:83`) e la
   mappa di otto paesi (`:51-60`) che lo alimenta. Quando il conto non dichiara l'assetto, il
   dossier **dichiara l'assenza** (N4/N7) invece di mostrare una repubblica presidenziale.
2. **Neutralizzare le etichette moderne** scritte a mano, dove il motore non ne pubblica una
   d'epoca: «Consiglio dei ministri» (`NationDock.tsx:264`), «Nuova emissione» con durate
   2/5/10/15/30 anni (`:477`), le leve delle fazioni (`governmentDossier.ts:38-45`), «Province /
   Città e capitali» (`:718-721`). L'obiettivo non è l'arcaismo: è non affermare un'istituzione
   che in quel mondo non esiste.

**Attenzione.** La mossa 2 è una **decisione di vocabolario** da confermare con l'autore (§5,
D-D): «Consiglio dei ministri» è evocativo e il gioco potrebbe volerlo tenere. Il criterio è
N3/N4, non il gusto. La mossa 1 non è negoziabile: un default inventato è un difetto di
correttezza, non di stile.

**Verifica.** Un test che con un conto senza `government` il dossier non mostri mai «Repubblica
presidenziale»; un test-contratto che `GOVERNMENT_TYPES` non esista più nel client; e un test
che le etichette sostituite appartengano a un insieme dichiarato di termini neutri.

> **Parzialmente consegnata.** La **mossa 1** (non negoziabile) è stata fatta dentro **N01**, che
> toccava già lo stesso file: `GOVERNMENT_TYPES` e il default «Repubblica presidenziale» **non
> esistono più** nel client, e due test lo difendono (`polityName.test.ts` e
> `nationalContext.test.ts` aggiornato). Un conto senza `government` produce `governmentType === ''`
> e il dossier dichiara l'assenza.
>
> La **mossa 2** (il vocabolario) **resta da fare**: attende **D-D**. «Consiglio dei ministri» è
> ancora nel dossier, com'è giusto che sia finché l'autore non decide.

### N08 — Igiene delle date (indipendente, chiude il piano)

**Cosa.** Eliminare il fallback `'1951-01-01'` (`GameScreen.tsx:332`) in favore di una data
**assente dichiarata**; unificare i due `formatDate` del dossier in un'unica funzione, così
che il fallback sia uno solo e coerente.

**Verifica.** Test che una partita senza data non mostri mai 1951, e che `formatDate` abbia una
sola implementazione raggiungibile dal dossier.

> **Consegnata** — 6 test in `worldDateHygiene.test.ts`. La regola della data breve ora esiste
> **una volta sola** (`formatDateOr` in `utils/format.ts`) e il fallback è un **parametro**:
> il Dossier dice «Data non pubblicata», la HUD dice «—». Due copie identiche divergono, come
> è già successo con i due `formatDate`.
>
> Nella HUD il fallback non è solo rimosso: la timeline ora dice «Data del mondo non ancora
> pubblicata» invece di mostrare una data che non esiste. Il resto (lo `startDate` di
> `useWorldAdvance`, un default di `periodStart` in una voce di cronaca) **non** è una data
> mostrata come «adesso» ed è rimasto com'era: il test lo distingue, invece di vietare la
> stringa in tutto il repository.

---

## 8. Criteri di completamento e verifica

Il piano è completo quando, **contemporaneamente**:

| # | Criterio | Prova |
|---|---|---|
| K1 | Il titolo del dossier è il nome della nazione scelta su ogni tipo di mondo (nazionale e provinciale) | test di N01 |
| K2 | Nessun denaro è formattato senza unità dichiarata; nessun `$` residuo | test di N03 |
| K3 | L'anno è derivato in un punto solo, con le soglie del motore | test di N02 |
| K4 | Il dossier non dichiara pertinente ciò che non può provare; dichiara il catalogo per quello che è | test di N05 |
| K5 | Nessuna etichetta d'epoca o d'assetto scritta a mano nel client | ricerca nel codice + test di N07 |
| K6 | Nessuna partita senza data mostra una data del 1951 | test di N08 |
| K7 | Nessuna metrica perduta rispetto a oggi (I6 del piano precedente) | confronto fra l'elenco di D01 e quello a fine N05–N07 |
| K8 | `tsc` pulito, build verde, Quality Gate verde | CI |
| K9 | Le suite a11y e mobile restano verdi | `npm run test:a11y`, `hudMobileLayout` |
| K10 | **Nessuna riga del motore modificata** | `git diff --stat` limitato a `frontend/` |

**Ordine di consegna.** N01 è P0 e indipendente: si fa subito. N02 è la fondazione di N03–N07
e va in una PR sola con N03 (un'unità dichiarata senza l'anno è muta, e l'anno senza unità non
si vede). N04, N05, N06, N07 sono indipendenti e a basso rischio. N08 chiude.

**Riepilogo: cosa si consegna e cosa si decide.**

### Stato della verifica (al 2026-09-25)

| Prova | Esito |
|---|---|
| `tsc --noEmit` | pulito |
| Test frontend (88 file, 742 test) | **tutti verdi**, a blocchi (la suite intera in una chiamata eccede il limite di tempo della macchina di sviluppo usata per il lavoro; i blocchi coprono l'insieme) |
| `vite build` | verde |
| Nuovi test | **40** in 5 file nuovi (`polityName` 10, `worldEpoch` 8, `moneyUnit` 8, `militaryDoctrine` 8, `worldDateHygiene` 6) |
| Test esistenti aggiornati | 3 (`nationalContext.test.ts` × 2 casi, `compactBriefingUi.test.ts` × 1) — tutti asserivano un comportamento che la fase rimuove |
| `git diff --stat backend-nest/` | **vuoto**: nessuna riga del motore modificata (K10) |
| E2E Playwright | **non eseguibili in questa macchina**: mancano le librerie di sistema del browser (`libXdamage.so.1`) e l'installazione richiede root. Vanno rilanciati `npm run test:e2e:mock` e `npm run test:a11y` in CI. |
| Deploy del Worker | **fatto**: `frontend/dist` pubblicato, `index-_bbFJl_G.js`. Le correzioni sono **vive online** (verificate sul bundle servito dal sito), i difetti rimossi non compaiono più, `api/health` risponde 200. |

### Il deploy: cosa è stato pubblicato e cosa no

Il sito `https://world-story.bovel-cannas.workers.dev` è servito in due parti, e la distinzione
conta:

- **La UI viene dal bundle del Worker**, non dal backend locale. Verificato: il `GET /` serviva
  `index-DVAVxKeL.js` — il bundle di **D01–D07**, cioè le correzioni di questo piano **assenti**
  — e ora serve `index-_bbFJl_G.js`, con N01–N08 dentro. Le modifiche puramente frontend sono
  quindi **online**.
- **Le API vengono dal backend locale**, esposto via Quick Tunnel. Il Worker non è cambiato
  (`worker.js` intatto) e il KV `backend_url` punta al tunnel vivo già esistente: **nessuna
  azione necessaria**, e nessuna azione utile — il backend non è stato toccato da questo piano.

**Perché non lo script `scripts/deploy-cloudflare.sh`.** Quello script fa anche `npm run build`
del backend e `launchctl kickstart -k com.openpax.backend`: entrambe operazioni su processi
launchd di macOS, impossibili da qui — e **inutili**, perché il mandato era «solo frontend». Il
deploy è stato quindi il **solo passo che serviva**: `npx wrangler deploy`, con le credenziali
della skill `cloudflare-ops`. Il backend locale continua a girare con il suo codice, che è
identico a prima.

**Cosa resta da fare a te, su macOS** (una riga, quando vuoi): `bash scripts/deploy-cloudflare.sh`
esegue il giro completo compreso backend e KV. Non è necessario ora; serve se un giorno tocchi il
motore.

**Regressioni intercettate e riparate durante la verifica** (le registra perché sono la prova che
i test servono): `nationalOperatingPicture.test.ts` ha colto un «+24 mld» comparso sul PIL — la
conversione meccanica aveva portato una chiamata **senza segno** dentro un helper che il segno lo
aggiunge. Corretto distinguendo `money` (con segno: saldi e variazioni) da `level` (senza segno:
livelli come PIL e debito). E `compactBriefingUi.test.ts` ha colto che la card del briefing non
era più su una riga sola: la verifica ora controlla l'invariante (una card, stesso briefing,
nessuna ri-derivazione) invece della forma del montaggio.

| Fase | Natura | Dipende da |
|---|---|---|
| N01 nome della nazione | frontend, difetto **falso** oggi | — |
| N02 anno nel dossier | frontend, read model puro | — |
| N03 unità dichiarata | frontend | N02 |
| N04 confine del denaro | frontend, testo | N02, N03 |
| N05 dottrina d'epoca | frontend (dichiarazione) | N02 |
| N06 conoscenze | frontend (dichiarazione) | N02 |
| N07 vocabolario | frontend, dopo D-D | — |
| N08 igiene date | frontend | — |
| D-A filtro catalogo | **decisione di motore** | — |
| D-B moneta d'epoca | **decisione di motore** | D-A |
| D-C governo storico | **decisione di motore** | — |
| D-D vocabolario «ministri» | **decisione di prodotto** | abilita N07 |
| D-E epoca delle tecnologie | **decisione di motore** | — |

---

## 9. Cosa NON fare

**Non rinominare il denaro in moneta d'epoca.** I numeri sono in una scala moderna: chiamarli
«lire» li farebbe mentire in un modo nuovo. Se la moneta d'epoca serve davvero, è una fase di
motore (§5), non un'etichetta.

**Non aggiungere una mappa di nomi, governi o epoche nel client.** È il meccanismo che ha
prodotto `GOVERNMENT_TYPES` (`nationalContext.ts:51`) e `publicNarrative` (§4.4): due verità
parallele che divergono. Il motore pubblica; il client legge.

**Non inventare un default quando l'anno manca.** Il default «Repubblica presidenziale» e il
fallback «1951-01-01» sono la stessa famiglia di difetto di D02: una cifra nuda, un nome
inventato. Si dichiara l'assenza.

**Non toccare il motore per far tornare il dossier.** Vale la regola del piano precedente, e
in questo mandato è un vincolo dichiarato: se una fase sembra richiedere un dato nuovo, il
progetto della fase è sbagliato, oppure la fase è una decisione di prodotto da discutere a
parte (§5). N05 è l'esempio da tenere a mente: il filtro del catalogo sembrava frontend e non
lo è. La risposta corretta era **cambiare l'affermazione**, non allargare il mandato.

**Non rompere le fasi D01–D07.** Le invarianti consegnate (una cifra un posto; ogni cifra un
giudizio; la sintesi davanti al dettaglio; una sola lista; nessun blocco interattivo chiuso in
un richiudibile) restano contratti. Il filtro d'epoca di N05 **non** può far sparire
metriche: le sposta o le dichiara.

---

## Appendice — il criterio che ha guidato la diagnosi

Come nel piano precedente, ogni voce è stata trovata **misurando**: eseguendo `governmentForPolity`
e `epochForDate` sulle politie del 1815; eseguendo `establishmentFor` contro il catalogo reale
(31 su 31 fuori epoca); interrogando `world_regions` del database di una partita provinciale per
vedere che `name` è una provincia. Le voci che una lettura del codice suggeriva ma la misura non
ha confermato — per esempio che `state.routes.ts` sbagli sempre il nome — **non** sono nel piano
con quel peso: il difetto è reale sui mondi provinciali e sui preset con nomi curati divergenti,
non su tutti i mondi. Vale la stessa disciplina per chi eseguirà le fasi: la verifica di §8 è una
misura, non un'impressione.
