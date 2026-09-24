/**
 * Dossier — «una cifra, un posto» (D01 del piano di chiarezza).
 *
 * `stores/nationDock.ts` **dichiara** l'invariante:
 *
 *   > Ogni cifra compare in una sola sezione: le infrastrutture stanno in
 *   > Risorse, il denaro in Cassa, il combattente in Armamenti.
 *
 * e l'implementazione la violava: otto metriche comparivano in due sezioni,
 * due di esse in tre. Questo file rende l'invariante un **contratto
 * verificabile** — il test che mancava e che ha permesso la deriva.
 *
 * Non basta vietare le ripetizioni: alcune sono legittime e vanno distinte.
 *
 *  - **sintesi + dettaglio** (Tesoreria in «Situazione» e in «Cassa»): il
 *    modello di prodotto approvato le vuole entrambe, purché siano lo **stesso**
 *    numero e la sintesi non lo nasconda;
 *  - **cose diverse con lo stesso nome**: era il caso di «Scorte armi» (scorte
 *    attuali in Risorse, capacità del magazzino in Armamenti) e delle tre
 *    metriche di «Direttive attive» che portavano i nomi degli indici ma
 *    mostravano l'effetto dei modificatori.
 *
 * Il test legge il sorgente del componente: le metriche sono dati, non
 * comportamento, e il modo per difendere un'invariante di struttura è
 * verificarla sulla struttura.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, 'NationDock.tsx'),
  'utf8',
);

/** Le sezioni del dossier, nell'ordine dello store. */
const SECTIONS = [
  'situazione', 'governo', 'progetti', 'bilancio', 'risorse', 'armamenti', 'conoscenze', 'politiche',
] as const;

interface Occurrence {
  section: string;
  card: string;
  label: string;
  /** È un **rimando** a un'altra sezione (la metrica è cliccabile). */
  isLink: boolean;
  /** Sezione verso cui il rimando porta, quando dichiarata. */
  targets: string | null;
}

/**
 * Tutte le metriche del dossier, con la sezione e la card che le contengono.
 * La sezione è dedotta dalla guardia `active === '…'` più vicina a monte; la
 * card dal titolo `DossierBlock`/`title=` più vicino a monte.
 */
function metricOccurrences(source: string): Occurrence[] {
  const out: Occurrence[] = [];
  const sectionsAt: Array<{ pos: number; name: string }> = [];
  for (const match of source.matchAll(/active === '(\w+)'/g)) {
    sectionsAt.push({ pos: match.index ?? 0, name: match[1] });
  }
  const sectionAt = (pos: number): string => {
    let current = '?';
    for (const entry of sectionsAt) {
      if (entry.pos <= pos) current = entry.name;
      else break;
    }
    return current;
  };
  const cardAt = (pos: number): string => {
    const titles = [...source.slice(0, pos).matchAll(/(?:title)="([^"]{3,60})"/g)];
    return titles.length ? titles[titles.length - 1][1] : '?';
  };

  // Le metriche possono essere scritte su una riga o su più righe.
  for (const match of source.matchAll(/<Metric\b([\s\S]*?)\/>/g)) {
    const body = match[1];
    const label = /label="([^"]*)"/.exec(body);
    if (!label) continue;
    const pos = match.index ?? 0;
    const target = /openSection\('(\w+)'\)/.exec(body);
    out.push({
      section: sectionAt(pos),
      card: cardAt(pos),
      label: label[1],
      isLink: /onClick=/.test(body),
      targets: target ? target[1] : null,
    });
  }
  return out;
}

/** Raggruppa per etichetta conservando le occorrenze. */
function byLabel(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const list = map.get(occurrence.label) ?? [];
    list.push(occurrence);
    map.set(occurrence.label, list);
  }
  return map;
}

describe('D01 — una cifra, un posto', () => {
  const occurrences = metricOccurrences(SOURCE);
  const grouped = byLabel(occurrences);

  it('il test vede davvero le metriche (non passa a vuoto)', () => {
    // Una guardia contro il falso verde: se il parser si rompe, questo fallisce.
    expect(occurrences.length).toBeGreaterThan(40);
    for (const occurrence of occurrences) {
      expect(SECTIONS, `sezione non riconosciuta per «${occurrence.label}»`)
        .toContain(occurrence.section);
      expect(occurrence.card, `card non riconosciuta per «${occurrence.label}»`).not.toBe('?');
    }
  });

  /**
   * Le ripetizioni ammesse sono di **due** tipi, entrambi dichiarati:
   *
   *  - la **sintesi** (sezione `situazione`) di una cifra che il dettaglio
   *    spiega altrove — il modello di prodotto approvato;
   *  - il **rimando**: la metrica compare in un'altra sezione come copia
   *    *cliccabile* che porta dove la cifra è spiegata. Non è una seconda
   *    verità: è lo stesso numero, con un percorso verso il contesto.
   *
   * Qualunque altra duplicazione è la violazione che questo test difende.
   */
  const SUMMARY_PAIRS: Array<{ label: string; sections: string[] }> = [
    { label: 'Tesoreria', sections: ['situazione', 'bilancio'] },
    { label: 'Saldo mensile', sections: ['situazione', 'bilancio'] },
  ];

  it('nessuna metrica è ricopiata: le ripetizioni sono sintesi o rimandi', () => {
    for (const [label, list] of grouped) {
      const sections = [...new Set(list.map(entry => entry.section))];
      if (sections.length <= 1) continue;

      const summary = SUMMARY_PAIRS.find(entry => entry.label === label);
      if (summary) {
        expect(sections.sort(), `«${label}»: sintesi e dettaglio attesi`).toEqual([...summary.sections].sort());
        continue;
      }

      // Non è una sintesi: allora le occorrenze eccedenti devono essere rimandi,
      // e una sola deve essere la copia canonica (quella non cliccabile).
      const canonical = list.filter(entry => !entry.isLink);
      const links = list.filter(entry => entry.isLink);
      expect(
        canonical.length,
        `«${label}» compare in ${sections.length} sezioni (${sections.join(', ')}) `
        + `con ${canonical.length} copie canoniche: serve una sola copia, le altre `
        + 'devono essere rimandi (Metric onClick)',
      ).toBe(1);
      expect(links.length, `«${label}»: le occorrenze eccedenti devono essere rimandi`).toBeGreaterThan(0);
    }
  });

  it('ogni rimando porta alla sezione dove la cifra è spiegata', () => {
    // Un rimando che punta altrove è peggio di nessun rimando: promette il
    // contesto e consegna un altro posto.
    for (const [label, list] of grouped) {
      const canonical = list.find(entry => !entry.isLink);
      if (!canonical) continue;
      for (const link of list.filter(entry => entry.isLink)) {
        expect(
          link.targets,
          `«${label}» in ${link.section}: rimando senza destinazione dichiarata`,
        ).not.toBeNull();
        expect(
          link.targets,
          `«${label}» in ${link.section} rimanda a «${link.targets}», `
          + `ma la cifra è spiegata in «${canonical.section}»`,
        ).toBe(canonical.section);
      }
    }
  });

  it('nessuna metrica compare due volte nella stessa card', () => {
    for (const [label, list] of grouped) {
      const withinCard = new Map<string, number>();
      for (const entry of list) {
        const key = `${entry.section}/${entry.card}`;
        withinCard.set(key, (withinCard.get(key) ?? 0) + 1);
      }
      for (const [where, count] of withinCard) {
        expect(count, `«${label}» ripetuta ${count} volte in ${where}`).toBe(1);
      }
    }
  });

  it('nessuna etichetta dichiara un indice quando mostra l\'effetto di un modificatore', () => {
    /**
     * Il difetto reale: in «Direttive attive» le metriche si chiamavano
     * «Stabilità», «Tensione sociale», «Sforzo bellico» ma mostravano
     * `resources.modifiers.*` — l'effetto sul modificatore, non l'indice. Stesso
     * nome, numero diverso: la cosa peggiore per chi legge.
     */
    const modifierMetrics = [...SOURCE.matchAll(/<Metric\b([\s\S]*?)label="([^"]*)"([\s\S]*?)\/>/g)]
      .filter(match => /resources\?\.modifiers\?\./.test(match[3]));
    expect(modifierMetrics.length, 'nessuna metrica sui modificatori trovata').toBeGreaterThan(0);
    for (const match of modifierMetrics) {
      expect(
        match[2],
        `«${match[2]}» mostra un modificatore: l'etichetta deve dirlo («Effetto su …»)`,
      ).toMatch(/^effetto /i);
    }
  });

  it('l\'etichetta «Spesa militare» non è usata due volte per lo stesso numero', () => {
    // Era il caso della quota di difesa, ripetuta in due card della stessa
    // sezione: la voce di spesa e il costo dell'apparato sono la stessa cifra.
    const defence = grouped.get('Spesa militare') ?? [];
    expect(defence.length, '«Spesa militare» non ha più una duplicazione').toBe(1);
  });

  it('le metriche-rimando dichiarano dove portano', () => {
    // Un rimando senza etichetta accessibile è un vicolo cieco per la tastiera.
    const links = [...SOURCE.matchAll(/<Metric\b([\s\S]*?)onClick=\{[\s\S]*?\}([\s\S]*?)\/>/g)];
    for (const link of links) {
      const combined = link[1] + link[2];
      expect(combined, 'una metrica-rimando senza hint').toMatch(/hint=/);
    }
  });
});

describe('D02 — ogni cifra ha un giudizio', () => {
  /**
   * Un numero nudo non è un'informazione: «Tesoreria 12,4» non dice se va bene,
   * «12,4 mld su 28 di entrate» sì. L'invariante I2 del piano pretende che ogni
   * metrica abbia **un tono** (bene/male/attenzione) oppure **un rapporto** che
   * la renda interpretabile — di norma entrambi.
   *
   * Le metriche puramente descrittive (forma di governo, territorio) non hanno
   * un bene/male: proprio per questo hanno bisogno del rapporto, che è l'unica
   * cosa che le rende leggibili. La regola vale per tutte, senza eccezioni.
   */
  it('nessuna metrica è un numero nudo', () => {
    const naked: string[] = [];
    for (const match of SOURCE.matchAll(/<Metric\b([\s\S]*?)\/>/g)) {
      const body = match[1];
      const label = /label="([^"]*)"/.exec(body);
      if (!label) continue;
      const hasTone = /\btone=/.test(body);
      const hasRatio = /\bhint=/.test(body);
      if (!hasTone && !hasRatio) naked.push(label[1]);
    }
    expect(
      naked,
      `metriche senza tono né rapporto: ${naked.join(', ')} — `
      + 'ogni cifra deve dire se è un problema, quanto pesa, o a cosa si riferisce',
    ).toEqual([]);
  });

  it('il test riconosce tono e rapporto quando ci sono (non passa a vuoto)', () => {
    // Guardia contro il falso verde: se il parser smettesse di vedere gli
    // attributi, il test precedente passerebbe per il motivo sbagliato.
    const metrics = [...SOURCE.matchAll(/<Metric\b([\s\S]*?)\/>/g)];
    const withTone = metrics.filter(m => /\btone=/.test(m[1])).length;
    const withHint = metrics.filter(m => /\bhint=/.test(m[1])).length;
    expect(withTone).toBeGreaterThan(20);
    expect(withHint).toBeGreaterThan(20);
  });
});

describe('D07 — nessuna card spiega invece di mostrare', () => {
  /**
   * `NationDock` conteneva card il cui scopo era **spiegare** come leggere i
   * numeri anziché dare i numeri: «Come si legge l'arsenale», «Sala di governo».
   * È il sintomo di un difetto di gerarchia — quando la conclusione non è
   * visibile si aggiunge una legenda.
   *
   * La spiegazione non sparisce: va dove serve, cioè nel **rapporto** che
   * accompagna la cifra (I2, difeso dai test di D02) o in un richiudibile.
   * Ciò che non deve esistere è una card che occupa la schermata a ogni
   * apertura per dire come si legge un'altra card.
   */
  it('nessun titolo di card è un\'istruzione di lettura', () => {
    const titles = [...SOURCE.matchAll(/title="([^"]+)"/g)].map(match => match[1]);
    const didactic = titles.filter(title => /^come si legge/i.test(title));
    expect(
      didactic,
      `titoli didattici in card: ${didactic.join(', ')} — la spiegazione va nel `
      + 'rapporto della cifra o in un richiudibile, non in una card',
    ).toEqual([]);
  });

  it('le spiegazioni necessarie esistono ancora, in un richiudibile', () => {
    // La cura non è cancellare la conoscenza: è spostarla.
    expect(SOURCE).toMatch(/<summary>Come si legge l&apos;arsenale<\/summary>/);
    // E sta in un `<details>`: chiusa per default, raggiungibile.
    const details = [...SOURCE.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]);
    expect(details.some(block => /Come si legge l&apos;arsenale/.test(block))).toBe(true);
  });

  it('i pesi di dominio restano visibili: sono dati, non spiegazioni', () => {
    // I pesi entrano nella formula della forza: servono a leggere le cifre,
    // quindi restano in una card, non dietro un richiudibile.
    expect(SOURCE).toMatch(/title="Peso dei domini"/);
    expect(SOURCE).toMatch(/arms-domains/);
  });

  it('nessun blocco interattivo è finito dentro un richiudibile per errore', () => {
    // `ObjectsBoard` è una sala operativa (crea reparti, impartisce ordini):
    // richiuderla la renderebbe scomoda, e non è una spiegazione. Il test
    // protegge la distinzione fatta in D07.
    const details = [...SOURCE.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]);
    for (const block of details) {
      expect(block, 'un blocco interattivo non va chiuso in un `<details>`')
        .not.toMatch(/<ObjectsBoard/);
    }
  });
});
