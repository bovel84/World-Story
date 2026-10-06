/**
 * V03 — le otto schede diventano quattro sezioni dense
 * =====================================================
 * Diagnosi e decisione: `docs/RIORGANIZZAZIONE_DOSSIER_STILE_VICTORIA3.md` §3.
 * La mappatura è **obbligatoria**: un blocco che non trova posto è il segnale
 * che la sezione è progettata male, non che serve una quinta scheda.
 *
 * Il test legge il sorgente con `fs` + regex (ambiente `node`, senza render) e
 * confronta la mappa blocchi→sezioni con quella del piano. Ha la guardia contro
 * il falso verde: il totale dei blocchi contati deve essere quello misurato —
 * se il parser si rompe, il test fallisce invece di passare a vuoto.
 *
 * Conteggio: `DossierBlock` interni al dossier = 26. Le schede **vive**
 * (`NationalDossierLive`) non sono `DossierBlock`: portano le cifre attuali vs
 * Turno 0 e sostituiscono le vecchie card duplicate. Due blocchi del vecchio
 * schedario erano già usciti (V01: «Sfide del momento»; D-1: «Oggetti del
 * paese»); il consolidamento del Dossier vivo ne ha rimossi altri cinque
 * («Coesione interna», «Tecnologie sbloccate», «Capitale umano», «Flussi
 * mensili», «Arsenale») e ha fuso le metriche residue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const DOCK = read('NationDock.tsx');
const STORE = read('../../stores/nationDock.ts');

/**
 * I blocchi `<DossierBlock>` con il loro titolo, nella sezione in cui stanno.
 * Si leggono i **soli** `title` che appartengono a un `<DossierBlock>`: un
 * `<BudgetBreakdown title="…">` è un sotto-blocco di «Composizione del
 * bilancio», non una card a sé — contarlo farebbe apparire «Entrate mensili»
 * come un blocco non mappato.
 */
function blocksBySection(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sections = [...source.matchAll(/\{active === '(\w+)' && \(/g)];
  for (let i = 0; i < sections.length; i++) {
    const name = sections[i][1];
    const start = sections[i].index ?? 0;
    const end = i + 1 < sections.length ? (sections[i + 1].index ?? source.length) : source.length;
    const body = source.slice(start, end);
    const titles: string[] = [];
    // Ogni blocco: da `<DossierBlock` fino al suo `</DossierBlock>`, e solo il
    // primo `title="…"` che vi compare dentro.
    for (const block of body.matchAll(/<DossierBlock[\s\S]*?<\/DossierBlock>/g)) {
      const t = /title="([^"]+)"/.exec(block[0]);
      if (t) titles.push(t[1]);
    }
    out.set(name, titles);
  }
  return out;
}

/** La mappatura obbligatoria del piano (§3), come titoli attesi per sezione. */
const EXPECTED: Record<string, string[]> = {
  situazione: ['Indicatori di tenuta', 'Crisi della nazione', 'Decisioni richieste'],
  regno: [
    'Quadro del governo', 'Consiglio dei ministri',
    'Assetto istituzionale', 'Politica fiscale', 'Investimento nel popolo',
  ],
  tesoro: [
    'Quadro economico', 'Debito pubblico: scadenze e nuove emissioni', 'Composizione del bilancio',
    'Quadro di risorse e industria', 'Ritmo del mese: produzione e consumo', 'Direttive attive',
    'Risorse naturali', 'Territorio e fonti della capacità', 'Progetti e processi',
  ],
  statoMaggiore: [
    'Quadro delle forze armate',
    'Quanto hai e quanto produci', "Forza dell'arsenale", 'Peso dei domini',
    'Produzione in corso', 'Produzione e acquisti',
    // Da Situazione (estero) e da Cassa (sforzo bellico): V03 li raccoglie qui.
    'Strategie delle potenze', 'Impegni della partita', 'Pressione militare',
  ],
};

describe('V03 — il dossier ha quattro sezioni, mappate obbligatoriamente', () => {
  const bySection = blocksBySection(DOCK);

  it('esistono esattamente le quattro sezioni del piano', () => {
    expect([...bySection.keys()]).toEqual(['situazione', 'regno', 'tesoro', 'statoMaggiore']);
    // Lo store dichiara lo stesso elenco: la navigazione e il dock non possono
    // divergere su quante sezioni esistono.
    expect(STORE).toMatch(/NATION_SECTIONS:\s*NationSection\[\]\s*=\s*\[\s*'situazione',\s*'regno',\s*'tesoro',\s*'statoMaggiore',?\s*\]/);
  });

  it('la guardia vede davvero i blocchi (26 nel dossier)', () => {
    const total = [...bySection.values()].reduce((n, titles) => n + titles.length, 0);
    // Conteggio per sezione: 3 + 5 + 9 + 9 = 26. Cinque blocchi hanno lasciato il
    // dossier nel consolidamento (vedi l'intestazione); le schede vive portano le
    // cifre attuali vs Turno 0. Se il parser si rompe, qui si vede subito.
    expect(total, 'il parser non vede i 26 blocchi del dossier').toBe(26);
    expect(bySection.get('situazione')?.length).toBe(3);
    expect(bySection.get('regno')?.length).toBe(5);
    expect(bySection.get('tesoro')?.length).toBe(9);
    expect(bySection.get('statoMaggiore')?.length).toBe(9);
  });

  it('ogni blocco sta nella sezione che il piano gli assegna', () => {
    for (const [section, expectedTitles] of Object.entries(EXPECTED)) {
      const found = bySection.get(section) ?? [];
      for (const title of expectedTitles) {
        expect(found, `«${title}» dovrebbe stare in «${section}»`).toContain(title);
      }
    }
    // Nessun blocco imprevisto in nessuna sezione: la mappa è esatta, non un
    // insieme-minimo. Le sorprese qui dentro sono il segnale che qualcuno ha
    // aggiunto una card senza aggiornare il piano.
    for (const [section, found] of bySection) {
      const extra = found.filter(t => !(EXPECTED[section] ?? []).includes(t));
      expect(extra, `blocchi non mappati in «${section}»: ${extra.join(', ')} — aggiorna il piano §3 o sposta il blocco`)
        .toEqual([]);
    }
  });

  it('nessuna sezione è un’anticamera: ognuna ne tiene almeno due', () => {
    // Il difetto misurato nel piano (§1.2): «Progetti» aveva un blocco solo,
    // «Governo» due. La riorganizzazione deve densità, non altre ante vuote.
    for (const [section, titles] of bySection) {
      expect(
        titles.length,
        `«${section}» ha ${titles.length} blocco/blocchi: troppo poco per una scheda`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('la sala operativa non è più un blocco del dossier (D-1)', () => {
    // D-1: «Oggetti del paese» è uscito per il pannello Forze. Se ricompare qui,
    // il dossier torna a contenere un blocco che agisce — la cosa che V01–V05
    // e D-1 hanno tolto.
    const allTitles = [...bySection.values()].flat();
    expect(allTitles).not.toContain('Oggetti del paese: esercito, impianti, cantieri, marina');
  });

  it('il vecchio vocabolario è sparito dalla navigazione', () => {
    // Né id né etichette delle otto schede possono restare nello store.
    for (const old of ['governo', 'progetti', 'bilancio', 'risorse', 'armamenti', 'conoscenze', 'politiche']) {
      expect(STORE, `lo store cita ancora la sezione «${old}»`).not.toMatch(new RegExp(`'${old}'`));
    }
  });
});
