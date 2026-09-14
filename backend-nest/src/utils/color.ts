/**
 * World Story — Color Utils
 * ======================
 * Пост-обработка палитры регионов для тёмной карты фронта (#0a0a0f).
 *
 * Проблема: цвета флагов из реестра data/countries.json — «сырые»
 * (#FF0000, #000000). Чёрные регионы невидимы на тёмном фоне, а множество
 * красных оттенков сливаются в «красную карту». Решения:
 *  - кураторская палитра пресета (country_colors в preset.json) — приоритет;
 *  - анти-тёмный post-process для остальных цветов: если относительная
 *    яркость ниже порога — микс с белым (~45%), регион становится читаемым.
 */

/** Порог относительной яркости: ниже — цвет считается слишком тёмным. */
export const DARK_LUMINANCE_THRESHOLD = 0.18;

/** Доля белого в миксе при осветлении тёмного цвета. */
export const LIGHTEN_MIX = 0.45;

/** Цвет по умолчанию (нейтральные/невалидные). */
export const FALLBACK_COLOR = '#888888';

interface Rgb { r: number; g: number; b: number }

/** Разобрать #RGB / #RRGGBB в каналы 0..255; null — невалидный ввод. */
function parseHex(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split('').map(c => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Нормализация к #RRGGBB (uppercase); null — невалидный ввод. */
export function normalizeHexColor(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

/**
 * Относительная яркость 0..1: 0.2126R + 0.7152G + 0.0722B (каналы 0..1).
 * null — невалидный цвет.
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Микс с белым: channel' = channel + (255 - channel) * amount. */
export function lighten(hex: string, amount: number = LIGHTEN_MIX): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const mix = (c: number) => c + (255 - c) * amount;
  return toHex({ r: mix(rgb.r), g: mix(rgb.g), b: mix(rgb.b) });
}

/**
 * Анти-тёмный post-process: цвет с яркостью ниже threshold осветляется
 * миксом с белым (~45%), иначе возвращается нормализованным (#RRGGBB).
 * Невалидный ввод → FALLBACK_COLOR.
 */
export function ensureVisibleOnDark(hex: string, threshold: number = DARK_LUMINANCE_THRESHOLD): string {
  const lum = relativeLuminance(hex);
  if (lum === null) return FALLBACK_COLOR;
  if (lum >= threshold) return toHex(parseHex(hex)!);
  return lighten(hex, LIGHTEN_MIX);
}

/**
 * Детерминированный цвет из произвольной строки (id/имя политии без цвета).
 * Одна и та же полития всегда получает один и тот же читаемый на тёмной
 * карте цвет: оккупированная провинция не может остаться в цвете старой
 * нации только потому, что новый владелец ещё не имел ни одного региона.
 */
export function colorFromString(seed: string): string {
  const text = String(seed || '').trim() || 'neutral';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // HSL с фиксированной насыщенностью/яркостью: цвета различимы и не тёмные.
  const hue = Math.abs(hash) % 360;
  const s = 0.62;
  const l = 0.58;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  const channel = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(r1)}${channel(g1)}${channel(b1)}`;
}

/**
 * Цвет политии без известного цвета: нейтральные — серые, остальные —
 * детерминированный оттенок из id/имени.
 */
export function colorForPolity(polityId: string | undefined | null): string {
  const id = String(polityId || '').trim().toLowerCase();
  if (!id || id === 'neutral') return FALLBACK_COLOR;
  return colorFromString(id);
}

/**
 * Цвет региона при генерации мира:
 *  1. если у пресета есть кураторский цвет для кода страны (country_colors) — он;
 *  2. иначе — прежний цвет (реестр/пресет countries[]) + анти-тёмный post-process.
 */
export function resolveRegionColor(
  code: string,
  fallback: string | undefined,
  presetColors?: Record<string, string>,
): string {
  const curated = presetColors?.[code];
  if (typeof curated === 'string' && normalizeHexColor(curated)) {
    return normalizeHexColor(curated)!;
  }
  return ensureVisibleOnDark(fallback || FALLBACK_COLOR);
}
