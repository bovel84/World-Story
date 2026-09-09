/**
 * World Story — U02 µ1: ActionsPanel (compositore libero d'ordine).
 *
 * Passo 1 del piano U02: «Compositore libero e chiarimenti senza perdita
 * bozza; review dell'intento e limiti espliciti.»
 *
 * Regole (maestro §10.6, UI02/UI13):
 *  - Etichetta «Registra ordine», mai «Invia» (che sembrerebbe esecuzione
 *    immediata). Registrare NON avanza il tempo né spende risorse.
 *  - La bozza è conservata su errore di rete; l'errore è tecnico, non un
 *    fallimento geopolitico.
 *  - «Migliora formulazione» produce un'anteprima da confermare esplicitamente.
 */

import React from 'react';

export interface ActionsPanelProps {
  text: string;
  onTextChange: (text: string) => void;
  enhancedPreview: string | null;
  enhanceLoading: boolean;
  enhanceError: string | null;
  onEnhance: (text: string) => void;
  onAcceptEnhanced: () => void;
  onRejectEnhanced: () => void;
  onRegister: (text: string) => void;
}

export function ActionsPanel({
  text,
  onTextChange,
  enhancedPreview,
  enhanceLoading,
  enhanceError,
  onEnhance,
  onAcceptEnhanced,
  onRejectEnhanced,
  onRegister,
}: ActionsPanelProps) {
  const canEnhance = text.trim().length > 0 && !enhanceLoading;
  const canRegister = text.trim().length > 0;

  return (
    <div className="manual-action-input">
      <label className="free-order-label" htmlFor="free-player-order">Ordine al governo</label>
      <textarea
        id="free-player-order"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Descrivi ciò che vuoi tentare. Il simulatore valuterà risorse, tempi, confini e conseguenze."
        rows={3}
      />
      <p className="order-limits-note" role="note">
        Registrare l'ordine non avanza il tempo né spende risorse: fattibilità e costi
        saranno valutati dal simulatore al salto.
      </p>
      {enhanceError && (
        <div className="suggestions-error" role="alert">{enhanceError}</div>
      )}
      <div className="manual-action-actions">
        <button
          className="btn-enhance-pending"
          onClick={() => onEnhance(text)}
          disabled={!canEnhance}
          title="Migliora la formulazione senza inviare l'ordine"
        >
          {enhanceLoading ? 'Riformulo…' : 'Migliora formulazione'}
        </button>
        <button
          className="btn-add-pending"
          onClick={() => onRegister(text)}
          disabled={!canRegister}
        >
          Registra ordine
        </button>
      </div>
      {enhancedPreview && (
        <div className="enhance-preview" role="status">
          <div className="enhance-preview-label">Formulazione proposta</div>
          <p className="enhance-preview-text">{enhancedPreview}</p>
          <div className="enhance-preview-actions">
            <button
              className="btn-enhance-accept"
              onClick={() => {
                onAcceptEnhanced();
                onRegister(enhancedPreview);
              }}
            >
              Usa questa formulazione
            </button>
            <button
              className="btn-enhance-reject"
              onClick={onRejectEnhanced}
            >
              Scarta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
