import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, 'TemplateSelector.tsx'), 'utf8');

describe('TemplateSelector catalog hierarchy', () => {
  it('limits card pitch and separates authoring from Play', () => {
    expect(source).toContain('PITCH_MAX = 160');
    expect(source).toContain("className=\"template-search\"");
    expect(source).toContain('btn-studio-toggle');
    expect(source).toContain('Leggi di più');
  });

  it('does not nest the description toggle inside the select button', () => {
    // La card-select deve chiudersi prima del toggle di descrizione.
    const selectOpen = source.indexOf('className="template-card-select"');
    const selectClose = source.indexOf('</button>', selectOpen);
    const togglePos = source.indexOf('template-description-toggle', selectOpen);
    expect(togglePos).toBeGreaterThan(selectClose);
  });
});