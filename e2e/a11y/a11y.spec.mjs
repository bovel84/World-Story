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
  await expect(page.locator('.game-wrapper')).toBeVisible({ timeout: 20_000 });
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
    const hasAriaLabel = el.getAttribute('aria-label');
    const hasAriaLabelledby = el.getAttribute('aria-labelledby');
    if (!hasLabelFor && !hasAriaLabel && !hasAriaLabelledby) {
      violations.push({ selector: el.tagName.toLowerCase() + (id ? `#${id}` : ''), issue: 'controllo di form senza nome accessibile' });
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
  test('HUD di gioco: nessuna violazione di base', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Apri i moduli per coprire anche i loro controlli.
    await page.locator('.fab-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.action-desk')).toBeVisible();
    await page.locator('.action-desk .btn-close').click();
    await page.locator('.fab-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();

    const violations = await page.evaluate(auditDom);
    expect(violations).toEqual([]);
  });
});
