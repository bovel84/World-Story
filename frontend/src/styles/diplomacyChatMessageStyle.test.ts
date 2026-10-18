import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, 'diplomacy-chat.css'), 'utf8');

describe('Diplomacy message cards', () => {
  it('keeps the accent spine and secondary bubble stripe invisible', () => {
    expect(css).toMatch(/\.diplomacy-chat-wrap \.chat-msg-wrap::before\s*\{[^}]*content:\s*none\s*!important/);
    expect(css).not.toMatch(/\.diplomacy-chat-wrap \.chat-msg-wrap::before\s*\{[^}]*background:/);
    expect(css).toMatch(/\.diplomacy-chat-wrap \.chat-msg-wrap \.chat-bubble\.polity,[\s\S]*?border-left:\s*0\s*!important/);
  });
});
