/**
 * Open-Pax — LLMSettingsModal
 * ===========================
 * Menu di scelta del modello IA: preset dei provider (Ollama Cloud/locale,
 * OpenRouter, NVIDIA, MiniMax, Anthropic, endpoint OpenAI-compatibili),
 * caricamento dell'elenco modelli dal provider, verifica di connessione e
 * salvataggio della configurazione (hot reload del backend).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  llmApi,
  type LLMProviderPreset,
  type LLMConfigView,
  type LLMModelItem,
  type LLMStatusMechanicInfo,
} from '../../services/api';

export interface LLMSettingsModalProps {
  /** Visibilità della modale */
  open: boolean;
  /** Chiusura senza salvare */
  onClose: () => void;
  /** Chiamata dopo un salvataggio riuscito (config aggiornata) */
  onSaved?: (config: LLMConfigView, status: Record<string, LLMStatusMechanicInfo>) => void;
}

/** Messaggio d'errore leggibile dalla risposta dell'API. */
function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const marker = raw.indexOf(' - ');
  const payload = marker >= 0 ? raw.slice(marker + 3) : raw;
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.error) return String(parsed.error);
  } catch { /* testo non JSON: usiamo il messaggio grezzo */ }
  return payload || 'Operazione non riuscita.';
}

export function LLMSettingsModal({ open, onClose, onSaved }: LLMSettingsModalProps) {
  const [providers, setProviders] = useState<LLMProviderPreset[]>([]);
  const [config, setConfig] = useState<LLMConfigView | null>(null);
  const [status, setStatus] = useState<Record<string, LLMStatusMechanicInfo>>({});

  const [presetId, setPresetId] = useState('custom');
  const [provider, setProvider] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [models, setModels] = useState<LLMModelItem[]>([]);
  const [modelsWarning, setModelsWarning] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const preset = useMemo(
    () => providers.find(p => p.id === presetId) || null,
    [providers, presetId],
  );

  // All'apertura: carica preset + config corrente e precompila il form
  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setModels([]);
    setModelsWarning('');
    setApiKey('');
    (async () => {
      try {
        const [prov, cfg, st] = await Promise.all([
          llmApi.providers(),
          llmApi.config(),
          llmApi.status(),
        ]);
        setProviders(prov.providers || []);
        setConfig(cfg);
        setStatus(st.mechanics || {});

        const current = cfg.default;
        const match = prov.providers.find(p =>
          p.provider === current.provider
          && p.baseUrl && p.baseUrl.replace(/\/+$/, '') === current.baseUrl.replace(/\/+$/, ''));
        const effectivePreset = matchPresetOrDefault(match, prov.providers);
        setPresetId(effectivePreset.id);
        setProvider(current.provider || 'openai-compatible');
        setBaseUrl(current.baseUrl || '');
        setModel(current.model || '');
        const nextOverrides: Record<string, string> = {};
        for (const [m, info] of Object.entries(cfg.mechanics)) {
          if (info.overridden) nextOverrides[m] = info.model;
        }
        setOverrides(nextOverrides);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [open]);

  // Cambio preset: precompila base URL / modello, svuota l'elenco modelli
  const applyPreset = (id: string) => {
    const p = providers.find(x => x.id === id);
    setPresetId(id);
    setModels([]);
    setModelsWarning('');
    setTestResult(null);
    if (!p) return;
    setProvider(p.provider);
    if (p.id !== 'custom' && p.baseUrl) setBaseUrl(p.baseUrl);
    if (p.defaultModel) setModel(p.defaultModel);
    if (!p.needsKey) setApiKey('');
  };

  const loadModels = async () => {
    if (provider !== 'minimax' && !baseUrl.trim()) {
      setError('Indica prima la Base URL del provider.');
      return;
    }
    setLoadingModels(true);
    setError('');
    try {
      const result = await llmApi.models({
        provider,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      setModels(result.models || []);
      setModelsWarning(result.warning || '');
      if (!result.warning && (result.models || []).length === 0) {
        setModelsWarning('Nessun modello restituito: puoi comunque scriverlo a mano.');
      }
    } catch (e) {
      setModels([]);
      setError(errorMessage(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async () => {
    if (!model.trim() || (!baseUrl.trim() && provider !== 'anthropic' && provider !== 'minimax')) {
      setError('Servono Base URL e modello per la verifica.');
      return;
    }
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      const result = await llmApi.test({
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
      });
      setTestResult({ ok: true, text: `Risposta: ${result.reply} (${result.latencyMs} ms)` });
    } catch (e) {
      setTestResult({ ok: false, text: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!model.trim()) {
      setError('Scegli o scrivi il nome del modello.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // La chiave vive nel BROWSER (localStorage) e viene inviata al server
      // solo in memoria (persistApiKey: false → mai scritta su disco).
      const typedKey = apiKey.trim();
      if (typedKey) {
        localStorage.setItem('openpax_llm_apikey', typedKey);
      }
      const effectiveKey = typedKey || localStorage.getItem('openpax_llm_apikey') || '';
      const result = await llmApi.save({
        default: {
          provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: effectiveKey || undefined,
        },
        mechanics: Object.fromEntries(
          Object.entries(overrides)
            .filter(([, model]) => model && model !== '__default__')
            .map(([mechanic, model]) => [mechanic, { model }]),
        ),
        persistApiKey: false,
      });
      onSaved?.(result, result.status.mechanics);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const mechanicNames = config ? Object.keys(config.mechanics) : [];

  return (
    <div className="llm-modal-overlay" onClick={onClose}>
      <div
        className="llm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Modello IA"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="llm-modal-header">
          <div>
            <h3>Modello IA</h3>
            <p className="llm-modal-subtitle">
              Scegli il provider e il modello usato dalla simulazione, dai chat e dal consigliere.
            </p>
          </div>
          <button className="llm-modal-close" onClick={onClose} title="Chiudi" aria-label="Chiudi">✕</button>
        </div>

        <div className="llm-modal-body">
          {error && <div className="llm-modal-error" role="alert">{error}</div>}

          <label className="llm-field-label">Provider</label>
          <div className="llm-provider-grid">
            {(providers.length > 0 ? providers : FALLBACK_PROVIDERS).map(p => (
              <button
                key={p.id}
                type="button"
                className={`llm-provider-chip${presetId === p.id ? ' selected' : ''}`}
                onClick={() => applyPreset(p.id)}
                title={p.description}
              >
                <span className="llm-provider-name">{p.label}</span>
                {p.needsKey && <span className="llm-provider-key">🔑</span>}
              </button>
            ))}
          </div>
          {preset?.description && <p className="llm-preset-hint">{preset.description}</p>}
          {preset?.needsKey && preset.docsUrl && (
            <p className="llm-preset-hint">
              Serve una API key —{' '}
              <a href={preset.docsUrl} target="_blank" rel="noreferrer">ottienila qui</a>.
            </p>
          )}

          <label className="llm-field-label" htmlFor="llm-base-url">Base URL</label>
          <input
            id="llm-base-url"
            className="llm-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://ollama.com/v1"
            spellCheck={false}
          />

          <label className="llm-field-label" htmlFor="llm-api-key">API key</label>
          <input
            id="llm-api-key"
            className="llm-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config?.default.apiKeySet
                ? `•••••••• (salvata${config.default.apiKeySource === 'env' ? ' via env' : config.default.apiKeySource === 'browser' ? ' nel browser' : ''}) — lascia vuoto per conservarla`
                : preset?.needsKey ? 'Chiave API del provider' : 'Opzionale'
            }
            autoComplete="off"
          />

          <label className="llm-field-label" htmlFor="llm-model">Modello</label>
          <div className="llm-model-row">
            <input
              id="llm-model"
              className="llm-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="es. gpt-oss:20b"
              list="llm-model-options"
              spellCheck={false}
            />
            <button
              type="button"
              className="llm-secondary-btn"
              onClick={loadModels}
              disabled={loadingModels}
              title="Scarica l'elenco dei modelli dal provider"
            >
              {loadingModels ? 'Carico…' : '⟳ Carica modelli'}
            </button>
          </div>
          <datalist id="llm-model-options">
            {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
          </datalist>
          {models.length > 0 && (
            <select
              className="llm-input llm-model-select"
              value={models.some(m => m.id === model) ? model : ''}
              onChange={(e) => e.target.value && setModel(e.target.value)}
              aria-label="Scegli tra i modelli disponibili"
            >
              <option value="" disabled>{models.length} modelli disponibili — seleziona…</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name ? `${m.name} (${m.id})` : m.id}</option>
              ))}
            </select>
          )}
          {modelsWarning && <p className="llm-warning">{modelsWarning}</p>}

          <details className="llm-advanced">
            <summary>Avanzato: modello per meccanica</summary>
            {mechanicNames.map(m => {
              const info = status[m];
              return (
                <div key={m} className="llm-mechanic-row">
                  <span className="llm-mechanic-name" title={info ? `${info.provider} · ${info.baseUrl}` : m}>
                    {m}
                    {config?.mechanics[m]?.overridden ? ' •' : ''}
                  </span>
                  <select
                    value={overrides[m] || '__default__'}
                    onChange={(e) => setOverrides(prev => ({ ...prev, [m]: e.target.value }))}
                  >
                    <option value="__default__">Come predefinito {config?.default.model ? `(${config.default.model})` : ''}</option>
                    {models.map(mm => (
                      <option key={mm.id} value={mm.id}>{mm.id}</option>
                    ))}
                    {overrides[m] && !models.some(mm => mm.id === overrides[m]) && (
                      <option value={overrides[m]}>{overrides[m]}</option>
                    )}
                  </select>
                </div>
              );
            })}
            <p className="llm-preset-hint">Le meccaniche marcate con • usano già un modello dedicato.</p>
          </details>

          {testResult && (
            <div className={`llm-test-result ${testResult.ok ? 'ok' : 'fail'}`} role="status">
              {testResult.ok ? '✓ ' : '✕ '}{testResult.text}
            </div>
          )}

          {status.jump && (
            <p className="llm-current">
              Attivo: <strong>{status.jump.model}</strong> via {status.jump.provider}
            </p>
          )}
        </div>

        <div className="llm-modal-footer">
          <button
            type="button"
            className="llm-secondary-btn"
            onClick={runTest}
            disabled={testing || saving || !model.trim()}
          >
            {testing ? 'Verifico…' : '⚡ Verifica modello'}
          </button>
          <div className="llm-footer-spacer" />
          <button type="button" className="llm-cancel-btn" onClick={onClose}>Annulla</button>
          <button
            type="button"
            className="llm-save-btn"
            onClick={save}
            disabled={saving || !model.trim()}
          >
            {saving ? 'Salvo…' : 'Salva e usa'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fallback se l'endpoint /providers non risponde: almeno i principali. */
const FALLBACK_PROVIDERS: LLMProviderPreset[] = [
  { id: 'ollama-cloud', label: 'Ollama Cloud', provider: 'openai-compatible', baseUrl: 'https://ollama.com/v1', needsKey: true },
  { id: 'ollama-local', label: 'Ollama locale', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'nvidia', label: 'NVIDIA NIM', provider: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', needsKey: true },
  { id: 'minimax', label: 'MiniMax', provider: 'minimax', baseUrl: 'https://api.minimax.io/v1', needsKey: true },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { id: 'custom', label: 'Altro (OpenAI-compatible)', provider: 'openai-compatible', baseUrl: '', needsKey: false },
];

function matchPresetOrDefault(match: LLMProviderPreset | undefined, all: LLMProviderPreset[]): LLMProviderPreset {
  return match || all.find(p => p.id === 'custom') || { id: 'custom', label: 'Custom', provider: 'openai-compatible', baseUrl: '', needsKey: false };
}

export default LLMSettingsModal;