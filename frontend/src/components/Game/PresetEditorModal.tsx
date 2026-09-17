import React, { useEffect, useMemo, useRef, useState } from 'react';
import { countriesApi, templatesApi, type NativeMapInfo, type PresetEditorData, type PresetMapBase, type PresetMapDetail, type ScenarioReportView } from '../../services/api';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { detectGroupingKeys, effectiveProvinceMap, hasProvinceFeatures, mapDetailOptionDisabled, nativeMapMissingCodes, requiredCountryCodes } from './mapGrouping';

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

/** Livelli di dettaglio della mappa e relativa disponibilità. */
const MAP_DETAIL_OPTIONS: Array<{ value: PresetMapDetail; label: string; hint: string }> = [
  { value: 'nations', label: 'Solo nazioni', hint: 'Una regione per paese' },
  { value: 'grouped', label: 'Regioni raggruppate', hint: 'Poche regioni per paese' },
  { value: 'full', label: 'Massimo dettaglio', hint: 'Una regione per provincia' },
];

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
  const [assisting, setAssisting] = useState(false);
  const [aiBrief, setAiBrief] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const [error, setError] = useState('');
  // M01 µ4: rapporto del catalogo di scenario per la checklist dell'editor.
  const [scenarioReport, setScenarioReport] = useState<ScenarioReportView | null>(null);
  const [scenarioHasCatalog, setScenarioHasCatalog] = useState(false);
  // MAP-NATIVE: catalogo delle mappe native scegliibili (fetch read-only).
  const [nativeMaps, setNativeMaps] = useState<NativeMapInfo[]>([]);
  // Registro dei codici paese noti al motore (per la compatibilità mappa/paesi).
  const [knownCodes, setKnownCodes] = useState<string[]>([]);
  const mapInput = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    templatesApi.getNativeMaps()
      .then(r => setNativeMaps(r.maps || []))
      .catch(() => setNativeMaps([]));
    countriesApi.getAll()
      .then(r => setKnownCodes((r.countries || []).map(c => c.code)))
      .catch(() => setKnownCodes([]));
  }, []);

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

  const assistWithAi = async () => {
    if (!aiBrief.trim() && !data.name.trim() && !data.base_prompt.trim()) {
      setError('Descrivi lo scenario che vuoi creare, anche in poche righe.');
      return;
    }
    setAssisting(true);
    setError('');
    setAiNotice('');
    try {
      const { preset } = await templatesApi.assistPreset(aiBrief.trim(), {
        ...data,
        country_codes: normalizedCodes,
      });
      setData(prev => ({
        ...prev,
        ...preset,
        // Un preset già salvato mantiene sempre il proprio identificatore.
        id: templateId ? prev.id : (preset.id || prev.id),
        prompts: prev.prompts,
        author: prev.author,
        version: prev.version,
        map_geojson: prev.map_geojson,
      }));
      if (preset.country_codes?.length) setCodes(preset.country_codes.join(', '));
      setAiNotice('Bozza preparata. Controlla e modifica ogni sezione prima di salvarla.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'L’assistente IA non è disponibile.');
    } finally {
      setAssisting(false);
    }
  };

  const hasOwnMap = !!data.map_geojson;
  const ownProvinceMap = useMemo(() => hasProvinceFeatures(data.map_geojson), [data.map_geojson]);
  // MAP-NATIVE: mappa nativa scelta. Finché il catalogo non è caricato ci si
  // fida del valore del preset (prodotto dal backend con la stessa whitelist).
  const selectedBase: PresetMapBase = useMemo(() => {
    const raw = data.map_base;
    if (!raw) return 'standard';
    if (nativeMaps.length === 0) return raw;
    return nativeMaps.some(m => m.id === raw) ? raw : 'standard';
  }, [data.map_base, nativeMaps]);
  const selectedNative = nativeMaps.find(m => m.id === selectedBase);
  // Compatibilità mappa/paesi: la generazione richiede geometria per ogni
  // politia. `requiredCodes` sono i codici che producono davvero una politia
  // (override `countries` oppure filtrati sul registro). Se il registro non è
  // disponibile non si blocca nulla.
  const compatibilityReady = knownCodes.length > 0;
  const requiredCodes = useMemo(
    () => requiredCountryCodes(normalizedCodes, (data.countries || []).map(c => c.code), knownCodes) ?? [],
    [normalizedCodes, data.countries, knownCodes],
  );
  const missingByMap = useMemo(() => {
    const out = new Map<PresetMapBase, string[]>();
    if (compatibilityReady) {
      for (const m of nativeMaps) out.set(m.id, nativeMapMissingCodes(requiredCodes, m.codes));
    }
    return out;
  }, [compatibilityReady, nativeMaps, requiredCodes]);
  const selectedMissing = hasOwnMap ? [] : (missingByMap.get(selectedBase) ?? []);
  const mapIncompatible = compatibilityReady && !hasOwnMap && selectedMissing.length > 0;
  // La mappa provinciale effettiva: il file proprio vince sulla mappa nativa.
  const provinceMap = effectiveProvinceMap(hasOwnMap, ownProvinceMap, selectedNative?.hasProvinces ?? false);
  const activeMapLabel = hasOwnMap
    ? `file caricato (${data.map_geojson?.features?.length || 0} regioni)`
    : (selectedNative?.label ?? 'Mappa mondiale standard');
  // Livello effettivo mostrato: il default rispecchia il comportamento attuale
  // (mappa provinciale → full, altrimenti nations).
  const effectiveDetail: PresetMapDetail = data.map_detail && (provinceMap || data.map_detail === 'nations')
    ? data.map_detail
    : (provinceMap ? 'full' : 'nations');
  // Gerarchie reali suggerite dalla mappa: quelle del file proprio, oppure
  // quelle note per la mappa nativa provinciale selezionata.
  const groupingKeys = useMemo(() => (hasOwnMap && provinceMap ? detectGroupingKeys(data.map_geojson) : []), [hasOwnMap, provinceMap, data.map_geojson]);
  const grouping = (data.map_grouping || '').trim();
  // Avviso non bloccante: la chiave dichiarata non è una delle gerarchie rilevate.
  const groupingUnknown = !!grouping && groupingKeys.length > 0 && !groupingKeys.includes(grouping);

  const save = async () => {
    if (!data.id.trim() || !data.name.trim() || !data.base_prompt.trim() || normalizedCodes.length === 0) {
      setError('Compila ID, nome, paesi giocabili e premessa del mondo.');
      setTab('scenario');
      return;
    }
    if (mapIncompatible) {
      setError(`La mappa «${selectedNative?.label ?? selectedBase}» non contiene la geometria per: ${selectedMissing.join(', ')}. Scegli un'altra mappa nativa o rimuovi quei paesi.`);
      setTab('mappa');
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
      // Senza mappa provinciale resta disponibile solo «Solo nazioni».
      map_detail: provinceMap ? effectiveDetail : 'nations',
      // Mappa nativa di riferimento: il file proprio, se presente, ha la precedenza.
      map_base: selectedBase,
      // Vuoto = raggruppamento automatico (gerarchia nota o geografico).
      map_grouping: provinceMap && grouping ? grouping : '',
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
    <AccessibleDialog
      open={true}
      onClose={onClose}
      overlayClassName="preset-editor-backdrop"
      className="preset-editor"
      ariaLabelledBy="preset-editor-title"
      initialFocusRef={closeButtonRef}
    >
        <header className="preset-editor-header">
          <div>
            <span className="preset-editor-kicker">Costruttore di scenari</span>
            <h2 id="preset-editor-title">{title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="preset-editor-close" aria-label="Chiudi">×</button>
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

            <section className="preset-ai-assistant" aria-labelledby="preset-ai-title">
              <div className="preset-ai-heading">
                <div>
                  <span>Assistente scenarista</span>
                  <strong id="preset-ai-title">Dall’idea a una bozza completa</strong>
                </div>
                <button type="button" onClick={assistWithAi} disabled={assisting || loading}>
                  {assisting ? 'Preparazione…' : (data.name.trim() ? 'Migliora con IA' : 'Crea con IA')}
                </button>
              </div>
              <textarea
                rows={3}
                value={aiBrief}
                onChange={event => setAiBrief(event.target.value)}
                placeholder="Esempio: Europa nel 1914, crisi di luglio già iniziata, diplomazia rigorosa e mobilitazioni lente…"
                aria-label="Idea per l’assistente IA"
              />
              <small>L’IA propone nome, paesi, premessa, dossier e regole. Nulla viene salvato finché non confermi.</small>
              {aiNotice && <p className="preset-ai-notice" role="status" aria-live="polite">{aiNotice}</p>}
            </section>

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
              <p className="preset-map-intro">Scegli una <strong>mappa nativa</strong> del gioco: non serve caricare file. Le mappe provinciali rendono disponibili i livelli «Regioni raggruppate» e «Massimo dettaglio».</p>
              <fieldset className="preset-map-base">
                <legend>Mappa nativa</legend>
                {nativeMaps.length === 0 && (
                  <label className="preset-map-base-option selected">
                    <input type="radio" name="preset-map-base" checked readOnly />
                    <span className="preset-map-base-text">
                      <strong>Mappa mondiale standard</strong>
                      <small>Una regione per paese · predefinita</small>
                    </span>
                    <i className="preset-map-base-check" aria-hidden="true">✓</i>
                  </label>
                )}
                {nativeMaps.map(m => {
                  const missing = missingByMap.get(m.id) ?? [];
                  const selected = !hasOwnMap && selectedBase === m.id;
                  const disabled = hasOwnMap || missing.length > 0;
                  return (
                    <label key={m.id} className={`preset-map-base-option${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
                      <input
                        type="radio"
                        name="preset-map-base"
                        value={m.id}
                        checked={selected}
                        disabled={hasOwnMap || missing.length > 0}
                        onChange={() => patch('map_base', m.id)}
                      />
                      <span className="preset-map-base-text">
                        <strong>{m.label}</strong>
                        <small>
                          {m.hasProvinces ? 'Mappa provinciale' : 'Una regione per paese'}
                          {m.id === 'standard' ? ' · predefinita' : ''}
                          {missing.length > 0 ? ` · non copre: ${missing.join(', ')}` : ''}
                        </small>
                      </span>
                      <em className="preset-map-base-badge">{m.features}<small>{m.hasProvinces ? 'province' : 'paesi'}</small></em>
                      <i className="preset-map-base-check" aria-hidden="true">✓</i>
                    </label>
                  );
                })}
                {hasOwnMap && <p className="preset-guide warning">Il file <code>map.geojson</code> caricato ha la precedenza sulla mappa nativa. Rimuovilo per usare una mappa nativa.</p>}
                {mapIncompatible && <p className="preset-guide warning">La mappa selezionata non contiene la geometria per: <strong>{selectedMissing.join(', ')}</strong>. Scegli una mappa compatibile o rimuovi quei paesi.</p>}
                <div className="preset-map-summary" role="status" aria-live="polite">
                  <span className="preset-map-summary-item"><small>Mappa attiva</small><strong>{activeMapLabel}</strong></span>
                  <span className="preset-map-summary-item"><small>Livello</small><strong>{effectiveDetail}</strong></span>
                </div>
              </fieldset>
              <details className="preset-map-advanced">
                <summary>Opzione avanzata: carica un GeoJSON proprio</summary>
                <p className="preset-map-advanced-hint">Una mappa personalizzata è facoltativa; se caricata ha la precedenza sulla mappa nativa.</p>
                <div className="preset-map-drop" onClick={() => mapInput.current?.click()}>
                  <span>🗺</span>
                  <strong>{data.map_geojson ? `${data.map_geojson.features?.length || 0} province/regioni caricate` : 'Nessun file caricato'}</strong>
                  <small>Carica un file .geojson con properties.code e, per le province, properties.country</small>
                </div>
                <input ref={mapInput} type="file" accept=".geojson,.json,application/geo+json" hidden onChange={e => readMap(e.target.files?.[0])} />
                <div className="preset-map-actions">
                  <button type="button" onClick={() => mapInput.current?.click()}>Scegli GeoJSON</button>
                  {data.map_geojson && <button type="button" className="danger" onClick={() => patch('map_geojson', null)}>Rimuovi mappa</button>}
                </div>
              </details>
              {/* Niente `disabled` sul fieldset: disabiliterebbe tutti i radio.
                  Ogni radio ha la sua condizione, così «Solo nazioni» resta
                  selezionabile anche senza mappa provinciale. */}
              <fieldset className="preset-map-detail">
                <legend>Dettaglio della mappa</legend>
                {MAP_DETAIL_OPTIONS.map(option => {
                  const selected = effectiveDetail === option.value;
                  const disabled = mapDetailOptionDisabled(provinceMap, option.value);
                  return (
                    <label key={option.value} className={`preset-map-detail-option${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
                      <input
                        type="radio"
                        name="preset-map-detail"
                        value={option.value}
                        checked={effectiveDetail === option.value}
                        disabled={mapDetailOptionDisabled(provinceMap, option.value)}
                        onChange={() => patch('map_detail', option.value)}
                      />
                      <span className="preset-map-detail-text"><strong>{option.label}</strong><small>{option.hint}</small></span>
                      <i className="preset-map-detail-check" aria-hidden="true">✓</i>
                    </label>
                  );
                })}
                {!provinceMap && <p className="preset-guide">Senza una mappa provinciale (con <code>properties.country</code>) è disponibile solo «Solo nazioni».</p>}
              </fieldset>
              {provinceMap && <fieldset className="preset-map-detail preset-map-grouping" disabled={effectiveDetail !== 'grouped'}>
                <legend>Raggruppamento delle province</legend>
                <label htmlFor="preset-map-grouping">Proprietà della gerarchia</label>
                <input
                  id="preset-map-grouping"
                  list="preset-map-grouping-keys"
                  value={data.map_grouping || ''}
                  placeholder="Automatico (criterio geografico)"
                  onChange={e => patch('map_grouping', e.target.value)}
                />
                <datalist id="preset-map-grouping-keys">
                  {groupingKeys.map(key => <option key={key} value={key} />)}
                </datalist>
                <p className="preset-guide">
                  {effectiveDetail !== 'grouped'
                    ? 'Disponibile con «Regioni raggruppate».'
                    : groupingKeys.length > 0
                      ? <>Proprietà rilevate sulla mappa: {groupingKeys.map(key => <code key={key}>{key}</code>)}. Lascia vuoto per il raggruppamento geografico automatico.</>
                      : 'Nessuna gerarchia rilevata: le province verranno raggruppate geograficamente. Aggiungi una proprietà (es. region) al GeoJSON per un raggruppamento storico personalizzato.'}
                </p>
                {groupingUnknown && <p className="preset-guide warning">«{grouping}» non è tra le proprietà rilevate: verrà ignorata e si userà il criterio automatico.</p>}
              </fieldset>}
            </div>}
          </div>
        )}

        {error && <div className="preset-editor-error" role="alert">{error}</div>}
        <footer className="preset-editor-footer">
          <button type="button" onClick={onClose}>Annulla</button>
          <button type="button" className="primary" onClick={save} disabled={loading || saving}>{saving ? 'Salvataggio…' : templateId ? 'Salva modifiche' : 'Crea preset'}</button>
        </footer>
    </AccessibleDialog>
  );
}
