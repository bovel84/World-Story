# Standard dei Filoni del Preset — v1

> **Stato:** standard v1, **consegnato** (H00–H03). Codice: `backend-nest/src/scenario/storylines.ts`.
> **Base:** `main` @ `7dc6525`. Documento di riferimento del piano: `docs/STORIE_DEL_MONDO_E_PRESET.md`.
> **Additivo:** un preset **senza** `storylines.json` resta valido e si comporta come prima.

---

## 1. Cos'è un filone

Un **filone** è un nodo della storia che il preset sceglie di **fissare**: il disarmo di Hamas,
la questione di Gerusalemme. Dà **significato e trigger**, **mai numeri**, e vive **per partita**
(il preset è identico per tutti; ogni partita ha la sua storia).

Un filone **non è** un fatto canonico: è un **seme autorevole** del preset, **subordinato allo
stato del motore** (gerarchia: `STATO CORRENTE > STORIA DELLA PARTITA > FILONE > STORIA REALE`).

---

## 2. Dove vive

`backend-nest/data/presets/<id>/storylines.json` — **opzionale**.

Lo standard vive in **cinque sedi**, e tutte devono conoscerlo perché sia davvero uno standard
(un file che lo zip scarta non è uno standard):

| # | Sede | File |
|---|---|---|
| 1 | Validazione e lettura | `scenario/storylines.ts`, `utils/preset-loader.ts` |
| 2 | Trasporto (export/import) | `utils/preset-zip.ts` |
| 3 | Autoring (preset futuri) | `routes/presets.routes.ts` |
| 4 | Verifica di conformità | `tests/storylines-conformance.test.ts` |
| 5 | Specifica (questo documento) | `docs/STANDARD_FILONI_PRESET.md` |

---

## 3. La forma

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
      "summary": "Israele e gli Stati Uniti premono per il disarmo; l'Autorità Palestinese è
                  divisa; la questione di Gerusalemme resta il nodo politico e religioso.",
      "trajectory": "Se nessuno lo devia, il nodo scivola verso lo scontro aperto entro l'anno.",
      "triggers": ["attentato o raid su una provincia contesa", "pressione diplomatica USA sull'ANP"],
      "active_from": "2000-01-01",
      "active_until": null
    }
  ]
}
```

### Campi del file

| Campo | Obbligatorio | Vincolo |
|---|---|---|
| `version` | **sì** | intero, deve valere `1` (o meno) |
| `as_of` | no | data `YYYY-MM-DD` |
| `storylines` | **sì** | array (può essere vuoto) |

### Campi di un filone

| Campo | Obbligatorio | Vincolo |
|---|---|---|
| `id` | **sì** | kebab-case, unico nel preset — chiave dell'obiettivo NPC e della cronaca |
| `title` | **sì** | stringa non vuota |
| `domain` | **sì** | una **sedia del gabinetto**: `tesoro, lavori, istruzione, sanita, esteri, interno, guerra` |
| `parties` | **sì** | array non vuoto di **id di mappa** (non `country_codes`) |
| `region` | no | stringa non vuota |
| `state` | **sì** | `aperto` \| `congelato` \| `risolto` \| `divergente` |
| `pressure` | **sì** | intero 1–3 (1 marginale, 2 rilevante, 3 critico) |
| `summary` | **sì** | significato del filone — **mai numeri** |
| `trajectory` | no | **tendenza**, non profezia (vedi §5) |
| `triggers` | **sì** | array non vuoto di stringhe |
| `active_from` | no | data `YYYY-MM-DD`; il filone è dormiente prima |
| `active_until` | no | data `YYYY-MM-DD`; oltre, il filone non si apre |

`domain` è derivato da `CABINET_SEATS` (`core/government/Cabinet.ts`): **non** esiste una seconda
lista di sedie. Se il gabinetto cambia, lo standard lo segue (e un test lo difende).

---

## 4. Le regole dello standard

1. **Il filone dà significato e trigger, mai numeri** (invariante H-I1). Le cifre restano del motore.
2. **`parties` sono id di mappa.** Un filone può nominare una polity che non è nei `country_codes`
   (la Palestina ha 32 province e non è «consigliata» nel Millennium).
3. **Il filone non è un fatto** (§1): subordinato allo stato.
4. **Zero filoni è valido.** Un preset può dichiararne zero.
5. **Il file è additivo.** Assente → nessun filone, nessun errore.
6. **Un filone malformato è bloccante.** Il file, se presente, deve essere conforme: un errore
   silenzioso produrrebbe un mondo senza la trama che l'autore credeva di aver scritto.
7. **Un campo ignoto è un refuso**, non un'aggiunta: il validatore lo segnala.

---

## 5. `trajectory` — tendenza, non profezia

`trajectory` dice **dove il nodo andava** se nessuno lo deviava. È il futuro **come default**:

- **gli NPC la seguono** (il mondo va avanti in modo riconoscibile);
- **il giocatore la devia** (le sue scelte cambiano il corso, il mondo reagisce);
- **la partita la sostituisce** col tempo (dopo anni conta solo la storia giocata).

Regola netta (invariante H-I12): è una **tendenza**, **mai un fatto** narrato al giocatore.
Vietato «nel 2001 accadrà X»; ammesso «il mondo sta scivolando verso X». E **il motore non gioca
al posto del giocatore**: non gli fa accadere ciò che la storia reale gli attribuisce (H-I13).

---

## 6. Conformità e trasporto

- **Conformità**: `tests/storylines-conformance.test.ts` passa **tutti** i preset reali; chi ha il
  file deve validare.
- **Trasporto**: `preset-zip.ts` include `storylines.json` in export e import. Round-trip senza
  perdita (invariante H-I8). Un file malformato in import è **rifiutato prima di scrivere su
  disco** (non si lascia una cartella che il loader rifiuterà).
- **Autoring**: il contratto IA (`routes/presets.routes.ts`) chiede i filoni e ne accetta solo di
  conformi; un filone malformato proposto dall'IA viene scartato, non causa un errore.

---

## 7. Esempio buono, esempio cattivo

**Buono** — significato, nessun numero, polity di mappa, tendenza:

```jsonc
{ "id": "cecenia-seconda-guerra", "title": "La Cecenia", "domain": "guerra",
  "parties": ["RUS"], "region": "Caucaso settentrionale", "state": "aperto", "pressure": 2,
  "summary": "Mosca combatte la seconda guerra in Cecenia contro la resistenza separatista.",
  "trajectory": "Se nessuno la devia, la guerriglia logora Mosca per anni.",
  "triggers": ["atto di guerriglia", "operazione di rastrellamento"] }
```

**Cattivo** — contiene numeri (viola H-I1), `domain` non è una sedia, `parties` vuote:

```jsonc
{ "id": "Cecenia!", "title": "Cecenia", "domain": "militare",
  "parties": [], "state": "in corso", "pressure": 5,
  "summary": "Mosca schiera 90.000 uomini e perde 200 carri al mese.", "triggers": [] }
```

---

## 8. Invarianti (difese da test)

`H-I1` una cifra un posto · `H-I2` il filone non è un fatto · `H-I6` zero è valido ·
`H-I7` retrocompatibilità (file assente) · `H-I8` non si perde in viaggio (round-trip) ·
`H-I9` una partita, una storia · `H-I10` la nazione è conosciuta a prescindere dal preset ·
`H-I11` il filone vince sui nodi del preset · `H-I12` la traiettoria non è una profezia ·
`H-I13` il motore non gioca al posto del giocatore · `H-I14` la storia della partita batte la
traiettoria.

---

## 9. Cosa questo standard **non** fa (ancora)

Lo standard **dichiara** i filoni; **non li fa ancora avanzare**, **non li propone** al Consulente,
**non li racconta** e **non li semina in partita**. Sono le fasi successive del piano
(`STORIE_DEL_MONDO_E_PRESET.md`): H04 (semina e avanzamento), H05 (situazione iniziale della
nazione), H06 (traiettoria), H07 (Consulente e proposte), H08 (policy), H09 (narrazione),
H10 (Millennium come caso di riferimento).

E **non scrive i contenuti al posto tuo**: i preset esistenti non hanno filoni. Lo standard
garantisce che quando li scrivi, **funzionino ovunque** — presenti e futuri.
