// 槓桿半圓儀表：手寫 SVG。刻度範圍 0 ~ 最大槓桿（存入保證金剛好等於原始保證金時）。
// 分區依「距斷頭緩衝」換算成槓桿，顏色由 CSS class 控制。

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 120;
const CY = 120;
const R = 96;

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// t ∈ [0,1]：0 在左端、1 在右端
const point = (t, r = R) => {
  const a = Math.PI * (1 - t);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

function arc(t0, t1) {
  const [x0, y0] = point(t0);
  const [x1, y1] = point(t1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/**
 * @param {HTMLElement} container
 * @param {{ leverage: number, max: number, zones: {from: number, to: number, key: string}[] }} opts
 *   zones 以槓桿倍數表示，由低到高
 */
export function renderGauge(container, { leverage, max, zones }) {
  const clamp = (v) => Math.min(Math.max(v / max, 0), 1);
  const svg = el('svg', { viewBox: '0 0 240 136', class: 'gauge', 'aria-hidden': 'true' });

  svg.append(el('path', { d: arc(0, 1), class: 'gauge-track' }));
  for (const z of zones) {
    const t0 = clamp(z.from);
    const t1 = clamp(z.to);
    if (t1 > t0) svg.append(el('path', { d: arc(t0, t1), class: `gauge-zone zone-${z.key}` }));
  }

  // 刻度：1x、中間、最大槓桿實際值；彼此太近（低於最大值 15%）的省略，避免疊字
  const ticks = [];
  for (const v of [1, Math.round(max / 2), max]) {
    if (v <= max && ticks.every((t) => Math.abs(t - v) >= max * 0.15)) ticks.push(v);
  }
  for (const v of ticks) {
    const [x, y] = point(clamp(v), R - 22);
    const label = Number.isInteger(v) ? `${v}x` : `${v.toFixed(1)}x`;
    svg.append(el('text', { x: x.toFixed(1), y: (y + 4).toFixed(1), 'text-anchor': 'middle', class: 'gauge-tick' }, label));
  }

  const [nx, ny] = point(clamp(leverage), R - 10);
  svg.append(el('line', { x1: CX, y1: CY, x2: nx.toFixed(2), y2: ny.toFixed(2), class: 'gauge-needle' }));
  svg.append(el('circle', { cx: CX, cy: CY, r: 6, class: 'gauge-hub' }));

  container.replaceChildren(svg);
}
