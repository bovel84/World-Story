import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Region } from '../../types';
import { buildMapContextIndex } from '../Map/mapContext';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import type { MapFocusVisual } from './governmentVisual';
import type { WarFrontPayload } from '../../services/api';

const regions = [
  { id: 'r1', name: 'Settentrione', owner: 'A', polityName: 'Paese A', color: '#315f87', svgPath: 'M100 100L200 100L200 200L100 200Z', objects: [], borders: [], metadata: {} },
  { id: 'r2', name: 'Oriente', owner: 'B', polityName: 'Paese B', color: '#ad7749', svgPath: 'M200 100L300 100L300 200L200 200Z', objects: [], borders: [], metadata: {} },
] as Region[];
const fronts = [{ id: 'f1', name: 'Fronte orientale', regionIds: ['r1', 'r2'], status: 'active' }] as WarFrontPayload[];
const snapshot = { scopeKey: 'game:branch:turn:revision', index: buildMapContextIndex({ regions, units: [], fronts }) };
const card: MapFocusVisual = { type: 'map-focus', title: 'Fronte orientale', regionIds: ['r1', 'r2'], scopeKey: snapshot.scopeKey };
function elements(node: React.ReactNode): React.ReactElement[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement(child) ? [child, ...elements((child.props as { children?: React.ReactNode }).children)] : []);
}

describe('GovernmentVisualCard', () => {
  it('renders a panoramic SVG, canonical labels/colors and only a map-navigation action', () => {
    const html = renderToStaticMarkup(<GovernmentVisualCard card={card} snapshot={snapshot} onFocusMap={() => {}} />);
    expect(html).toContain('<svg');
    expect(html).toContain('Settentrione');
    expect(html).toContain('Oriente');
    expect(html).toContain('Paese A');
    expect(html).toContain('#315f87');
    expect(html).toContain('#ad7749');
    expect(html).toContain('Mostra sulla mappa principale');
    expect(html).not.toMatch(/<canvas|<img|Firma|Esegui|Prepara/);
  });

  it('the actual button forwards the same canonical territories and snapshot, not a proposed order', () => {
    const onFocusMap = vi.fn();
    const tree = GovernmentVisualCard({ card, snapshot, onFocusMap });
    const button = elements(tree).find(element => element.type === 'button')!;
    (button.props as { onClick: () => void }).onClick();
    expect(onFocusMap).toHaveBeenCalledExactlyOnceWith(card);
  });

  it('missing geometry has a safe named fallback, no fabricated image, and can still open the main map', () => {
    const missing = { ...snapshot, index: buildMapContextIndex({ regions: regions.map(region => ({ ...region, svgPath: undefined })), fronts, units: [] }) };
    const html = renderToStaticMarkup(<GovernmentVisualCard card={card} snapshot={missing} onFocusMap={() => {}} />);
    expect(html).toContain('Geometria non disponibile');
    expect(html).toContain('Settentrione');
    expect(html).toContain('Oriente');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });

  it('old scope/invalid region cards disappear entirely', () => {
    expect(renderToStaticMarkup(<GovernmentVisualCard card={{ ...card, scopeKey: 'other-game' }} snapshot={snapshot} />)).toBe('');
    expect(renderToStaticMarkup(<GovernmentVisualCard card={{ ...card, regionIds: ['invented'] }} snapshot={snapshot} />)).toBe('');
  });

  it('the Advisor message path renders a referenced front beneath the message, without options', () => {
    const html = renderToStaticMarkup(<div><p>Il confine richiede attenzione.</p><GovernmentMessageVisuals message={{ role: 'assistant', situations: [{ signalKeys: ['conflict:f1'] }] }} snapshot={snapshot} onFocusMap={() => {}} /></div>);
    expect(html.indexOf('Il confine richiede attenzione.')).toBeLessThan(html.indexOf('Fronte orientale'));
    expect(html).toContain('government-visual-card');
    expect(html).not.toMatch(/Opzioni|Firma|Esegui/);
  });

  it('general economic/military talk alone produces no card', () => {
    const html = renderToStaticMarkup(<GovernmentMessageVisuals message={{ role: 'assistant', content: 'Settentrione e Oriente', situations: [{ signalKeys: ['military-supply', 'monthly-balance'] }] }} snapshot={snapshot} />);
    expect(html).toBe('');
  });
});
