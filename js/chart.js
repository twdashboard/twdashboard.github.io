// 權益曲線：手寫 SVG，不依賴外部圖表庫。顏色由 CSS class 控制以支援深淺色主題。

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 72 };

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} container
 * @param {{date: string, equity: number}[]} history 已依日期排序
 * @param {{peakDate: string|null, troughDate: string|null}} dd 最大回撤高低點
 * @param {(n: number) => string} fmt 金額格式化
 */
export function renderEquityChart(container, history, dd, fmt) {
  container.replaceChildren();
  if (history.length < 2) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '至少需要兩筆權益紀錄才能畫出曲線。';
    container.append(p);
    return;
  }

  const values = history.map((h) => h.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  // 依容器實際寬度繪製，手機上座標文字才不會被縮小
  const width = Math.max(300, Math.round(container.clientWidth) || 640);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / (history.length - 1)) * plotW;
  const y = (v) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'equity-chart',
    role: 'img',
    'aria-label': `權益曲線，共 ${history.length} 筆，最低 ${fmt(min)}，最高 ${fmt(max)}`,
  });

  for (const v of [min, (min + max) / 2, max]) {
    svg.append(el('line', { x1: PAD.left, x2: width - PAD.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: PAD.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, fmt(v)));
  }
  svg.append(el('text', { x: PAD.left, y: HEIGHT - 8, class: 'axis' }, history[0].date));
  svg.append(el('text', { x: width - PAD.right, y: HEIGHT - 8, 'text-anchor': 'end', class: 'axis' },
    history[history.length - 1].date));

  const d = history.map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(h.equity).toFixed(1)}`).join(' ');
  svg.append(el('path', { d, class: 'line' }));

  history.forEach((h, i) => {
    let kind = '';
    if (h.date === dd.peakDate) kind = 'peak';
    else if (h.date === dd.troughDate) kind = 'trough';
    const dot = el('circle', { cx: x(i), cy: y(h.equity), r: kind ? 4.5 : 2.5, class: `dot ${kind}` });
    dot.append(el('title', {}, `${h.date}：${fmt(h.equity)}`));
    svg.append(dot);
  });

  container.append(svg);
}
