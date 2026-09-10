import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, 'AccessibleDialog.tsx'), 'utf8');
const gameComponent = (name: string) => fs.readFileSync(path.resolve(__dirname, '..', 'Game', name), 'utf8');

describe('AccessibleDialog contract', () => {
  it('uses a portal and protects the application behind an active modal', () => {
    expect(source).toContain("from 'react-dom'");
    expect(source).toContain('createPortal(');
    expect(source).toContain("setApplicationInert(true)");
    expect(source).toContain("setApplicationInert(false)");
    expect(source).toContain("root.inert = true");
    expect(source).toContain("root.setAttribute('aria-hidden', 'true')");
  });

  it('handles Escape, focus entry, focus return, and the Tab loop', () => {
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("event.key !== 'Tab'");
    expect(source).toContain('target?.focus({ preventScroll: true })');
    expect(source).toContain('previousFocus?.focus({ preventScroll: true })');
    expect(source).toContain('last.focus()');
    expect(source).toContain('first.focus()');
  });

  it('is adopted by the save, provider, news, preset, archive, and playback dialogs', () => {
    for (const file of [
      'SaveGameModal.tsx',
      'LLMSettingsModal.tsx',
      'NewsFlash.tsx',
      'PresetEditorModal.tsx',
      'EventFeed.tsx',
      'SimulationEventReader.tsx',
      'HudBar.tsx',
    ]) {
      expect(gameComponent(file)).toContain('<AccessibleDialog');
    }
  });

  it('allows the active playback reader to remain a modal decision point', () => {
    const reader = gameComponent('SimulationEventReader.tsx');
    expect(reader).toContain('closeOnBackdrop={false}');
    expect(reader).toContain('closeOnEscape={false}');
  });

  it('leaves no component-specific dialog or portal implementation behind', () => {
    const gameDirectory = path.resolve(__dirname, '..', 'Game');
    for (const file of fs.readdirSync(gameDirectory).filter(file => file.endsWith('.tsx'))) {
      const component = fs.readFileSync(path.join(gameDirectory, file), 'utf8');
      expect(component, file).not.toContain('role="dialog"');
      expect(component, file).not.toContain('createPortal(');
    }
  });
});
