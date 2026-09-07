import React, { useEffect, useRef, useState } from 'react';
import { templatesApi, type PresetEditorData } from '../../services/api';

interface Props {
  templateId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: PresetEditorData = {
  id: '', name: '', description: '', start_date: '1951-01-01',
  country_codes: [], base_prompt: 'Simula questo scenario storico alternativo.',
  historical_accuracy: 0.8, lore: '', simulation_rules: '', author: '', version: '1.0.0',
  map_geojson: null,
};

export function PresetEditorModal({ templateId, onClose, onSaved }: Props) {
  const [data, setData] = useState<PresetEditorData>(EMPTY);
  const [codes, setCodes] = useState('');
  const [tab, setTab] = useState<'scenario' | 'narrativa' | 'mappa'>('scenario');
  const [loading, setLoading] = useState(!!templateId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mapInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!templateId) return;
    templatesApi.getEditable(templateId)
      .then(p => { setData(p); setCodes((p.country_codes || []).join(', ')); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [templateId]);

  const patch = <K extends keyof PresetEditorData>(key: K, value: PresetEditorData[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

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
    const normalizedCodes = [...new Set(codes.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (!data.id.trim() || !data.name.trim() || !data.base_prompt.trim() || normalizedCodes.length === 0) {
      setError('Compila ID, nome, paesi e prompt di base.');
      return;
    }
    setSaving(true); setError('');
    const payload = {
      ...data,
      id: data.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_'),
      country_codes: normalizedCodes,
    };
    try {
      if (templateId) await templatesApi.updatePreset(templateId, payload);
      else await templatesApi.createPreset(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="preset-editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="preset-editor" role="dialog" aria-modal="true" aria-label="Editor scenario">
        <header className="preset-editor-header">
          <div>
            <span className="preset-editor-kicker">Archivio scenari</span>
            <h2>{templateId ? 'Modifica preset' : 'Nuovo preset'}</h2>
          </div>
          <button onClick={onClose} className="preset-editor-close" aria-label="Chiudi">×</button>
        </header>

        <nav className="preset-editor-tabs">
          <button className={tab === 'scenario' ? 'active' : ''} onClick={() => setTab('scenario')}>Scenario</button>
          <button className={tab === 'narrativa' ? 'active' : ''} onClick={() => setTab('narrativa')}>Prompt e lore</button>
          <button className={tab === 'mappa' ? 'active' : ''} onClick={() => setTab('mappa')}>Mappa</button>
        </nav>

        {loading ? <div className="preset-editor-loading">Apertura del dossier…</div> : (
          <div className="preset-editor-body">
            {tab === 'scenario' && <>
              <div className="preset-form-grid">
                <label>ID tecnico<input value={data.id} disabled={!!templateId} onChange={e => patch('id', e.target.value)} placeholder="europa_1914" /></label>
                <label>Nome scenario<input value={data.name} onChange={e => patch('name', e.target.value)} placeholder="Europa 1914" /></label>
                <label>Data iniziale<input type="date" value={data.start_date} onChange={e => patch('start_date', e.target.value)} /></label>
                <label>Accuratezza storica<input type="number" min="0" max="1" step="0.05" value={data.historical_accuracy ?? 0.8} onChange={e => patch('historical_accuracy', Number(e.target.value))} /></label>
                <label>Autore<input value={data.author || ''} onChange={e => patch('author', e.target.value)} /></label>
                <label>Versione<input value={data.version || ''} onChange={e => patch('version', e.target.value)} /></label>
              </div>
              <label>Descrizione<textarea rows={3} value={data.description} onChange={e => patch('description', e.target.value)} /></label>
              <label>Codici paese ISO-A3 <small>separati da virgola, es. ITA, FRA, DEU</small>
                <textarea rows={3} className="preset-codes" value={codes} onChange={e => setCodes(e.target.value)} />
              </label>
            </>}

            {tab === 'narrativa' && <>
              <label>Prompt base<textarea rows={7} value={data.base_prompt} onChange={e => patch('base_prompt', e.target.value)} /></label>
              <label>Lore del mondo<textarea rows={7} value={data.lore || ''} onChange={e => patch('lore', e.target.value)} /></label>
              <label>Regole della simulazione<textarea rows={7} value={data.simulation_rules || ''} onChange={e => patch('simulation_rules', e.target.value)} /></label>
            </>}

            {tab === 'mappa' && <div className="preset-map-editor">
              <div className="preset-map-drop" onClick={() => mapInput.current?.click()}>
                <span>🗺</span>
                <strong>{data.map_geojson ? `${data.map_geojson.features?.length || 0} province/regioni caricate` : 'Usa la mappa mondiale standard'}</strong>
                <small>Carica un file .geojson con properties.code e, per le province, properties.country</small>
              </div>
              <input ref={mapInput} type="file" accept=".geojson,.json,application/geo+json" hidden onChange={e => readMap(e.target.files?.[0])} />
              <div className="preset-map-actions">
                <button onClick={() => mapInput.current?.click()}>Scegli GeoJSON</button>
                {data.map_geojson && <button className="danger" onClick={() => patch('map_geojson', null)}>Rimuovi mappa</button>}
              </div>
            </div>}
          </div>
        )}

        {error && <div className="preset-editor-error">{error}</div>}
        <footer className="preset-editor-footer">
          <button onClick={onClose}>Annulla</button>
          <button className="primary" onClick={save} disabled={loading || saving}>{saving ? 'Salvataggio…' : templateId ? 'Salva modifiche' : 'Crea preset'}</button>
        </footer>
      </section>
    </div>
  );
}
