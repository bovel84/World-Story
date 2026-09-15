/**
 * World Story — Audit accessibilità di base (Q01 µ3)
 * =================================================
 *
 * Audit DOM automatico SENZA dipendenze esterne (l'ambiente è offline e
 * @axe-core non è installato). Verifica i controlli di base WCAG che si
 * possono ispezionare staticamente nel DOM:
 *   - ogni controllo di form (input/textarea/select) ha un nome accessibile
 *     (label[for], aria-label, aria-labelledby);
 *   - ogni bottone ha un nome accessibile (testo o aria-label);
 *   - ogni immagine ha un alt (anche vuoto per le decorative);
 *   - nessun id duplicato;
 *   - l'elemento <html> dichiara lang.
 *
 * Le verifiche manuali (tastiera, Safari iOS/Chrome Android reali, contrasto
 * visivo) restano fuori da questo test automatico e sono elencate nel report.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

/** Raggiunge l'HUD di gioco dal landing. */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.rail-btn').first()).toBeVisible({ timeout: 20_000 });
}

/** Audit DOM statico: ritorna un array di violazioni {selector, issue}. */
function auditDom() {
  const violations = [];
  const seenIds = new Set();

  // 1. <html lang>
  const html = document.documentElement;
  if (!html.getAttribute('lang')) {
    violations.push({ selector: 'html', issue: 'manca l\'attributo lang' });
  }

  // 2. Controlli di form senza nome accessibile
  const formControls = document.querySelectorAll('input, textarea, select');
  formControls.forEach((el) => {
    const id = el.id;
    const hasLabelFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const hasWrappingLabel = el.closest('label');
    const hasAriaLabel = el.getAttribute('aria-label');
    const hasAriaLabelledby = el.getAttribute('aria-labelledby');
    if (!hasLabelFor && !hasWrappingLabel && !hasAriaLabel && !hasAriaLabelledby) {
      violations.push({ selector: el.tagName.toLowerCase() + (id ? `#${id}` : '') + (el.getAttribute('type') ? `[type="${el.getAttribute('type')}"]` : '') + (el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''), issue: 'controllo di form senza nome accessibile' });
    }
  });

  // 3. Bottoni senza nome accessibile
  document.querySelectorAll('button').forEach((el) => {
    const text = (el.textContent || '').trim();
    const ariaLabel = el.getAttribute('aria-label');
    const ariaLabelledby = el.getAttribute('aria-labelledby');
    if (!text && !ariaLabel && !ariaLabelledby) {
      violations.push({ selector: 'button', issue: 'bottone senza nome accessibile' });
    }
  });

  // 4. Immagini senza alt
  document.querySelectorAll('img').forEach((el) => {
    if (!el.hasAttribute('alt')) {
      violations.push({ selector: 'img', issue: 'immagine senza attributo alt' });
    }
  });

  // 5. Id duplicati
  document.querySelectorAll('[id]').forEach((el) => {
    const id = el.id;
    if (seenIds.has(id)) {
      violations.push({ selector: `#${id}`, issue: 'id duplicato' });
    }
    seenIds.add(id);
  });

  return violations;
}

test.describe('Q01 µ3 — audit accessibilità di base', () => {
  test('rail e desk Tempo sono azionabili da tastiera', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    const orders = page.getByRole('button', { name: 'Ordini' });
    // Tab reale: :focus-visible deve comparire soltanto per navigazione tastiera.
    for (let index = 0; index < 20 && !(await orders.evaluate((element) => document.activeElement === element)); index += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(orders).toBeFocused();
    expect(await orders.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('.suggestions-content')).toBeVisible();

    const advance = page.getByRole('button', { name: 'Avanza' });
    await advance.focus();
    await expect(advance).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.time-desk-content')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chiudi avanza il tempo' })).toBeVisible();
  });

  test('picker salvataggi: dialog e focus iniziale accessibili', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    // Le azioni di partita vivono nel menù HUD, fuori dal Dossier Nazione.
    await page.locator('.game-menu-btn').click();
    await page.locator('.game-menu-item', { hasText: 'Carica' }).click();
    const dialog = page.getByRole('dialog', { name: 'Carica un salvataggio' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    const close = page.getByRole('button', { name: 'Chiudi archivio' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden');
  });

  test('HUD di gioco: nessuna violazione di base', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Apri i moduli per coprire anche i loro controlli.
    await page.locator('.rail-btn').filter({ hasText: 'Ordini' }).click();
    await expect(page.locator('.suggestions-content')).toBeVisible();
    await page.locator('.rail-btn').filter({ hasText: 'Nazione' }).click();
    await expect(page.locator('.nation-desk')).toBeVisible();

    const violations = await page.evaluate(auditDom);
    expect(violations).toEqual([]);
  });
});
