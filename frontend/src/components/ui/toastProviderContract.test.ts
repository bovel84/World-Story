import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const uiDirectory = path.resolve(__dirname);
const source = fs.readFileSync(path.join(uiDirectory, 'ToastProvider.tsx'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');

describe('ToastProvider contract', () => {
  it('announces non-blocking messages from a portal and supports dismissal', () => {
    expect(source).toContain('createPortal(');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain('window.setTimeout');
    expect(source).toContain("aria-label=\"Chiudi notifica\"");
  });

  it('removes blocking alert calls from the application shell', () => {
    expect(app).not.toContain('alert(');
    expect(app).toContain('const { notify } = useToast();');
  });
});
