/** Filtro difensivo per cronache legacy o payload SSE di server precedenti. */
export function publicNarrativeText(value: unknown, playerPolityName?: string): string {
  const nation = String(playerPolityName || '').trim() || 'la nazione controllata';
  let text = String(value || '').trim();
  if (!text) return '';

  text = text
    .replace(/\bPlayer Polity\b/gi, nation)
    .replace(/\bthe player\b/gi, nation)
    .replace(/\bPlayer\b/gi, nation)
    .replace(/\bdell['’]utente\b/gi, `del governo di ${nation}`)
    .replace(/\bdell?\s+giocatore\b/gi, `del governo di ${nation}`)
    .replace(/\bdal\s+giocatore\b/gi, `dal governo di ${nation}`)
    .replace(/\bal\s+giocatore\b/gi, `al governo di ${nation}`)
    .replace(/\bil\s+giocatore\b/gi, nation)
    .replace(/\b(?:giocatore|utente)\b/gi, nation)
    .replace(/\s*\[(?:[A-Z]{2,5}|(?:action|project|sourceAction|simulation|run|event)Id\s*[:=][^\]]+)\]/g, '')
    .replace(/\s*\([A-Z]{2,3}\)/g, '')
    .replace(/\b(?:action|project|sourceAction|simulation|run|event)Id\s*[:=#]?\s*[A-Za-z0-9_-]+\b/gi, '')
    .replace(/\b(?=[a-f0-9]{10,}\b)[a-f0-9]*[a-f][a-f0-9]*\b/gi, '')
    .replace(/\(?\bturno\s+#?\d+\b\)?/gi, 'nel periodo')
    .replace(/\bDati del motore alla data\s+\d{4}-\d{2}-\d{2}:?\s*/gi, '')
    .replace(/\bNel monitoraggio settimanale il motore registra\b/gi, 'Nel monitoraggio settimanale,')
    .replace(/\bSono stime del modello economico, non nuovi eventi politici\.?/gi, '')
    .replace(/\bcheckpoint\b/gi, 'passaggio confermato')
    .replace(/\bsimulazione\b/gi, 'cronaca')
    .replace(/\bmodello economico\b/gi, 'quadro economico')
    .replace(/\bmapChanges\b/g, 'cambiamenti territoriali')
    .replace(/\bactionOutcomes?\b/g, 'esiti')
    .replace(/\bcounterAction\b/g, 'misura annunciata')
    .replace(/\btargetDate\b/g, 'data prevista')
    .replace(/\bvoided\b/g, 'annullato');

  const countryNames: Record<string, string> = {
    'United States': 'Stati Uniti', 'United Kingdom': 'Regno Unito',
    'Saudi Arabia': 'Arabia Saudita', 'United Arab Emirates': 'Emirati Arabi Uniti',
    'South Korea': 'Corea del Sud', 'North Korea': 'Corea del Nord',
    Germany: 'Germania', Turkey: 'Turchia', Israel: 'Israele', Palestine: 'Palestina',
    Poland: 'Polonia', Hungary: 'Ungheria', Greece: 'Grecia', Egypt: 'Egitto',
    Jordan: 'Giordania', Lebanon: 'Libano', Syria: 'Siria', China: 'Cina',
    Japan: 'Giappone', Russia: 'Russia', Spain: 'Spagna', France: 'Francia',
    Italy: 'Italia', Netherlands: 'Paesi Bassi', Czechia: 'Cechia', Ukraine: 'Ucraina',
  };
  for (const [raw, italian] of Object.entries(countryNames)) {
    text = text.replace(new RegExp(`\\b${raw}\\b`, 'gi'), italian);
  }
  text = text.replace(/\bPartecipanti:\s*([^\.\n]+)\.\s*([^:\.\n]+):/gi,
    'Alla riunione prendono parte $1. $2 dichiara:');

  const labels: Record<string, string> = {
    neutral: 'neutrale', supportive: 'favorevole', opposed: 'contraria',
    conditional: 'condizionata', hostile: 'ostile', ally: 'alleata',
    accepted: 'accolta', partial: 'parziale', rejected: 'respinta',
    counterparty: 'controparte', mediator: 'mediatrice', observer: 'osservatrice',
  };
  for (const [raw, label] of Object.entries(labels)) {
    text = text.replace(new RegExp(`\\b${raw}\\b`, 'gi'), label);
  }
  return text.replace(/[ \t]+([,.;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}
