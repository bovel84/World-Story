# Esempio — i filoni nel Millennium Dawn (2000)

> **Cos'è questo documento.** Un esempio **di progetto**, non l'output di una partita reale
> (questa sandbox non lancia l'LLM). I nomi delle province e delle polity sono **reali**, presi
> dalla mappa `pax_modern_provinces` che il Millennium usa come base. Le risposte del Consulente e
> del ministro sono **illustrative**, scritte per mostrare la forma — non sono generazioni del
> modello. Serve a far vedere *cosa cambierebbe*, prima di scrivere il codice.

---

## 0. Com'è oggi (il vuoto)

Apri **Millennium Dawn — 2000**. Scegli **Israele** e premi «inizia».

Il Consulente si apre e ti parla del tuo paese: cassa e saldo, copertura alimentare, prontezza dei
reparti, opere in ritardo. Non ti dice **una parola** su Hamas, su Gerusalemme, sul negoziato
bloccato. Non perché non lo sappia — il modello conosce benissimo il 2000 — ma perché nel percorso
del Consulente:

- vede solo il **tuo** snapshot (le tue cifre, le tue relazioni, i tuoi fronti);
- il testo del preset (`base_prompt`) gli entra come «**scenario, non inventario corrente**» e la
  policy gli vieta di usarlo come fatto;
- non esiste da nessuna parte un posto dove sia scritto *«nel 2000 c'è il disarmo di Hamas da
  risolvere, e Gerusalemme è il nodo»*.

Risultato: il mondo è vivo nei **numeri** e muto nella **storia**. È esattamente quello che hai
descritto.

---

## 1. Il file — `backend-nest/data/presets/millennium_dawn/storylines.json`

Cinque filoni reali del gennaio 2000, scritti una volta. (`PSE`, `ISR`, `EGY`, `JOR` sono **id di
mappa**: esistono nella mappa base anche se non sono nel catalogo `simulation/` del preset.)

```jsonc
{
  "version": 1,
  "as_of": "2000-01-01",
  "storylines": [
    {
      "id": "levante-disarmo-hamas",
      "title": "Il disarmo di Hamas",
      "domain": "esteri",
      "parties": ["ISR", "PSE", "USA", "EGY"],
      "region": "Levante",
      "state": "aperto",
      "pressure": 3,
      "summary": "Israele e gli Stati Uniti premono per il disarmo delle milizie; l'Autorità
                  Palestinese è divisa tra negoziato e seconda intifada; l'Egitto media.",
      "triggers": [
        "attentato o raid su una provincia contesa",
        "pressione diplomatica USA sull'ANP",
        "apertura o rottura di un negoziato"
      ]
    },
    {
      "id": "gerusalemme-statuto",
      "title": "Lo statuto di Gerusalemme",
      "domain": "esteri",
      "parties": ["ISR", "PSE", "JOR", "SAU"],
      "region": "Gerusalemme",
      "state": "aperto",
      "pressure": 3,
      "summary": "La sovranità sulla città è contesa e simbolica per tre fedi; ogni mossa su
                  Gerusalemme muove l'intero mondo arabo e musulmano.",
      "triggers": [
        "dichiarazione sulla sovranità della città",
        "incidente sui luoghi santi",
        "vertici arabi o dell'OUA"
      ]
    },
    {
      "id": "iraq-ispezioni-onu",
      "title": "Le ispezioni in Iraq",
      "domain": "esteri",
      "parties": ["IRQ", "USA", "GBR", "RUS", "FRA"],
      "region": "Mesopotamia",
      "state": "aperto",
      "pressure": 3,
      "summary": "Il regime di Baghdad sfida le risoluzioni ONU sulle armi; Washington inasprisce
                  la pressione, Mosca e Parigi frenano. È il filo che porterà alla guerra.",
      "triggers": [
        "rapporto degli ispettori rifiutato",
        "sanzioni inasprite",
        "richiesta di una nuova risoluzione"
      ]
    },
    {
      "id": "cecenia-seconda-guerra",
      "title": "La Cecenia",
      "domain": "guerra",
      "parties": ["RUS"],
      "region": "Caucaso settentrionale",
      "state": "aperto",
      "pressure": 2,
      "summary": "Mosca combatte la seconda guerra in Cecenia contro la resistenza separatista;
                  pesa la condanna internazionale e il costo umano e militare.",
      "triggers": [
        "atto di guerriglia o attentato",
        "operazione di rastrellamento",
        "denuncia internazionale"
      ]
    },
    {
      "id": "balcani-coda-kosovo",
      "title": "La coda del Kosovo",
      "domain": "esteri",
      "parties": ["SRB", "USA", "RUS"],
      "region": "Balcani",
      "state": "congelato",
      "pressure": 2,
      "summary": "Dopo la guerra del 1999 il Kosovo resta conteso sotto protettorato ONU; Belgrado
                  non riconosce la perdita, la comunità serba locale è esposta.",
      "triggers": [
        "scontri interetnici",
        "elezioni o passi verso l'indipendenza",
        "cambio di governo a Belgrado"
      ]
    }
  ]
}
```

**Qui la Palestina c'è**, e non perché sia giocabile: i filoni nominano le polity per **id di
mappa**, e `PSE` (32 province, da Rafah a *Jerusalem*) e `ISR` (24 province, da Beersheba a
Dimona) esistono nell'ambiente. Il preset resta **identico per tutti**, com'è giusto.

---

## 2. Stesso preset, partite diverse

Il file è uno. Ma tu scegli la nazione, e **ogni partita ha la sua storia**: i filoni ci sono
sempre, cambia **se ti riguardano**.

### 2-bis. E se giochi una nazione che il preset non nomina?

Ecco il punto dell'autore: *«è impossibile che io scriva la storia di tutte le nazioni»*. Il file
qui sopra nomina i filoni **regionali** (Israele, Palestina, USA…). Ma se scegli **l'Italia**, o
il **Brasile**, o la **Nigeria** — nazioni che il `storylines.json` non cita — **la tua storia c'è
lo stesso**. Non la scrive l'autore: la genera l'IA dalla propria conoscenza storica, esattamente
come fa già oggi la `HistoricalBaseline` (`getPolityHistoricalBaseline`, che conosce **qualunque**
polity a prescindere dal preset).

Quindi per **qualunque** nazione scegli, il Consulente all'apertura sa due cose:

1. **come è arrivata al 2000** (la baseline storica, che già esiste);
2. **cosa affronta nel 2000** — la sua **situazione iniziale** (H06): per l'Italia, la
   transizione alla seconda Repubblica, il centrosinistra, l'euro in arrivo; per il Brasile, la
   crisi valutaria del 1999 e il governo Cardoso.

Regola: **sui nodi che il preset ha fissato** (il Levante, l'Iraq) la situazione iniziale
**segue** il filone e non lo contraddice. **Fuori da quei nodi**, l'IA è libera. Così il preset
**copre una parte** e l'IA copre il resto — che è la divisione richiesta.

| | **Giochi ISRAELE** | **Giochi gli USA** | **Giochi l'ITALIA** | **Giochi il BRASILE** |
|---|---|---|---|---|
| Filoni del preset | lo riguardano | lo riguardano | **contesto** | **contesto** |
| Situazione iniziale (IA) | seconda intifada, coalizione | era Clinton, surplus | Seconda Repubblica, euro in arrivo | crisi del 1999, Cardoso |

*(esempio illustrativo)*

| | **Giochi ISRAELE** | **Giochi gli USA** | **Giochi l'ITALIA** |
|---|---|---|---|
| Disarmo di Hamas | un filone che **decidi tu** — proposta → bozza → firma | ti riguarda da mediatore: pressione sull'ANP | **contesto**: «il Levante è in tensione», nessuna decisione tua |
| Gerusalemme | il nodo della tua politica interna | dossier sulla stabilità regionale | **contesto** |
| Iraq ispezioni | ti tocca di rimbalzo | **decidi tu** e trascini gli alleati | alleato: puoi schierarti o restare fuori |
| Cecenia | **contesto** | ti riguarda per il disarmo e i rapporti con Mosca | **contesto** (ma contano le forniture energetiche) |

Questo è il cuore di «il preset è identico per tutti, ma ogni partita ha la sua storia»: il filone
esiste **in sé**, e il giocatore lo **subisce** o lo **guida** a seconda di chi è — **mai** è
disegnato *attorno* al giocatore.

---

## 3. La linea del tempo — cosa succede turno dopo turno (giochi Israele)

### Turno 1 — la semina
Quando parte la partita, i cinque filoni diventano **obiettivi del mondo di quella partita**
(nessuna condivisione con altre partite). Il Consulente si apre così:

> *«Presidente, il paese entra nel nuovo millennio con due fronti aperti che pesano più del
> bilancio. Il primo è in casa: l'Autorità Palestinese vive la seconda intifada, e Washington e il
> Cairo premono perché il governo israeliano trovi una via sul disarmo delle milizie. Il secondo è
> la città: Gerusalemme resta contesa nel simbolo e nella sovranità, e ogni mossa lì muove il
> mondo arabo. Sul tavolo anche il caso iracheno — Baghdad sfida le ispezioni ONU e l'America
> inasprisce — e il Caucaso, dove Mosca combatte in Cecenia. Sul piano materiale [segue il tuo
> dossier: cassa, scorte, reparti].»*
>
> **Situazione sul tavolo:** Il disarmo di Hamas (Urgente) · Lo statuto di Gerusalemme (Urgente)
> · Le ispezioni in Iraq (Da seguire) · La Cecenia (Da seguire)
>
> **Proposta di atto** — *«Aprire un canale negoziale mediato»*: autorizza l'Egitto a mediare un
> cessate-il-fuoco graduale con l'ANP; costi e copertura da verificare con Esteri e Tesoro.
> · **Approfondisci →** · **Porta al Consiglio →**

*(esempio illustrativo)*

### Turno 2 — un trigger scatta
Passi il tempo. Un evento del turno tocca la città: scatta il trigger *«incidente sui luoghi
santi»*. Il motore fa **avanzare il filone** «Statuto di Gerusalemme» (non il testo del modello:
l'obiettivo del mondo è suo) e ne pubblica il **delta** alla narrazione. Nella **cronaca** del
turno appare, in mezzo alle tue notizie:

> **2000-03-14 — Gerusalemme** — «Scontri a Gerusalemme est dopo una provocazione sui luoghi
> santi: la polizia israeliana interviene, l'ANP denuncia, la Lega Araba convoca una riunione
> d'emergenza.» *(esempio illustrativo)*

Il testo è del modello; **il fatto** (il filone è avanzato, il mondo arabo è stato toccato) viene
dal motore. La differenza è tutta qui.

### Turno 3 — il Consulente propone *dal* filone
Il Consulente non ti ripropone gli stessi problemi: sa che Gerusalemme è avanzata, e propone
un atto **agganciato a quel filone**:

> *«Presidente, gli scontri di marzo hanno spostato l'asse: il negoziato sul disarmo non parte
> finché la città resta incandescente. Due strade: (a) congelare il dossier di Gerusalemme e
> comprare tempo col negoziato mediato — rischia di sembrare debolezza davanti agli alleati
> arabi; (b) un gesto limitato sui luoghi santi per riaprire il canale con l'ANP — ti costa
> consenso interno.»*
>
> **Proposta di atto** — *«Congelare il dossier di Gerusalemme»*: sospendi per due trimestri ogni
> atto sulla sovranità e apri il negoziato mediato dall'Egitto. · **Porta al Consiglio →**

*(esempio illustrativo)*

### Turno 4 — dalla proposta al fatto
Firmi la bozza. L'atto entra nel **registro** («firmato, in attesa di esecuzione»), poi al
passaggio del tempo il motore lo esegue **se ha i numeri per farlo** — e qui sta il vincolo
onesto del §5. Se l'atto è una mossa diplomatica, il filone registra la **svolta**; se l'atto
chiede una mutazione materiale (un embargo *applicato*, un dispiegamento), serve il catalogo, e
oggi `ISR`/`PSE` **non ce l'hanno**.

### 3-bis. Il futuro — dove il mondo *stava andando* (e come lo devi)

Qui c'è il pezzo che hai descritto: **passato, presente e futuro**. Il passato (come Israele è
arrivata al 2000) e il presente (cosa affronta) li abbiamo visti. Il **futuro** è la terza cosa, e
funziona così — è il modello di Pax:

> Ogni polity **tranne** quella del giocatore si comporta **storicamente** e persegue i suoi
> obiettivi storici. In reazione alle azioni del giocatore, può comportarsi **a-storicamente**.
> (`forward.txt:92-94`)

Tradotto nel Millennium: ogni filone ha una **traiettoria di default** — dove **andava** se
nessuno lo deviava. Nel file, il campo `trajectory` del disarmo di Hamas dice proprio questo: *«se
nessuno lo devia, il nodo scivola verso lo scontro aperto entro l'anno»*. Poi:

| Chi | Cosa fa col futuro |
|---|---|
| **Gli NPC del mondo** (Israele, la Palestina, gli USA se non giochi loro) | **seguono la traiettoria** — il mondo «va avanti da solo» in modo riconoscibile |
| **Tu** (la nazione che giochi) | **la devii**: la tua scelta cambia il corso, e il mondo **reagisce** alla deviazione |
| **La partita** | **sostituisce** la traiettoria man mano che il tempo avanza: dopo anni, conta solo la tua storia |

**Le tre regole che rendono il futuro sicuro** (e che vanno difese con test):

1. **Non è una profezia.** Il Consulente ti dice *«la regione sta scivolando verso lo scontro»*,
   **mai** *«nel settembre 2001 succederà X»*. Il futuro è una **tendenza**, non un fatto
   raccontato. (Il codice oggi vieta i fatti futuri — giustamente — e va reso esplicito che la
   *traiettoria* non è un fatto: H06.)
2. **Non gioca al posto tuo.** Se giochi Israele, il motore **non** fa accadere a Israele ciò che
   la storia reale le attribuisce. La traiettoria muove **gli altri**; tu muovi te stesso. (Pax lo
   dice esplicito, `forward.txt:47`.)
3. **La tua storia vince.** Appena devii, la traiettoria di quel nodo **non vale più**: il
   disarmo di Hamas non «scivola verso lo scontro» se tu hai firmato il negoziato. La deviazione —
   *atteso vs accaduto* — **è** la storia della partita.

Quindi la differenza tra «deterministico» (quello che non ti piace) e «vivo» non è che il secondo
non conosce il futuro: è che il primo **sa solo i tuoi numeri**, il secondo **conosce tre tempi e
ti lascia riscriverne il terzo**.

*(esempio illustrativo)*

---

## 4. Le superfici

- **Consulente** — card delle situazioni (titolo, sintesi, «Approfondisci»), e **proposte con
  opzioni** come le «Topics of Concern» di Pax (`actions.txt`: 2–5 azioni concrete). Oggi il
  Consulente propone solo «discussioni»: qui compare il **menu**.
- **Governo** — la sedia **Esteri** parla del Levante (il filone ha un `domain`, quindi arriva al
  ministro giusto); la sedia **Guerra** parla della Cecenia.
- **Cronaca / Timeline** — gli eventi del mondo (il delta dei filoni) entrano dove oggi entrano le
  tue notizie, ma con la loro provenienza dichiarata: sono **del mondo**, non tue.

---

## 5. I limiti onesti (da non nascondere)

**Raccontare ≠ applicare.** Il filone dà **significato e trigger**, mai numeri (invariante H-I1).
Questo è voluto, e ha una conseguenza concreta che la misura ha rivelato: nel Millennium il
catalogo `simulation/` copre **14 potenze** (USA, RUS, CHN, IRN, DEU…). **`ISR`, `PSE`, `EGY`,
`JOR` non ci sono**: esistono sulla **mappa** e nella diplomazia, ma non hanno tesoreria,
inventario, forze nel catalogo.

Quindi:

- un filone del Levante **si racconta** benissimo, e muove **relazioni e diplomazia** (che sono
  dati vivi per tutte le polity della mappa);
- ma un atto che deve **cambiare i numeri di Israele** (un embargo che taglia le importazioni, un
  riarmo che tocca le forze) **non ha ancora dove atterrare**. Prima di quello, o si estende il
  catalogo a `ISR`/`PSE`, o l'atto resta diplomatico/narrativo.

Questo **non** è un difetto dello standard: è il confine tra *la trama* (il filone) e *il motore*
(i numeri). Va detto, e va scelto: quali filoni restano diplomatici, e per quali vale la pena
costruire un catalogo.

---

## 6. Cosa NON è cambiato

- Il **motore** (ledger, EffectValidator, ProjectEngine) non è toccato.
- Il preset del Millennium resta **identico per tutti**.
- Un giocatore che sceglie l'**Italia** non riceve proposte su Hamas: riceve **contesto**, non
  decisioni che non gli appartengono.
- Niente Pressure, niente quest, niente missioni (vietate dalla policy).
