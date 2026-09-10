import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const selectorComponent = path.resolve(__dirname, 'TemplateSelector.tsx');

describe('TemplateSelector accessibility contract', () => {
  it('uses a native button to open each scenario and labels icon-only actions', () => {
    const source = fs.readFileSync(selectorComponent, 'utf8');

    expect(source).toContain('<article key={template.id} className="template-card">');
    expect(source).toContain('className="template-card-select"');
    expect(source).toContain('aria-label={`Apri scenario ${template.name}`}');
    expect(source).toContain('aria-label={`Modifica preset ${template.name}`}');
    expect(source).toContain('aria-label={`Crea un preset a partire da ${template.name}`}');
    expect(source).toContain('aria-label={`Esporta scenario ${template.name}`}');
  });
});
