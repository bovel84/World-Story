# World Story — il Consulente che mostra, e il modulo Ordini alleggerito

**Versione:** 1.0, 25 settembre 2026.
**Stato:** **C01, C02, C03 implementate e verificate.**
**Destinatari:** sviluppatori e LLM esecutori.
**Rapporto con gli altri piani:** prosegue `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md` (D01–D07),
`COERENZA_DOSSIER_ANNO_NAZIONE.md` (N01–N08) e `DIREZIONE_CIVILE_DEL_GIOCCO.md` (M01–M03).
Questo risponde a due richieste dirette: **dare più potenzialità al Consulente** con aspetti
grafici, e **alleggerire il modulo Ordini**.

> Nota sul mandato. C01 e C03 sono **solo frontend**. C02 tocca **una sola riga di prompt nel
> backend** (`prompts/advisor.ts`): è l'unico modo di insegnare al modello la sintassi delle
> figure, perché il prompt vive lì. Il resto del backend è intatto e la sua logica non cambia.

---

## 1. C01 — Il Consulente mostra, non solo racconta

**La richiesta.** «Vorrei che il consulente mostrasse anche aspetti grafici come dove
investire, analizzare il territorio.»

**Cosa c'era, misurato.** Il Consulente riceveva **già** il contesto territoriale
(`PLAYER_POLITY_REGIONS`, la mappa, le risorse) — ma non aveva **nessuna resa grafica**: era
testo, e basta. Il gioco ha già una disciplina per le figure (SVG a mano in `Landing`,
`CreateWorld`, `TacticalOverlay`), ma il Consulente non ne usava nessuna.

**Cosa ho costruito.** Il modello può chiedere una figura con una riga sola:

```
[[chart: territorio]]   dove sono ricche le province del paese
[[chart: bilancio]]     dove va il denaro: le uscite per voce
[[chart: risorse]]      giacimenti noti e siti produttivi
[[chart: trend]]        come sta evolvendo (cassa, saldo, stabilità, tensione)
```

### La regola che conta più di tutte

**Il modello sceglie cosa mostrare, mai le cifre.** Il blocco porta **solo il tipo**; ogni
numero lo mette il frontend dai read model del motore e della mappa
(`advisorCharts.ts`). Il motivo è preciso: un grafico disegnato con numeri del modello
sarebbe una figura **verosimile e falsa** — il difetto peggiore possibile, perché *sembra* un
dato. Un test lo difende in tre modi: la sintassi con cifre dentro non è riconosciuta, il
modulo dei grafici non contiene importi scritti a mano, e ogni serie viene da un ingresso.

### Le quattro figure

**Territorio** — le province del giocatore ordinate per prodotto: il «dove investire» in senso
letterale, si vede dove il paese produce e dove è vuoto. **Bilancio** — le uscite per voce,
con le voci civili in verde e la difesa in ambra: è il grafico che serve alla direzione civile
di M01–M03. **Risorse** — giacimenti per quantità nota; senza quantità note conta i siti
produttivi e **lo dichiara**. **Trend** — la serie storica che il motore già pubblica, scegliendo
la prima cifra disponibile fra cassa, saldo, stabilità, tensione, crescita.

**Quando non c'è nulla da mostrare, il blocco non si rende.** Se il motore non pubblica il
bilancio, o le province sono vuote, o non ci sono due punti storici, la figura **sparisce**:
meglio il testo del Consulente che una figura vuota.

**Niente librerie di grafici.** Quattro figure non giustificano una dipendenza nuova: si
disegnano in SVG nativo, come il resto del progetto. Un test verifica che nel componente non
entri nessuna libreria di charting.

## 2. C02 — Il prompt insegna la sintassi

Aggiunta al prompt del Consulente (`prompts/advisor.ts`): i quattro comandi, e tre regole
obbligatorie — non scrivere cifre nel comando, usare una figura solo quando serve a decidere,
spiegare accanto alla figura cosa guardare.

**Verificato:** nessun preset sovrascrive il prompt `advisor` (controllati tutti e nove), quindi
le istruzioni valgono in ogni scenario. Se un giorno un preset lo sovrascrivesse, perderebbe
anche queste istruzioni: è il comportamento voluto dal motore, e va ricordato.

**Confine dichiarato.** Il prompt vive nel backend: questa è l'unica modifica fuori dal
frontend, ed è una riga di testo. Non cambia la logica del motore.

## 3. C03 — Il modulo Ordini alleggerito

**La richiesta.** «Il modulo ordini esteticamente non mi piace tanto, possiamo alleggerirlo e
renderlo in linea con il gioco.»

**Il difetto, misurato.** Il modulo aveva **due temi che si combattevano**: l'editoriale su
carta crema (`editorial.css`) e la scrivania navy (`index.css`), con `!important` da entrambe
le parti. Il CSS lo ammetteva da solo, in un commento:

> «il vecchio tema scuro lasciava qui i suoi colori chiari sopra la carta editoriale:
> contrasto sotto 3:1, testo illeggibile»

Non era quindi solo un problema di gusto: era **leggibilità**. E la causa era strutturale —
la stessa classe stilata da due file, che si sovrascrivevano a vicenda.

**Cosa ho fatto.** Un blocco **canonico** in `index.css`, nel tema della scrivania (lo stesso
del Dossier e del Consulente), e la **rimozione di 24 regole** che contendevano il modulo
dall'editoriale. Nessun `!important` nel blocco nuovo: le regole arrivano dopo e non serve
alzare la voce. Il modulo resta identico nelle funzioni: cambia l'abito, non il comportamento.

### La misura, che è meglio dell'occhio

In questa sessione il browser non è disponibile, quindi non potevo *guardare* il modulo. Ho
fatto di meglio: ho renderizzato il componente con dati reali (`renderToStaticMarkup`, come fa
il test esistente di `DeskContent`) e ho **calcolato i rapporti di contrasto WCAG** di ogni
testo del modulo.

| Elemento | Contrasto | Soglia AA |
|---|---|---|
| Titolo | 16,6 | 4,5 |
| Descrizione proposta | 7,8 | 4,5 |
| Corpo dell'azione | 8,1 | 4,5 |
| Proposta in coda | 13,8 | 4,5 |
| **Peggiore del modulo** | **6,96** | **4,5** |

**Tutti sopra soglia, il peggiore quasi il 55% oltre.** Un test lo difende: se qualcuno
cambiasse un colore portando un testo sotto 4,5, il test fallisce.

### Una regressione intercettata

La regola che ho rimosso stliava **anche** il banner del Consulente, le voci delle chat e le
voci diplomatiche — che non fanno parte di questa richiesta. Senza di essa restavano **senza
sfondo**. L'ho ripristinata, limitata a loro, e un test difende la distinzione: il modulo
Ordini ha il suo tema, gli altri tengono il proprio.

## 4. Verifica

| Prova | Esito |
|---|---|
| `tsc --noEmit` (frontend e backend) | pulito |
| Test frontend (96 file) | **tutti verdi**, a blocchi (262 + 258 + 286 = **806 test**) |
| Nuovi test | 22 in `advisorCharts.test.ts` (17) e `ordersModuleTheme.test.ts` (5) |
| Contrasto WCAG del modulo Ordini | **tutti i testi ≥ 6,96** (soglia 4,5) |
| Regole in conflitto rimosse | **24** (da `editorial.css`) |
| `!important` nel blocco canonico nuovo | **0** |
| E2E Playwright | non eseguibili in questa macchina (mancano le librerie del browser); da rilanciare in CI |

**Non ho potuto guardare il modulo** con i miei occhi: in questa sessione il browser non è
disponibile. La verifica è quindi **numerica** (contrasto) e **strutturale** (test sul CSS),
non visiva. Vale la pena che tu dia un'occhiata quando lo vedi online, e mi dica se
l'impaginazione — spaziature, dimensioni — va ritoccata: i colori sono misurati, le proporzioni
no.
