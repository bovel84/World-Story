/** Compact tactical silhouettes, drawn locally: no emoji/font/network dependency. */
export function createMilitarySymbol(type: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 16');
  svg.setAttribute('class', 'openpax-unit-symbol');
  svg.setAttribute('aria-hidden', 'true');
  const paths: Record<string, string> = {
    battalion: 'M2 2H22V14H2Z M2 2L22 14 M22 2L2 14',
    army: 'M7 4H17C23 4 23 12 17 12H7C1 12 1 4 7 4Z M12 4V1 M12 1H19',
    fleet: 'M2 9H22L18 14H6Z M12 9V1 M12 2L19 7H12 M9 4H6V9',
    missile: 'M5 13L16 2 22 1 21 7 10 14Z M7 10L2 9 6 5 12 5 M12 12L13 16 17 12 17 7',
  };
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[type] || paths.battalion);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}
