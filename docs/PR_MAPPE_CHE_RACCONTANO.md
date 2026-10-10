# PR — `feat/ws-mappe-che-raccontano`

**Titolo:** `feat(government): la scheda mappa seleziona le zone giuste e racconta di più (MAP01-MAP11)`

**Base:** `main` (il ramo è `main` + 1 commit, nessun rebase necessario)

---

## Per aprire la PR

Il push va fatto da qui (questa sandbox non ha credenziali GitHub):

```bash
cd "/Users/bovel/Desktop/World Story"
git push -u origin feat/ws-mappe-che-raccontano
```

Poi GitHub stampa il link diretto per aprire la PR. In alternativa:

```bash
gh pr create --base main --head feat/ws-mappe-che-raccontano \
  --title "feat(government): la scheda mappa seleziona le zone giuste e racconta di più (MAP01-MAP11)" \
  --body-file docs/PR_MAPPE_CHE_RACCONTANO.md
```

---

## Cosa cambia, in una frase

La scheda mappa del governo **non sceglieva**: disegnava un solo insieme di id,
con il colore del proprietario, e buttava i nomi fuori dal riquadro. Ora legge
dalla conversazione **di quali province si parla**, le mette in evidenza con il
loro vicinato, inquadra il soggetto, colora da un **dato canonico** con la sua
scala, e segna i luoghi che il motore registra sul territorio.

## La misura che ha guidato il lavoro

Su una partita reale (Giordania, 11 province, `open-pax.db`, 2,35 GB):

| | prima | dopo |
|---|---|---|
| zone | le 11 tutte uguali | primarie (le nominate) · adiacenti (confine canonico) · contesto |
| inquadratura | `250 52 139 154` | `267 100 60 49` (**2,5× più stretta**) |
| etichette dentro la mappa | 0 | 2 (le primarie) |
| colore | il verde della bandiera su tutte | PIL a 4 fasce a quantili |
| legenda | 1 voce, «JOR» | la **scala**, con gli intervalli e «11 province con dato» |
| segni | un pallino sul **centroide** | capitale **alle sue coordinate reali**, città e impianti |

**L'ipotesi smentita.** Credevo che le province fossero troppo piccole per essere
disegnate. Falso: JOR 0/11 regioni minuscole, NPL 0/7, BIH 0/47, IND 0/40,
DEU 3/181. Solo gli imperi soffrono (CAN 45/91, USA 54/256). Non era geometria:
era **inquadratura** — e `focusViewBox` esisteva già, usato dalla Tavola e dalle
mappe statiche, mai dalla scheda del governo.

## Le fasi

| fase | cosa entra |
|---|---|
| **MAP01** | `regionRelevance.ts` (puro): zone **nominate** dal testo, con 4 guardie (parole intere, lunghezza minima, ambiguo scartato, insieme chiuso) |
| **MAP02** | ruoli `primary/context/adjacent`, inquadratura sulle primarie, `data-role` |
| **MAP03** | `regionLabels.ts` (puro): de-collisione, corpo adattivo, «se non entra non si disegna» |
| **MAP04** | `regionMetrics.ts` (puro): `pil`/`popolazione`/`difesa`, colori e legenda **riusando** `thematicMapModel` |
| **MAP05** | `PresentationDirective.metric?`; il Consulente e il ministro dichiarano l'**intento**, mai le cifre |
| **MAP06** | frontiera dell'insieme dai `borders` canonici, quota delle primarie sulla metrica |
| **MAP07** | banco **nudo** coi rapporti di scala reali, e il caso antimeridiano |
| **MAP08** | l'insieme oltre 184° non uccide l'anteprima se le primarie sono misurabili |
| **MAP09** | `regionMarkers.ts` (puro): segni proiettati con la **stessa** proiezione dei poligoni |
| **MAP10** | **chiusa senza codice**: i giacimenti sono per politia, e la mappa grande li ha già |
| **MAP11** | il clic apre la **stessa** lettura: `pil` → layer `economy`; il pulsante lo dichiara |

## Invarianti rispettate

`MAX_MAP_REGION_IDS = 20` resta fail-closed sul payload del modello. La scheda
resta un **read model**: nessuna scrittura sul motore. Il modello non scrive mai
id, colori o numeri — sceglie solo *cosa* guardare (invariante C01). La mappa
principale (WebGL) resta l'altra cosa.

## Difetti trovati e corretti (verifica avversariale)

1. **`placeLabels` poteva uscire dalla zona** — lo scorrimento era limitato
   dall'altezza della zona divisa per il passo, non dalla **scatola**
   dell'etichetta: in una provincia bassa la seconda etichetta finiva ~8 unità
   sotto il bordo, sopra la provincia vicina.
2. **La guardia dell'antimeridiano confrontava pixel con gradi** — il riquadro
   proiettato (0..640 px) era confrontato con `184` **gradi**: una provincia larga
   600 unità sulla tela legacy veniva scartata pur non attraversando nessun fuso.
3. **Le radici dei pattern metriche erano inerti** — `\b(?:economi|popolazion)\b`
   non matcha mai: «economia», «popolazione», «produzione» non selezionavano nulla.
4. **Un falso verde** — `expect(width).toBeGreaterThan(0)` passava per qualunque
   anteprima non nulla, sostituito da un'asserzione che ogni path cade dentro il
   riquadro.

## Verifica

- **suite completa del frontend: 189 file, 1639 test, 0 fallimenti** (eseguita in
  blocchi di ~50 file: questa sandbox sospende i processi in background fra una
  chiamata e l'altra);
- **206 test** sui 19 file del perimetro mappa (fra cui 40 nuovi);
- **12 test backend** sul prompt reale (`advisor-map-directive.test.ts`);
- `tsc` pulito su **frontend e backend**.

## Cosa resta aperto, dichiarato

Il rendering **in pagina** non è mai stato visto: tutte le misure girano in Node
(`renderToStaticMarkup`). Un banco e2e nel browser richiede un server su
`localhost` raggiungibile dal pannello del browser, che questa sandbox non offre.
Il markup è però quello **reale** del componente, generato sui dati di partita.

## File

20 file, **+2219 / −21** righe. Quattro moduli nuovi e puri (615 righe):
`regionRelevance.ts`, `regionLabels.ts`, `regionMetrics.ts`, `regionMarkers.ts`.
Sei file di test nuovi. Il piano completo è in
`docs/PIANO_MAPPE_CHE_RACCONTANO.md` (466 righe).
