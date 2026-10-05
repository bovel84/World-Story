/**
 * World Story — Texture narrativa dei dispacci (WS-NARR-DISPATCH-PAX-QUALITY)
 * ==========================================================================
 * Blocco **opzionale**, spento di default (`narrative.texture`). Aggiunge tre
 * cose al prompt compatto e allo standard:
 *
 *  1. la possibilità di nominare figure ed eventi **documentati** dell'epoca e
 *     del canone, senza mai inventare citazioni, cifre o nomi non documentati;
 *  2. una **regola di varietà delle aperture**, perché due dispacci consecutivi
 *     non inizino con la stessa struttura;
 *  3. **due esempi originali** di buon dispaccio (scritti per questo gioco, non
 *     copiati da altri), lunghi quanto `EVENT_BODY_WORDS`.
 *
 * Non introduce fatti nuovi e non cambia il motore: è solo testo di prompt.
 */
import { EVENT_BODY_WORDS } from '../immersion';

/**
 * Due dispacci di esempio, originali. Restano sul generico (nessun nome reale,
 * nessun numero) proprio per mostrare *come* raccontare, non *cosa* è accaduto:
 * il modello deve attingere i fatti dal contesto, non dagli esempi.
 */
export const NARRATIVE_TEXTURE_EXAMPLES: readonly string[] = [
  'Il ministero del Commercio sospende il rilascio delle licenze di export dopo che tre delegazioni straniere hanno disertato il tavolo negoziale: la misura entra in vigore entro il mese e riapre la questione delle scorte di grano, finora rinviata.',
  'La guarnigione di frontiera riceve l’ordine di arretrare di due giornate di marcia: ufficiali e sindaci locali protestano, il comando giustifica la mossa con la necessità di accorciare le linee, ma il confine resta ora esposto a un’incursione rapida.',
];

/**
 * Regola di varietà: l'harness di qualità misura quanto le aperture dei
 * dispacci siano diverse fra loro, quindi qui si chiede esplicitamente di
 * variarle e di non ripetere la stessa struttura.
 */
export const OPENING_VARIETY_RULE = `- Varia l'apertura dei dispacci. Non iniziare due eventi consecutivi con la stessa struttura: alterna l'attacco sull'azione, sulla conseguenza, su un dettaglio di luogo o su una dichiarazione. Evita di ripetere la formula «<nazione> annuncia/decide/ordina» per ogni evento.`;

export function buildNarrativeTextureBlock(): string {
  return `
[TEXTURE NARRATIVA — figure ed eventi documentati]
- Nei preset storici puoi nominare figure ed eventi DOCUMENTATI dell'epoca e del canone (un capo di Stato in carica, un trattato realmente firmato, una crisi già nota alla data di gioco): rendono il mondo vivo senza inventare nulla.
- Resta il divieto assoluto di inventare citazioni, cifre, nomi o episodi non documentati: se un nome o un numero non è nel contesto fornito o nella storia reale dell'epoca, non attribuirglielo. Meglio un dispaccio senza nome che un nome falso.
- Ogni evento resta lungo quanto prescritto (${EVENT_BODY_WORDS}).

[VARIETÀ DELLE APERTURE]
${OPENING_VARIETY_RULE}

[ESEMPI ORIGINALI DI BUON DISPACCIO — imita lo stile, non copiare i fatti]
1. ${NARRATIVE_TEXTURE_EXAMPLES[0]}
2. ${NARRATIVE_TEXTURE_EXAMPLES[1]}`;
}
