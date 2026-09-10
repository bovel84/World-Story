# World Story — audit grafico e piano di immersione

**Versione:** 1.0 — 9 settembre 2026  
**Stato:** proposta di art direction e roadmap; nessuna modifica al gameplay è autorizzata da questo documento.  
**Relazione con i piani esistenti:** integra, senza sostituire, `PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md` e i pacchetti U01–U03 di `PIANO_ESECUTIVO_LLM_REALISMO_UX.md`.

## 1. Metodo e perimetro dell’audit

L’analisi è basata su:

- build locale realmente renderizzata in Chrome a 1260×604;
- schermate Landing, Scenari e Scelta paese conservate in `docs/ref/audit-grafico-2026-09-09/`;
- schermate di verifica del gameplay in `docs/ref/pax-verifica-2026-09-07/`;
- componenti principali in `frontend/src/components/Game/` e `frontend/src/components/Map/`;
- orchestrazione in `frontend/src/App.tsx`;
- stili in `frontend/src/index.css` e `frontend/src/editorial.css`;
- flussi Ordini, Tempo, Dispacci, Diplomazia, Consulente, Nazione e Save/Load.

### Prodotto, pubblico e compito principale

- **Prodotto:** simulatore geopolitico di storia alternativa in cui il mondo avanza soltanto quando il giocatore lo decide.
- **Pubblico:** giocatori di grand strategy e narrativa sistemica che vogliono libertà, conseguenze credibili e una storia leggibile.
- **Compito principale della schermata di gioco:** capire lo stato del mondo, formulare una decisione e osservare conseguenze spiegabili.

## 2. Valutazione sintetica dello stato attuale

| Area | Valutazione | Sintesi |
|---|---:|---|
| Identità della Landing | 7,5/10 | Il pianeta, il grande wordmark e la notte costruiscono atmosfera; manca ancora una promessa di gioco concreta. |
| Catalogo scenari | 5,5/10 | Buona base editoriale, ma descrizioni incontrollate, strumenti da autore mescolati al percorso del giocatore e gerarchia irregolare. |
| Scelta paese | 6/10 | Mappa chiara e lista funzionale; manca quasi interamente la fantasia strategica del “chi governerò?”. |
| Mappa in partita | 7/10 | È il bene visivo più forte; può diventare la vera superficie narrativa, non soltanto sfondo dei pannelli. |
| Gerarchia dei comandi | 5/10 | Ordini e tempo sono correttamente separati nel dominio, ma non abbastanza collegati nell’interfaccia. |
| Coerenza visiva | 4,5/10 | Convivono giornale, sala operativa navy, viola SaaS e residui legacy senza una grammatica unica. |
| Immersione narrativa | 6/10 | Dispacci, timeline e checkpoint sono promettenti; le interruzioni modali e i duplicati informativi riducono il ritmo. |
| Accessibilità | 4,5/10 | Esistono focus visibile e reduced motion, ma card cliccabili, dialoghi, mappa e hotkey hanno lacune importanti. |
| Responsive | 5/10 | Il mobile è considerato, ma il salto quasi diretto fra 720 px e desktop penalizza tablet e landscape. |
| Manutenibilità grafica | 3,5/10 | CSS stratificato, vendor inglobato, molte regole morte e numerosi `!important` rendono rischiosa ogni correzione. |

### Diagnosi

Il gioco **non ha un problema di assenza di stile**. Ha già diversi stili validi, ma competono fra loro. La priorità non è aggiungere decorazioni: è trasformare mappa, sala operativa e dispacci in un unico sistema percettivo.

La parte più riuscita è il contrasto fra:

1. **mondo vivo** — la mappa;
2. **decisione** — il tavolo di comando;
3. **conseguenza** — il dispaccio.

Questa triade deve diventare l’architettura dell’esperienza.

## 3. Direzione creativa proposta

### 3.1 Concetto: “Atlante del potere, cicatrici della storia”

World Story deve sembrare un atlante geopolitico vivo consultato da una sala di governo. Non un gestionale finanziario generico, non un giornale applicato a ogni form, non un clone dell’interfaccia di un altro gioco.

Le tre famiglie di superficie sono:

- **Atlante:** mappa, confini, città, rotte, aree di influenza e cambiamenti territoriali.
- **Sala operativa:** ordini, tempo, diplomazia, dossier e consulente su superfici navy stabili.
- **Archivio dei dispacci:** eventi confermati e leggibili su carta, con tono editoriale.

### 3.2 Elemento firma: la “cicatrice temporale”

Il rischio estetico deliberato è mostrare per alcuni secondi il confine precedente dopo un cambiamento territoriale, come una linea cartografica fantasma. La stessa traccia collega visivamente:

```text
ordine del giocatore → processo → evento → regione → nuovo stato
```

La cicatrice non è decorazione:

- segnala cosa è realmente cambiato;
- distingue passato e presente senza usare soltanto il colore;
- permette di aprire “Perché è successo?”;
- rende immediatamente riconoscibile uno screenshot di World Story.

Con `prefers-reduced-motion`, la transizione diventa un confronto statico prima/dopo.

### 3.3 Palette consolidata

| Token | Colore | Uso |
|---|---|---|
| Notte cartografica | `#0C1726` | cornice mappa e fondo globale |
| Navy comando | `#14243A` | desk, HUD e pannelli operativi |
| Acciaio | `#405572` | bordi, divisori, controlli secondari |
| Carta archivio | `#F8F3E9` | dispacci e documenti narrativi |
| Inchiostro | `#18201E` | testo sulla carta |
| Segnale rosso | `#9F3028` | decisioni critiche, conseguenze e alert reali |
| Oro cronologia | `#CDA65B` | date, nessi causali e focus storico |
| Viola assistenza | `#8B73DB` | IA, suggerimenti e anteprime non canoniche |

Il viola non deve più essere l’accento universale: identifica esclusivamente contenuto assistito o non ancora eseguito. Rosso e oro identificano fatti e decisioni canoniche.

### 3.4 Tipografia

- **Bodoni Moda:** solo wordmark e titoli evento eccezionali; è il volto del marchio, non un font da interfaccia.
- **Source Sans 3:** HUD, controlli, form, chat e leggibilità operativa.
- **Literata:** dispacci, lore e narrazione lunga.
- **IBM Plex Mono:** date, codici, quantità e metadati brevi.

Tutti i font vanno self-hostati in WOFF2. Minimi: 16 px per testo corrente, 14 px per etichette, 12 px solo per metadati secondari.

### 3.5 Motion e audio

Un solo momento orchestrato al commit di un evento:

1. la data scatta;
2. la regione interessata pulsa;
3. compare la cicatrice temporale;
4. arriva il dispaccio;
5. il giocatore decide se continuare o intervenire.

Durata complessiva 600–900 ms, mai durante digitazione o streaming LLM. Audio e feedback aptico sono opzionali e disattivati per default: breve telescrivente per evento saliente, colpo secco per checkpoint, nessun sottofondo obbligatorio.

## 4. Architettura visiva obiettivo

### Desktop ≥1024 px

```text
┌ WORLD STORY · scenario ─ stato ─ data ─ [AVANZA] ─ sistema ┐
│ Rail  │                    MAPPA                    │ Desk   │
│ 40–56 │  legenda · livelli · cicatrici · focus     │ 400 px │
│  px   │  ispettore provincia contestuale           │ max    │
│       │                                             │        │
└───────┴─────────────────────────────────────────────┴────────┘
```

- La mappa resta sempre dominante.
- Un solo desk operativo alla volta.
- Il rail rimane visibile anche quando un desk è aperto, così il passaggio Ordini → Diplomazia richiede un click.
- Il desk appartiene alla griglia e non galleggia arbitrariamente sopra informazioni importanti.
- “Avanza” è sempre riconoscibile come unica azione che muove il tempo.

### Tablet 768–1023 px

```text
┌ HUD compatta · data · Avanza ┐
│          Mappa 60%           │
│ Desk laterale oppure sheet   │
└ Rail contestuale compatta ───┘
```

Layout deciso dallo spazio reale: pannello laterale solo se conserva almeno il 55% della larghezza alla mappa; altrimenti bottom sheet.

### Mobile 320–767 px

```text
┌ Nazione · data       [Avanza] ┐
│             MAPPA             │
│  scheda provincia compatta    │
├ Ordini · Diplo · News · Nazione┤
│ bottom sheet del modulo       │
│ contenuto scrollabile         │
│ footer azione sopra tastiera  │
└──────────── safe area ─────────┘
```

Una superficie alla volta. Nessun testo a 8 px per far entrare cinque etichette. Con tastiera aperta il compositore e la CTA devono restare visibili.

## 5. Miglioramenti per schermata e sistema

### 5.1 Landing

**Problemi osservati**

- Il pianeta e il wordmark sono forti, ma la pagina dice soltanto “Simulatore di storia alternativa”.
- “Modello IA” compete quasi allo stesso livello di “Nuova partita”, portando tecnologia interna davanti alla fantasia di gioco.
- Il masthead mostra “OPEN STORY” mentre il prodotto è “World Story”.
- La partita salvata arriva sotto l’hero e può comparire in ritardo senza skeleton o stato d’errore.

**Intervento**

- Hero: mantenere il pianeta, ma aggiungere una frase concreta: **“Governa una nazione. Cambia una decisione. Osserva un mondo che ricorda.”**
- CTA primaria “Nuova storia”; CTA contestuale “Continua — [Nazione, data]” quando esiste un save.
- Spostare configurazione IA in “Impostazioni tecniche”.
- Inserire un piccolo dispaccio dinamico di esempio, non una lista di feature.
- Mostrare l’ultimo save con bandiera, scenario, nazione, data di gioco e miniatura geografica.

**Accettazione**

- In 5 secondi un nuovo utente sa cosa controlla e cosa accade dopo.
- Un save esistente è riprendibile senza scroll.
- Nessuna denominazione “Open Story/Open-Pax” resta nel percorso pubblico.

### 5.2 Catalogo scenari

**Problemi osservati**

- Le descrizioni lunghe producono card molto diverse e ampi vuoti nella griglia.
- Testi tecnici e interi prompt di scenario appaiono come descrizione commerciale.
- Modifica, copia ed esportazione sono esposti su ogni card al giocatore.
- Non esistono ricerca, filtri, raccomandazioni o separazione tra storico, provinciale, arcade e fixture tecnica.

**Intervento**

- Card uniforme con: epoca, nome, pitch di massimo 160 caratteri, scala mappa, complessità e tono.
- Le descrizioni complete entrano in un pannello “Dettagli scenario”.
- Filtri: **Consigliati / Storici / Moderni / Provinciali / Sperimentali**.
- Separare “Gioca” da “Studio scenari”; import, modifica, copia ed export escono dal percorso primario.
- Fixture tecnica nascosta per default dietro modalità sviluppatore.
- Ogni card riceve un’identità d’epoca sobria: carta declassificata 1951, bollettino contemporaneo, mappa operativa 1939; non semplici gradienti diversi.

**Accettazione**

- Le prime sei card sono confrontabili senza leggere paragrafi lunghi.
- Nessuna riga della griglia è governata dall’altezza di un prompt tecnico.
- Card selezionabili da tastiera come veri button/link; azioni autore con `aria-label`.

### 5.3 Scelta paese

**Problemi osservati**

- Il selettore difficoltà è isolato in alto e visivamente estraneo.
- La lista presenta quasi soltanto nome e codice.
- La mappa non racconta alleati, minacce, potenza o difficoltà della posizione iniziale.
- La CTA “Gioca” è generica e il contesto scenario è collassato senza forte motivo.

**Intervento**

Dopo la selezione mostrare una scheda:

```text
ITALIA · Repubblica parlamentare
Posizione: potenza regionale · difficoltà strategica media
Alleati principali: …  | Pressioni: …
Punti di forza: industria, posizione mediterranea
Sfide iniziali: energia, debito, instabilità regionale
[Avvia come Italia]
```

- Ricerca paese e filtri per continente/stile di gioco.
- Difficoltà integrata nella scheda e spiegata in effetti verificabili.
- Mappa con legenda e contorni differenti per selezionato, alleato, rivale e non disponibile.
- Contestualizzare data e divergenza dello scenario prima della conferma.

### 5.4 Generazione del mondo

- Mostrare lo `stage` reale del backend, non fasi simulate dal client.
- Presentare scenario e nazione scelti per mantenere continuità narrativa.
- Fornire retry, annullamento sicuro e recupero dopo refresh.
- Se il processo dura a lungo, mostrare fatti sullo scenario già locali, non spinner e copy casuale.
- Non promettere ETA precisa se non misurata; usare intervallo basato su dati storici del job.

### 5.5 Shell di gioco e HUD

**Obiettivo:** mappa libera all’ingresso, stato essenziale e nessun sovraccarico.

HUD primaria:

- World Story/scenario;
- nazione controllata;
- data di gioco;
- stato simulazione/connessione;
- unica CTA “Avanza”.

Spostare salvataggi, modello IA e prompt in un menu sistema. Distinguere sempre:

- **tempo fermo**;
- **ordini registrati**;
- **simulazione in corso**;
- **checkpoint in attesa**;
- **riconnessione SSE con polling attivo**.

### 5.6 Mappa

- Ispettore persistente al click/tap; tooltip hover solo come scorciatoia desktop.
- Legenda sempre disponibile e generata dai dati.
- Livelli: Politica, Terreno, Cambiamenti recenti; filtri città, porti, industria e unità quando i dati sono reali.
- “Mostra sulla mappa” da ordini, progetti, chat ed eventi.
- Pattern/tratto oltre al colore per selezione e cambiamento.
- Point-on-surface per etichette, decluttering e test su 4.475 province.
- Fallback senza satellite e senza rete esterna.
- Correggere il popup costruito con `setHTML()` in `MapboxMapView.tsx`: contenuto non fidato deve passare da DOM e `textContent`.

### 5.7 Ordini

Il flusso deve essere visibile come stato:

```text
BOZZA → INTERPRETAZIONE → FATTIBILITÀ → REGISTRATO → ESEGUITO AL SALTO
```

- Preservare il testo libero.
- “Migliora formulazione” resta esplicitamente IA e non registra nulla.
- Aggiungere “Verifica fattibilità” con costo, tempi, prerequisiti e rischi.
- Mostrare conflitti tra ordini nello stesso lotto.
- Consentire riordino tramite pulsanti e tastiera.
- Dopo la registrazione: badge globale “3 ordini pronti” e CTA “Scegli quando eseguirli”, che apre Tempo.
- Mai usare “Invia” se l’ordine non viene eseguito immediatamente.

### 5.8 Tempo e checkpoint

Separare due viste oggi mescolate:

1. **Avanza il tempo** — data destinazione, ordini pronti, processi che potrebbero maturare;
2. **Cronaca** — archivio read-only e ripristino esplicito.

Prima del salto mostrare ciò che il sistema prenderà in carico, non anticipare eventi futuri. Al checkpoint:

- evento;
- data;
- regione;
- ordine/processo causale;
- effetti applicati;
- “Continua” e “Intervieni qui”.

Restore e continuazione da un evento storico richiedono conferma chiara perché aprono un nuovo ramo.

### 5.9 Dispacci

- NewsFlash soltanto per eventi salienti o decisioni richieste.
- Eventi minori entrano nel desk senza interrompere.
- Badge basato sui non letti, non sul totale archivio.
- Gerarchia: fonte, data, luogo, titolo, conseguenza, causa.
- Azioni: “Mostra sulla mappa”, “Perché”, “Apri processo”, “Intervieni” quando realmente consentito.
- Evitare tre archivi sovrapposti tra Timeline, Dispacci e Storico nazionale.

### 5.10 Nazione

Trasformare il dossier da promessa a superficie decisionale:

- **Situazione:** 3–5 decisioni vere e scadenze;
- **Progetti:** stato, milestone e blocker;
- **Bilancio:** disponibile, impegnato, previsto;
- **Risorse:** stock/accesso, produzione e trasporti;
- **Conoscenze:** capacità note, mancanti, ricerca e personale;
- **Politiche:** mandati e servizi.

Nascondere sezioni placeholder e codici interni M01/M05/M07. Non mostrare valori fittizi come fallback: usare `—` e spiegare perché il dato manca.

### 5.11 Diplomazia e consulente

**Diplomazia**

- Collegare la matrice relazioni alla chat corretta.
- Separare conversazione, proposta formale e accordo.
- Card accordo con parti, obblighi, date, stato e conferma.
- Nessuna conseguenza materiale dedotta da emoji o parole chiave.

**Consulente**

- Mostrare il contesto usato: data, nazione e problema corrente.
- Suggerire domande utili ma non inviarle automaticamente.
- Separare risposta del personaggio da errore tecnico.
- I bollettini proattivi hanno badge dedicato e non competono con i dispacci.

### 5.12 Save/Load e sistema

- Un solo picker di salvataggio, usato sia dalla Landing sia in partita.
- Mostrare scenario, nazione, data, turno, ramo e miniatura.
- Filtrare sempre `__rewind__` dall’interfaccia utente.
- Caricamento atomico di mondo, coda, cronaca, chat, advisor e reader.
- Toast dopo salvataggio; conferma prima di abbandonare una partita con bozza o ordini non eseguiti.
- Sostituire `alert()` e `confirm()` nativi con dialoghi coerenti e accessibili.

## 6. Accessibilità e qualità percettiva

### P0

- Primitive `AccessibleDialog`: portal, focus iniziale, trap, background inert, Escape, ritorno focus e scroll lock.
- Card scenario e path/alternativa paese navigabili da tastiera.
- Hotkey della mappa attive solo quando la mappa ha focus.
- Target ≥44×44 px.
- Contrasto WCAG 2.2 AA e stati mai affidati soltanto a rosso/verde.
- `lang="it"`, favicon e metadata World Story.

### Responsive obbligatorio

Baseline visuali e funzionali a:

- 320×568;
- 390×844;
- 768×1024;
- 1024×768 landscape;
- 1366×768;
- 1920×1080.

Verificare zoom 200%, tastiera virtuale, safe area, testi lunghi italiani e scenario con migliaia di province.

## 7. Piano di esecuzione

Le stime seguenti sono intervalli iniziali per una persona equivalente e devono essere ricalibrate dopo la baseline. Non sono impegni di calendario.

### Fase G0 — Baseline e inventario, 3–5 giorni

- screenshot correnti di tutti gli stati;
- metriche prestazioni e bundle;
- inventario CSS vivo/morto;
- mappa focus/z-index/dialoghi;
- test di comprensione del ciclo ordine → avanza con 5 utenti.

**Uscita:** baseline approvata, nessun redesign “a memoria”.

### Fase G1 — Fondazioni visive e CSS, 8–12 giorni

- token semantici;
- font locali;
- separazione MapLibre/vendor;
- `GameShell`, `CommandRail`, `AccessibleDialog`, `ToastRegion`;
- migrazione incrementale senza nuovi `!important`.

**Dipendenza:** precede tutti i moduli nuovi.  
**Uscita:** shell stabile desktop/mobile, nessuna regressione funzionale.

### Fase G2 — Landing, scenari e paese, 8–12 giorni

- nuova gerarchia Landing;
- ultimo save sopra la piega;
- catalogo scenari filtrato e card uniformi;
- Studio scenari separato;
- dossier paese e difficoltà contestuale;
- loader autorevole.

**Uscita:** ingresso al gioco comprensibile, accessibile e recuperabile.

### Fase G3 — Mappa e shell in-game, 12–18 giorni

- rail persistente;
- desk in griglia;
- ispettore provincia;
- legenda e livelli;
- stato connessione/simulazione;
- primo prototipo della cicatrice temporale su fixture.

**Uscita:** la mappa resta dominante in ogni viewport.

### Fase G4 — Ordini, Tempo e causalità, 15–22 giorni

- stati Bozza/Verifica/Registrato;
- catena della fattibilità;
- coda prioritizzabile;
- desk Tempo separato dalla Cronaca;
- evento causale, “Perché” e “Mostra sulla mappa”;
- salienza dispacci e unread reale.

**Dipendenze:** contratti backend di fattibilità e riferimenti causali.  
**Uscita:** il ciclo fondamentale è leggibile e spiegabile.

### Fase G5 — Nazione, diplomazia e save/load, 15–25 giorni

- sezioni dossier alimentate da dati reali;
- progetti e decisioni;
- accordi diplomatici strutturati;
- picker save/load unico;
- conferme di ramo e riallineamento atomico client.

**Dipendenze:** read model nazionale e DTO accordi.  
**Uscita:** nessun placeholder nel percorso principale degli scenari supportati.

### Fase G6 — Game feel, performance e rifinitura, 8–14 giorni

- motion orchestrato;
- audio/haptic opt-in;
- lazy loading MapLibre/editor/LLM settings;
- layer MapLibre al posto di marker DOM eccessivi;
- visual regression e rifinitura mobile/tablet.

**Uscita:** LCP ≤2,5 s, mappa interattiva ≤3,5 s sul profilo concordato, ≥45 FPS sulla fixture provinciale.

### Fase G7 — Validazione e rollout, 5–10 giorni

- axe e tastiera;
- test moderati con giocatori;
- feature flag per shell, eventi causali e nuova mappa;
- confronto metriche baseline;
- rollback verificato.

## 8. Backlog prioritizzato

| ID | Priorità | Intervento | Impatto | Sforzo |
|---|---|---|---|---|
| VIS-01 | P0 | Correggere popup `setHTML()` della mappa | sicurezza/fiducia | S |
| VIS-02 | P0 | Dialog condiviso accessibile | accessibilità/coerenza | M |
| VIS-03 | P0 | Separare e ridurre il CSS stratificato | stabilità di tutto il redesign | L |
| VIS-04 | P0 | Picker Save/Load unico e atomico | fiducia | L |
| VIS-05 | P0 | Stato connessione distinto dallo stato job | affidabilità percepita | M |
| VIS-06 | P1 | Consolidare brand World Story | identità | S |
| VIS-07 | P1 | Uniformare card scenario e separare authoring | conversione/onboarding | M |
| VIS-08 | P1 | Dossier paese iniziale | fantasia strategica | M |
| VIS-09 | P1 | Rail persistente e desk in griglia | navigazione | L |
| VIS-10 | P1 | CTA globale Avanza + ordini pronti | chiarezza ciclo | M |
| VIS-11 | P1 | Separare Tempo e Cronaca | comprensione | M |
| VIS-12 | P1 | Unread reale e salienza dei dispacci | ritmo | M |
| VIS-13 | P1 | Ispettore provincia e legenda | usabilità mappa | L |
| VIS-14 | P1 | “Perché” e riferimenti causali | unicità/immersione | L |
| VIS-15 | P1 | Cicatrice temporale | firma del prodotto | L |
| VIS-16 | P1 | Nascondere placeholder Nazione | credibilità | S |
| VIS-17 | P1 | Font locali e scala tipografica | leggibilità/performance | M |
| VIS-18 | P2 | Accordi diplomatici strutturati | profondità | L |
| VIS-19 | P2 | Livelli mappa e filtri | profondità cartografica | L |
| VIS-20 | P2 | Audio e haptic opt-in | game feel | M |

## 9. Metriche di successo

### Comprensione

- ≥90% dei tester distingue “Registra ordine” da “Avanza”.
- ≥80% sa indicare perché un evento è accaduto.
- ≥90% completa Landing → paese → HUD senza assistenza.

### Ritmo

- tempo mediano HUD → primo ordine ridotto del 25%;
- meno di 1 NewsFlash automatico ogni 5 minuti in sessione ordinaria;
- passaggio tra moduli in un click;
- decisione richiesta raggiungibile in massimo 2 click.

### Qualità

- zero violazioni axe critical/serious;
- zero nuovi `!important` nei componenti migrati;
- target touch ≥44 px;
- nessun testo operativo sotto 12 px;
- zero eventi non committati presentati come notizia.

### Prestazioni

- Landing first-party iniziale <900 KB non compresso, MapLibre in chunk separato;
- LCP ≤2,5 s sul profilo medio concordato;
- mappa interattiva ≤3,5 s;
- ≥45 FPS durante pan/zoom sulla fixture da 4.475 province;
- nessun long task >200 ms all’apertura di un desk.

## 10. File principali interessati

### Da rifattorizzare

- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/editorial.css`
- `frontend/src/components/Game/HudBar.tsx`
- `frontend/src/components/Game/Fab.tsx`
- `frontend/src/components/Game/ActionsPanel.tsx`
- `frontend/src/components/Game/EventFeed.tsx`
- `frontend/src/components/Game/SimulationEventReader.tsx`
- `frontend/src/components/Game/NationDock.tsx`
- `frontend/src/components/Game/ChatsPanel.tsx`
- `frontend/src/components/Game/Landing.tsx`
- `frontend/src/components/Game/TemplateSelector.tsx`
- `frontend/src/components/Game/CountrySelector.tsx`
- `frontend/src/components/Map/MapboxMapView.tsx`

### Nuovi componenti consigliati

- `frontend/src/components/Shell/GameShell.tsx`
- `frontend/src/components/Shell/CommandRail.tsx`
- `frontend/src/components/UI/AccessibleDialog.tsx`
- `frontend/src/components/UI/ToastRegion.tsx`
- `frontend/src/components/Game/TimeDesk.tsx`
- `frontend/src/components/Game/ProvinceInspector.tsx`
- `frontend/src/components/Game/CausalEventCard.tsx`
- `frontend/src/styles/tokens.css`

## 11. Quick wins realizzabili prima del redesign completo

1. “OPEN STORY” → “WORLD STORY”; `lang="it"`, favicon e metadata corretti.
2. Portare “Continua partita” sopra la piega quando esiste un save.
3. Limitare la descrizione delle card scenario e aprire il testo lungo nei dettagli.
4. Spostare Nuovo/Importa/Modifica/Clona/Esporta in “Studio scenari”.
5. Nascondere fixture e sezioni Nazione non operative.
6. Correggere badge Notizie usando i non letti.
7. Mostrare lo stage backend reale nel loader.
8. Aggiungere legenda mappa e scheda persistente al tap.
9. Sostituire feedback nativi non distruttivi con toast.
10. Correggere sicurezza del popup e semantica tastiera delle card.

## 12. Decisione raccomandata

Non procedere con un’altra mano di CSS sopra l’interfaccia esistente. Avviare **G0 e G1**, poi costruire un verticale dimostrativo ristretto:

```text
Landing → scenario Guerra Fredda → Italia → un ordine verificato
→ Avanza → un evento causale → cicatrice sulla mappa → dispaccio
```

Se questo percorso risulta chiaro, distintivo e performante, estendere la grammatica agli altri moduli. È il modo più rapido per rendere World Story più accattivante senza trasformare il redesign in una raccolta di effetti scollegati.
