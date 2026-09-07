/**
 * Open-Pax — Template Selector Component
 * ======================================
* Permette di scegliere template/scenario del mondo prima di iniziare la partita.
* Fase 5: preset come pacchetti — badge della fonte, icone delle funzionalità,
* esportazione in zip e importazione del preset da archivio zip.
 */

import React, { useState, useEffect, useRef } from 'react';
import { templatesApi } from '../../services/api';
import type { TemplateInfo } from '../../services/api';
import type { WorldTemplate } from '../../types';
import { PresetEditorModal } from './PresetEditorModal';

interface TemplateSelectorProps {
  onSelect: (template: WorldTemplate) => void;
  onBack: () => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelect, onBack }) => {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ templateId?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await templatesApi.list();
      setTemplates(response.templates);
      setError(null);
    } catch (e) {
      console.error('[TemplateSelector] Failed to load templates:', e);
      setError('Impossibile caricare gli scenari');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (templateId: string) => {
    try {
      const template = await templatesApi.get(templateId);
      onSelect(template);
    } catch (e) {
      console.error('[TemplateSelector] Failed to load template:', e);
      setError('Impossibile caricare i dettagli dello scenario');
    }
  };

  /** Esporta il preset in zip — stopPropagation, così il clic non seleziona il template */
  const handleExport = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    try {
      await templatesApi.exportPreset(templateId);
    } catch (err) {
      console.error('[TemplateSelector] Errore esportazione scenario:', err);
      setImportError(`Errore esportazione: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Clic su «Importa scenario» — apriamo il selettore file nascosto */
  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  /** File scelto — lo inviamo al server; azzeriamo value per poter riscegliere lo stesso file */
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await doImport(file, false);
  };

/** Import vero e proprio; in caso di conflitto (EXISTS) — confirm e retry con overwrite */
  const doImport = async (file: File, overwrite: boolean): Promise<void> => {
    setImporting(true);
    setImportError(null);
    try {
      const result = await templatesApi.importPreset(file, overwrite);
      await loadTemplates();
      // Il preset importato lo selezioniamo subito — è il motivo per cui l'abbiamo importato
      await handleSelect(result.template.id);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'EXISTS' && !overwrite) {
        // 409 — il preset esiste già: chiediamo conferma della sovrascrittura
        setImporting(false);
        if (window.confirm('Scenario già esistente. Sovrascrivere?')) {
          await doImport(file, true);
        }
        return;
      }
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="template-selector">
        <div className="loading">Apertura dell’archivio scenari…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="template-selector">
        <div className="error">{error}</div>
        <button className="btn-primary" onClick={loadTemplates}>Riprova</button>
      </div>
    );
  }

  return (
    <div className="template-selector">
      <div className="selector-header">
        <button className="btn-back" onClick={onBack}>← Indietro</button>
        <h2>Scegli lo scenario</h2>
        <div className="import-controls">
          <button className="btn-new-preset" onClick={() => setEditor({})}>
            ＋ Nuovo preset
          </button>
          <button
            className="btn-import"
            onClick={handleImportClick}
            disabled={importing}
          >
            {importing ? (
              <>
                <span className="import-spinner" />
                Importa…
              </>
            ) : (
              '📦 Importa scenario'
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleFileChosen}
          />
        </div>
      </div>

      {importError && (
        <div className="import-error">{importError}</div>
      )}

      <div className="template-grid">
        {templates.map(template => (
          <div
            key={template.id}
            className="template-card"
            onClick={() => handleSelect(template.id)}
          >
            <div className="template-card-actions">
              <button
                className="template-edit-btn"
                title="Modifica preset"
                onClick={(e) => { e.stopPropagation(); setEditor({ templateId: template.id }); }}
              >
                ✎
              </button>
              <button
                className="template-export-btn"
                title="Esporta zip"
                onClick={(e) => handleExport(e, template.id)}
              >
                ⬇
              </button>
            </div>
            <div className="template-card-top">
              <div className="template-name">{template.name}</div>
              <span className={`template-badge ${template.source === 'preset' ? 'preset' : 'legacy'}`}>
                {template.source === 'preset' ? 'Pacchetto' : 'Base'}
              </span>
            </div>
            <div className="template-description">{template.description}</div>
            <div className="template-meta">
              <span>📅 {template.start_date}</span>
              <span>🌍 {template.country_count} paesi</span>
              {template.has_rules && (
                <span title="Regole di simulazione personalizzate">⚙</span>
              )}
              {template.has_map && (
                <span title="Mappa personalizzata">🗺</span>
              )}
              {template.flags_count > 0 && (
                <span title={`Bandiere: ${template.flags_count}`}>🚩×{template.flags_count}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <PresetEditorModal
          templateId={editor.templateId}
          onClose={() => setEditor(null)}
          onSaved={loadTemplates}
        />
      )}
    </div>
  );
};

export default TemplateSelector;
