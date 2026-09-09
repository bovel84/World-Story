import React, { useEffect, useMemo, useRef, useState } from 'react';
import { templatesApi, type PresetEditorData, type ScenarioReportView } from '../../services/api';

interface Props {
  /** Preset esistente da aggiornare. */
  templateId?: string;
  /** Preset da usare come punto di partenza per una nuova copia. */
  cloneFromTemplateId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: PresetEditorData = {
  id: '',
  name: '',
  description: '',
  start_date: '1951-01-01',
  country_codes: [],
  base_prompt: 'Definisci la situazione del mondo alla data iniziale: cosa è accaduto, quali forze contano e quale equilibrio può essere spezzato dalle decisioni del giocatore.',
  historical_accuracy: 0.8,
  lore: '',
  simulation_rules: '',
  prompts: {},
  author: '',
  version: '1.0.0',
  map_geojson: null,
};

type EditorTab = 'scenario' | 'mondo' | 'istruzioni' | 'catalogo' | 'mappa';

/** File del catalogo di scenario (M01) con etichette per la checklist. */
const CATALOG_FILES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'manifest', label: 'Manifest', hint: 'id, versione, data, valuta, modalità, dichiarazione' },
  { key: 'polities', label: 'Polities', hint: 'forma di governo datata' },
  { key: 'resources', label: 'Materiali', hint: 'unità, conservazione, trasportabilità' },
  { key: 'technologies', label: 'Tecnologie', hint: 'DAG delle conoscenze' },
  { key: 'recipes', label: 'Ricette', hint: 'input/output, durata, fonti' },
  { key: 'facilities', label: 'Impianti', hint: 'capacità ≠ quantità' },
  { key: 'actors', label: 'Attori', hint: 'EconomicActor per polity' },
  { key: 'authorities', label: 'Autorità R1', hint: 'consensi utente/istituzionale/controparte' },
  { key: 'initial-state', label: 'Stato iniziale', hint: 'tesorerie, lotti, giacimenti, personale, impianti' },
];

const SIMULATION_OVERRIDE_HELP = `Opzionale. Usalo solo se serve una procedura narrativa speciale per questo scenario. Il motore aggiunge comunque i vincoli su causalità, autonomia del giocatore, cronologia e JSON; non è possibile disattivarli.`;

export function PresetEditorModal({ templateId, cloneFromTemplateId, onClose, onSaved }: Props) {
  const [data, setData] = useState<PresetEditorData>(EMPTY);
  const [codes, setCodes] = useState('');
  const [tab, setTab] = useState<EditorTab>('scenario');
  const sourceId = templateId || cloneFromTemplateId;
  const [loading, setLoading] = useState(!!sourceId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // M01 µ4: rapporto del catalogo di scenario per la checklist dell'editor.
  const [scenarioReport, setScenarioReport] = useState<ScenarioReportView | null>(null);
  const [scenarioHasCatalog, setScenarioHasCatalog] = useState(false);
  const mapInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!templateId) { setScenarioReport(null); setScenarioHasCatalog(false); return; }
    templatesApi.getScenarioReport(templateId)
      .then(r => { setScenarioReport(r.report); setScenarioHasCatalog(r.hasCatalog); })
      .catch(() => { setScenarioReport(null); setScenarioHasCatalog(false); });
  }, [templateId]);

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    templatesApi.getEditable(sourceId)
      .then(p => {
        const next = cloneFromTemplateId
          ? { ...p, id: '', name: `${p.name} — copia`, author: '', version: '1.0.0' }
          : p;
        setData({ ...EMPTY, ...next, prompts: next.prompts || {} });
        setCodes((next.country_codes || []).join(', '));
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sourceId, cloneFromTemplateId]);

  const patch = <K extends keyof PresetEditorData>(key: K, value: PresetEditorData[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const patchPrompt = (key: string, value: string) => setData(prev => ({
    ...prev,
    prompts: { ...(prev.prompts || {}), [key]: value },
  }));

  const normalizedCodes = useMemo(
    () => [...new Set(codes.toUpperCase().split(/[\s,;]+/).filter(Boolean))],
    [codes],
  );
  const qualityChecks = useMemo(() => [
    { label: 'Premessa del mondo', ready: data.base_prompt.trim().length >= 60 },
    { label: 'Dossier storico', ready: (data.lore || '').trim().length >= 120 },
    { label: 'Regole vincolanti', ready: (data.simulation_rules || '').trim().length >= 80 },
    { label: 'Paesi giocabili', ready: normalizedCodes.length > 0 },
  ], [data.base_prompt, data.lore, data.simulation_rules, normalizedCodes.length]);

  const readMap = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        throw new Error('Il file deve essere una FeatureCollection GeoJSON');
      }
      patch('map_geojson', parsed);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GeoJSON non valido');
    }
  };

  const save = async () => {
    if (!data.id.trim() || !data.name.trim() || !data.base_prompt.trim() || normalizedCodes.length === 0) {
      setError('Compila ID, nome, paesi giocabili e premessa del mondo.');
      setTab('scenario');
      return;
    }
    setSaving(true);
    setError('');
    const prompts = Object.fromEntries(Object.entries(data.prompts || {})
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value));
    const payload: PresetEditorData = {
      ...data,
      id: data.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_'),
      country_codes: normalizedCodes,
      prompts,
    };
    try {
      if (templateId) await templatesApi.updatePreset(templateId, payload);
      else await templatesApi.createPreset(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const title = templateId ? 'Modifica preset' : cloneFromTemplateId ? 'Crea da un preset' : 'Nuovo preset';

  return (
    <div className="preset-editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="preset-editor" role="dialog" aria-modal="true" aria-label="Costruttore di scenario">
        <header className="preset-editor-header">
          <div>
            <span className="preset-editor-kicker">Costruttore di scenari</span>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="preset-editor-close" aria-label="Chiudi">×</button>
        </header>

        <nav className="preset-editor-tabs" aria-label="Sezioni del preset">
          <button type="button" className={tab === 'scenario' ? 'active' : ''} onClick={() => setTab('scenario')}>1. Scenario</button>
          <button type="button" className={tab === 'mondo' ? 'active' : ''} onClick={() => setTab('mondo')}>2. Mondo</button>
          <button type="button" className={tab === 'istruzioni' ? 'active' : ''} onClick={() => setTab('istruzioni')}>3. Istruzioni IA</button>
          <button type="button" className={tab === 'catalogo' ? 'active' : ''} onClick={() => setTab('catalogo')}>4. Catalogo</button>
          <button type="button" className={tab === 'mappa' ? 'active' : ''} onClick={() => setTab('mappa')}>5. Mappa</button>
        </nav>

        {loading ? <div className="preset-editor-loading">Apertura del dossier…</div> : (
          <div className="preset-editor-body">
            <aside className="preset-quality" aria-label="Completezza del preset">
              <span>Pronto per la simulazione</span>
              <div>{qualityChecks.map(check => <i key={check.label} className={check.ready ? 'ready' : ''}>{check.ready ? '✓' : '○'} {check.label}</i>)}</div>
            </aside>

            {tab === 'scenario' && <>
              <p className="preset-guide">Imposta ciò che il giocatore trova al primo giorno. Questa pagina definisce l’identità del pacchetto e le nazioni disponibili; le cause della storia sono nelle sezioni successive.</p>
              <div className="preset-form-grid">
                <label>ID tecnico <small>minuscole, numeri, _ e -</small><input value={data.id} disabled={!!templateId} onChange={e => patch('id', e.target.value)} placeholder="europa_1914" /></label>
                <label>Nome scenario<input value={data.name} onChange={e => patch('name', e.target.value)} placeholder="Europa 1914" /></label>
                <label>Data iniziale<input type="date" value={data.start_date} onChange={e => patch('start_date', e.target.value)} /></label>
                <label>Fedeltà storica <small>0 = libera · 1 = rigorosa</small><input type="number" min="0" max="1" step="0.05" value={data.historical_accuracy ?? 0.8} onChange={e => patch('historical_accuracy', Number(e.target.value))} /></label>
                <label>Autore<input value={data.author || ''} onChange={e => patch('author', e.target.value)} placeholder="Il tuo nome" /></label>
                <label>Versione<input value={data.version || ''} onChange={e => patch('version', e.target.value)} /></label>
              </div>
              <label>Presentazione per il giocatore<textarea rows={3} value={data.description} onChange={e => patch('description', e.target.value)} placeholder="Due righe per spiegare il conflitto e la promessa del mondo." /></label>
              <label>Paesi giocabili (ISO-A3) <small>separati da virgola: ITA, FRA, DEU</small><textarea rows={3} className="preset-codes" value={codes} onChange={e => setCodes(e.target.value)} /></label>
            </>}

            {tab === 'mondo' && <>
              <p className="preset-guide">Scrivi il canone, non istruzioni tecniche. Il motore usa questi testi come fonte storica prima di narrare il primo evento.</p>
              <label>Premessa canonica <small>Qual è la data, quali fatti hanno già cambiato il mondo e qual è l’equilibrio iniziale?</small><textarea rows={6} value={data.base_prompt} onChange={e => patch('base_prompt', e.target.value)} placeholder="Alla data iniziale…" /></label>
              <label>Dossier storico <small>Blocchi, guerre aperte, crisi, obiettivi delle principali potenze e fatti che non devono essere dimenticati.</small><textarea rows={10} value={data.lore || ''} onChange={e => patch('lore', e.target.value)} placeholder="• Attori e alleanze…&#10;• Conflitti e trattati…&#10;• Risorse, limiti e tensioni…" /></label>
            </>}

            {tab === 'istruzioni' && <>
              <p className="preset-guide">Qui definisci le leggi del mondo. Le istruzioni base di World Story restano sempre attive: causalità, cronologia, nessuna azione autonoma del giocatore, reazioni delle altre politie e cronaca in italiano.</p>
              <label>Regole vincolanti della simulazione <small>Scrivi regole verificabili: cosa è plausibile, cosa richiede tempo, quali attori evitano o cercano un conflitto.</small><textarea rows={11} value={data.simulation_rules || ''} onChange={e => patch('simulation_rules', e.target.value)} placeholder={'1. …\n2. …\n3. …'} /></label>
              <details className="preset-contract">
                <summary>Contratto narrativo applicato automaticamente</summary>
                <ul>
                  <li>Ogni dispaccio deve partire da una causa presente nel canone, nella cronaca, nella diplomazia o nello stato della mappa.</li>
                  <li>Il giocatore agisce solo dopo un suo ordine; le altre politie reagiscono e sviluppano soltanto filoni documentati.</li>
                  <li>Gli esiti sono graduati nel tempo: proposte, preparativi e opere non diventano risultati istantanei.</li>
                  <li>I dispacci indicano attore, data, luogo, decisione e conseguenza concreta; niente crisi o numeri inventati.</li>
                </ul>
              </details>
              <details className="preset-advanced">
                <summary>Override avanzato del narratore IA</summary>
                <p>{SIMULATION_OVERRIDE_HELP}</p>
                <label>Prompt di simulazione personalizzato<textarea rows={8} value={data.prompts?.simulation || ''} onChange={e => patchPrompt('simulation', e.target.value)} placeholder="Usa ${PLAYER_POLITY}, ${ORIGIN_ROUND_DATE}, ${TARGET_ROUND_DATE} e le altre variabili documentate. Lascia vuoto per il narratore standard." /></label>
              </details>
            </>}

            {tab === 'catalogo' && (() => {
              // M01 µ4: checklist, errori per campo, copertura e stato strict.
              const blocking = scenarioReport?.errors.length ?? 0;
              const warnings = scenarioReport?.warnings.length ?? 0;
              const issuesFor = (fileKey: string) =>
                scenarioReport?.errors.filter(e => e.path.startsWith(fileKey)) ?? [];
              return (
                <div className="preset-catalog">
                  <p className="preset-guide">
                    Il catalogo di scenario definisce il mondo materiale: materiali, tecnologie, ricette, impianti, attori e autorità. È immutabile per partita: le modifiche valgono per le NUOVE partite del preset.
                  </p>
                  {!templateId && (
                    <p className="preset-guide">Salva il preset per caricare o validare il catalogo.</p>
                  )}
                  {templateId && !scenarioHasCatalog && (
                    <p className="preset-guide">Questo preset è dichiaratamente legacy: nessun catalogo simulation/. Resta così finché non viene migrato con una NUOVA versione del pacchetto.</p>
                  )}
                  {templateId && scenarioHasCatalog && scenarioReport && (
                    <>
                      <div className={`preset-strict ${blocking > 0 ? 'blocked' : 'ready'}`}>
                        <strong>{blocking > 0 ? `Import strict BLOCCATO: ${blocking} errori` : 'Import strict disponibile'}</strong>
                        <small>{blocking > 0
                          ? 'Nessuna importazione né avvio strict con dati bloccanti irrisolti: correggi gli errori elencati.'
                          : 'Il catalogo è chiuso: filiere giustificate, riferimenti e DAG coerenti.'}</small>
                      </div>
                      <div className="preset-catalog-checklist" role="list">
                        {CATALOG_FILES.map(file => {
                          const fileErrors = issuesFor(file.key);
                          const ready = fileErrors.length === 0;
                          return (
                            <div key={file.key} role="listitem" className={`preset-catalog-item ${ready ? 'ok' : 'broken'}`} aria-label={`${file.label}: ${ready ? 'valido' : `${fileErrors.length} errori`}`}>
                              <strong>{ready ? '✓' : '✗'} {file.label}</strong>
                              <small>{file.hint}</small>
                              {fileErrors.map(e => (
                                <code key={`${e.path}[${e.code}]`}>{e.path} [{e.code}] {e.message}</code>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      <div className="preset-catalog-coverage">
                        <strong>Copertura delle filiere</strong>
                        <small>Giustificate (stock, giacimento estraibile o filiera chiusa): {scenarioReport.coverage.justified.join(', ') || 'nessuna'}</small>
                        <small>Mancanti (richieste senza fonte): {scenarioReport.coverage.missing.join(', ') || 'nessuna'}</small>
                        <small>Giacimenti in stato unknown dichiarato: {scenarioReport.coverage.unknownDeposits}</small>
                      </div>
                      {warnings > 0 && (
                        <div className="preset-catalog-warnings">
                          <strong>Avvisi (dati non fabbricati)</strong>
                          {scenarioReport.warnings.map(w => (
                            <code key={`${w.path}[${w.code}]`}>{w.path} [{w.code}] {w.message}</code>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {tab === 'mappa' && <div className="preset-map-editor">
              <p className="preset-guide">Una mappa personalizzata è facoltativa. Senza file il preset usa la mappa mondiale standard e i paesi indicati sopra.</p>
              <div className="preset-map-drop" onClick={() => mapInput.current?.click()}>
                <span>🗺</span>
                <strong>{data.map_geojson ? `${data.map_geojson.features?.length || 0} province/regioni caricate` : 'Usa la mappa mondiale standard'}</strong>
                <small>Carica un file .geojson con properties.code e, per le province, properties.country</small>
              </div>
              <input ref={mapInput} type="file" accept=".geojson,.json,application/geo+json" hidden onChange={e => readMap(e.target.files?.[0])} />
              <div className="preset-map-actions">
                <button type="button" onClick={() => mapInput.current?.click()}>Scegli GeoJSON</button>
                {data.map_geojson && <button type="button" className="danger" onClick={() => patch('map_geojson', null)}>Rimuovi mappa</button>}
              </div>
            </div>}
          </div>
        )}

        {error && <div className="preset-editor-error" role="alert">{error}</div>}
        <footer className="preset-editor-footer">
          <button type="button" onClick={onClose}>Annulla</button>
          <button type="button" className="primary" onClick={save} disabled={loading || saving}>{saving ? 'Salvataggio…' : templateId ? 'Salva modifiche' : 'Crea preset'}</button>
        </footer>
      </section>
    </div>
  );
}
