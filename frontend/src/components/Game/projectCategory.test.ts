import { describe, expect, it } from 'vitest';
import { classifyProject, groupProjectsByCategory, projectCategoryLabel } from './projectCategory';

describe('projectCategory — categorie dei progetti nazionali', () => {
  it('riconosce le categorie dalle parole chiave di titolo e riassunto', () => {
    expect(classifyProject('Costruzione della ferrovia transnazionale').key).toBe('infrastructure');
    expect(classifyProject('Mobilitazione di nuove formazioni terrestri').key).toBe('military');
    expect(classifyProject('Apertura di una acciaieria nel bacino').key).toBe('economy');
    expect(classifyProject('Programma di ricerca sui reattori').key).toBe('research');
    expect(classifyProject('Nuovo ospedale regionale').key).toBe('society');
    expect(classifyProject('Trattato di cooperazione con il vicino').key).toBe('diplomacy');
  });

  it('usa il riassunto quando il titolo non basta, e «Altro» nel dubbio', () => {
    expect(classifyProject('Piano decennale', 'Comprende la posa di un oleodotto').key).toBe('infrastructure');
    expect(classifyProject('Iniziativa', 'Un provvedimento amministrativo').key).toBe('other');
    expect(classifyProject(undefined, undefined).key).toBe('other');
  });

  it('raggruppa per categoria nell’ordine di presentazione, senza mutare l’input', () => {
    const projects = [
      { id: 'a', title: 'Ricerca sui vaccini', summary: '' },
      { id: 'b', title: 'Costruzione di un ponte', summary: '' },
      { id: 'c', title: 'Riarmo delle brigate', summary: '' },
      { id: 'd', title: 'Ammiccamento istituzionale', summary: '' },
    ];
    const groups = groupProjectsByCategory(projects);
    expect(groups.map(g => g.category.key)).toEqual(['military', 'infrastructure', 'research', 'other']);
    expect(groups.find(g => g.category.key === 'military')!.projects.map(p => p.id)).toEqual(['c']);
    // L'input non viene riordinato né mutato.
    expect(projects.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('non classifica come Difesa un progetto civile che cita «riserva»', () => {
    // Regressione: «mantenendo la riserva di 46,03…» finiva sotto Difesa.
    expect(classifyProject(
      'Aumentiamo l\'estrazione di petrolio dai giacimenti nazionali',
      'vendendo l\'eccedenza, mantenendo la riserva di 46,03 unità come margine',
    ).key).toBe('economy');
    expect(classifyProject(
      'Destiniamo parte delle riserve di ricerca ai laboratori applicati',
      'puntando su energia e trasformazione delle risorse locali',
    ).key).not.toBe('military');
    expect(classifyProject('Nuovi laboratori di ricerca sui vaccini').key).toBe('research');
  });

  it('riconosce comunque i termini militari non ambigui', () => {
    expect(classifyProject('Esercitazione congiunta delle forze di terra').key).toBe('military');
    expect(classifyProject('Richiamo alle armi dei riservisti della riserva').key).toBe('military');
    expect(classifyProject('Potenziamento della Marina da guerra').key).toBe('military');
  });

  it('espone etichette leggibili', () => {
    expect(projectCategoryLabel('military')).toBe('Difesa');
    expect(projectCategoryLabel('infrastructure')).toBe('Infrastrutture');
  });
});
