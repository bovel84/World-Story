# World Story — mondi a province complete

**Versione:** 1.0, 25 settembre 2026.
**Stato:** **P01 implementata, verificata e pubblicata.** Resta un riavvio del backend, sul tuo Mac.
**Rapporto con gli altri piani:** prosegue `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md` (D01–D07),
`COERENZA_DOSSIER_ANNO_NAZIONE.md` (N01–N08), `DIREZIONE_CIVILE_DEL_GIOCCO.md` (M01–M03),
`CONSULENTE_E_MODULO_ORDINI.md` (C01–C03).

> **La richiesta.** «Riduci i mondi, i preset devono essere a province complete.»
> E, sulla descrizione e le istruzioni: «i preset esiste già» — la struttura c'è, non va
> inventata una nuova.

---

## 1. Che cosa non era a province complete

Misurato prima di toccare, perché «province» è una proprietà verificabile: un preset è a province
quando la sua mappa ha **più feature per nazione** (`properties.country` ≠ `properties.code`).

| Preset | Mappa | Feature | Province | Esito |
|---|---|---|---|---|
| `pax_modern_provinces` | propria | 4475 | **4475** | resta |
| `modern_world_provinces` | propria | 946 | **942** | resta |
| `europa_1914` | `pax_modern_provinces` | 4475 | 4475 | resta |
| `mondo_1936` | `pax_modern_provinces` | 4475 | 4475 | resta |
| `millennium_dawn` | `pax_modern_provinces` | 4475 | 4475 | resta |
| **`europa_1815`** | `standard` (Natural Earth) | 243 | **0** | **eliminato** |
| **`mondo_1989`** | `standard` (Natural Earth) | 243 | **0** | **eliminato** |
| **`paxh_ww2_provinces`** | propria | 223 | **0** | **eliminato** |
| `realism_test_world` | propria (2 feature) | 2 | 0 | **fixture, nascosto** |

Due cose che vale la pena sapere, perché una lettura del codice non le mostra:

**`paxh_ww2_provinces` aveva «provinces» nel nome e zero province.** 223 Stati, una regione
ciascuno: era una mappa *nazionale* con un nome fuorviante. Era l'unico preset che si presentava
come provinciale senza esserlo.

**`europa_1815` e `mondo_1989` non dichiaravano `map_base`**, quindi cadevano sulla mappa
`standard` del ripiego: una regione per nazione. Erano i due mondi storici più «a nazioni» del
catalogo.

## 2. Cosa è stato fatto

**I tre preset non provinciali sono eliminati dal disco**, non solo nascosti: `loadPreset` li
restituisce `null` e non hanno più una cartella.

**La mappa della ww2 è tolta dall'elenco delle mappe native**, perché lasciarla selezionabile
permetterebbe di generare proprio il mondo nazionale da evitare. Il suo GeoJSON **non si butta**:
resta in `data/geojson/ww2_nations.geojson` come archivio, non caricabile.

**Le fixture tecniche non sono più offerte al giocatore.** Qui ho trovato un difetto che nessuno
aveva segnalato: `realism_test_world` — la fixture dei test di realismo materiale, dichiaratamente
non storica, con due polities fittizie — **compariva fra i mondi giocabili** nel selettore.
Nessuno la filtrava.

Il rimedio non è una lista di id nel codice (invecchia e lascia id orfani), ma un **marcatore nel
`preset.json`**: `"fixture": true`. `listPresets()` continua a vederla — i test la caricano
direttamente — mentre `listPlayablePresets()` la esclude, ed è quella che la rotta
`/api/templates` usa.

### Il risultato, verificato eseguendo il codice e interrogando il sito

```
MONDI GIOCABILI (quello che vede il giocatore):
  europa_1914              1914-06-28   mappa=pax_modern_provinces
  millennium_dawn          2000-01-01   mappa=pax_modern_provinces
  modern_world_provinces   2026-01-01   mappa=propria
  mondo_1936               1936-01-01   mappa=pax_modern_provinces
  pax_modern_provinces     2026-01-01   mappa=propria

fixture esclusa: realism_test_world
mappe native selezionabili: standard · modern_world_provinces · pax_modern_provinces
```

**Cinque mondi, tutti a province complete**, dal 1914 al 2026.

## 3. Descrizione e istruzioni: cosa ho misurato, e cosa non ho toccato

La seconda richiesta diceva che descrizione e istruzioni **influenzano la storia**. È vero. Ecco
`come`, perché la struttura esiste già e non ne ho aggiunta una nuova.

| Canale | Dove vive | Dove entra |
|---|---|---|
| `description` | descrizione breve del mondo | metadato del selettore: **non** va al modello |
| `base_prompt` | premessa storica dello scenario | **tutti** i prompt: simulazione, narrazione, consulente, suggerimenti, convertitore |
| `lore.md` | antefatto esteso | **accodato** al `base_prompt` quando il mondo nasce |
| `rules.md` | regole di simulazione | variabile `HISTORICAL_PRESET_SIMULATION_RULES`: simulazione, consulente, suggerimenti, convertitore |
| `prompts` | override per meccanica | **vuoto in tutti i preset** |

Due cose che vale la pena sapere:

**`description` e `base_prompt` sono cose diverse.** La `description` è il testo che si legge nel
selettore; è il `base_prompt` che parla al modello. Chi vuole cambiare la storia tocca
`base_prompt` e `lore.md`, non la descrizione.

**`base_prompt` e `lore` si sommano**, nel generatore del mondo: il modello riceve entrambi, senza
scala di priorità.

**Non ho toccato niente di tutto questo**, come da tua indicazione: la struttura funziona, e
riempire il campo `prompts` — vuoto ovunque — è una scelta di contenuto che spetta a te.

## 4. Verifica

| Prova | Esito |
|---|---|
| Test backend toccati (26 file) | **tutti verdi**: 130 + 82 + 58 + 79 + 26 test nei gruppi che citano preset e mappe |
| Nuovo file di test | `tests/playable-presets.test.ts` (7 test) |
| `tsc --noEmit` | pulito |
| `npm run build` (backend) | verde, `dist/` aggiornato |
| `vite build` (frontend) | verde |
| Verifica sul sito | tre preset eliminati **spariti** dall'elenco servito |

**Sette test aggiornati** — `native-maps`, `preset-rebuild`, `presets`, `map-polities`,
`map-p6-real-preset`, `scenario-editor` — tutti perché citavano i preset eliminati. In ognuno la
proprietà verificata è rimasta: è cambiato il soggetto su cui si misura.

**Due regressioni mie, intercettate dai test:** avevo messo `millennium_dawn` in un elenco di
preset «senza catalogo», ma ha il suo `simulation/` — il test ha asserito il falso e mi ha
corretto; e in un secondo elenco avevo ripetuto lo stesso errore su un'altra lista. Sono i test
esistenti che hanno fermato due mie classificazioni sbagliate.

**Gli E2E Playwright non sono eseguibili in questa macchina** (mancano le librerie del sistema per
il browser); vanno rilanciati in CI.

## 5. Una cosa da fare sul tuo Mac, e una cosa da sapere

### Il riavvio del backend — una riga

L'eliminazione dei preset è **già online** (i tre mondi sono spariti dall'elenco servito): le
cartelle vengono lette dal disco a ogni richiesta. Ma **la fixture tecnica è ancora servita**,
perché l'esclusione è nel **codice** del backend (`listPlayablePresets`) e il processo in
esecuzione è quello vecchio, che non l'ha mai avuta. Il `dist/` è già ricompilato: manca solo il
riavvio.

```
bash scripts/deploy-cloudflare.sh
```

Oppure, per il solo backend: `launchctl kickstart -k "gui/$(id -u)/com.openpax.backend"` dalla tua
macchina. Da questa VM non è possibile: `launchctl` è di macOS.

### Le partite salvate sui mondi eliminati

I mondi nel database sono indipendenti dai preset — regioni e geojson stanno in `world_regions`,
non nel pacchetto — quindi **le partite esistenti continuano a funzionare**. Ma un salvataggio con
`template_id = europa_1815` non potrebbe più rigenerare quel mondo da zero. Nel database attuale
non ce ne sono: i mondi usano `modern_world_provinces`, `modern_world`, `cold_war_1951`. Va
saputo se un giorno importi un vecchio salvataggio.

### Se vuoi un mondo del 1815 o del 1989 a province complete

Ora non esistono. I due preset eliminati avevano lore e regole curate (3,5 e 4,6 KB di
`preset.json`): la strada è **ricrearli sopra `pax_modern_provinces`**, riusando i loro testi. Il
lavoro è nei contenuti, non nel codice — e i testi sono recuperabili dalla storia di git
(commit precedente all'eliminazione).
