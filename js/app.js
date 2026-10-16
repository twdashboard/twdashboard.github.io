// 介面層：讀取表單、更新 state、重新渲染。所有計算交給 risk.js。

import { CONTRACTS, CONTRACT_CODES } from './contracts.js';
import {
  STATUS,
  computeSummary,
  stressTest,
  unrealizedPnl,
  closePosition,
  drawdown,
  upsertEquity,
} from './risk.js';
import * as store from './store.js';
import { renderEquityChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

const intFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (n) => intFmt.format(Math.round(n));
const signedMoney = (n) => (n > 0 ? '+' : '') + money(n);
const pct = (r, digits = 1) => (r === null ? '—' : `${(r * 100).toFixed(digits)}%`);
const signedPct = (r) => (r > 0 ? '+' : '') + pct(r, 0);
const lev = (x) => (x === null ? '—' : `${x.toFixed(2)} 倍`);
// 台股慣例：紅漲（獲利）綠跌（虧損）
const pnlClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const sideLabel = (side) => (side === 'short' ? '空' : '多');
const today = () => new Date().toLocaleDateString('sv-SE');

const STATUS_LABEL = {
  [STATUS.FLAT]: '無部位',
  [STATUS.OK]: '正常',
  [STATUS.MARGIN_CALL]: '低於維持保證金',
  [STATUS.LIQUIDATION]: '達代沖銷',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let state = store.load();
let closingId = null;

function commit(next) {
  state = next;
  $('#storage-warning').hidden = store.save(state);
  render();
}

// 整份取代設定時使用；一般 commit 不重繪設定表單，以免蓋掉使用者正在輸入的內容
function replaceState(next) {
  commit(next);
  renderSettings();
}

const setPrice = (match, price) => state.positions.map((p) => (match(p) ? { ...p, price } : p));

function pointsText(points) {
  if (points === null) return '—';
  if (points === 0) return '已觸及';
  return `指數${points < 0 ? '跌' : '漲'} ${money(Math.abs(points))} 點`;
}

function kpi(label, value, { cls = '', note = '' } = {}) {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}</div>`
    + `<div class="kpi-value">${value}</div>${note ? `<div class="kpi-note">${note}</div>` : ''}</div>`;
}

function renderSummary(sum) {
  const badge = $('#status-badge');
  badge.textContent = STATUS_LABEL[sum.status];
  badge.className = `badge status-${sum.status}`;

  const net = sum.netTxEquivalent;
  const netText = net === 0 ? '0 口' : `${net > 0 ? '多' : '空'} ${Math.abs(net).toFixed(2)} 口`;

  $('#kpis').innerHTML = [
    kpi('權益數', money(sum.equity)),
    kpi('未實現損益', signedMoney(sum.unrealized), { cls: pnlClass(sum.unrealized) }),
    kpi('風險指標', pct(sum.riskRatio), { cls: `status-${sum.status}`, note: '權益數 ÷ 原始保證金' }),
    kpi('原始／維持保證金', `${money(sum.initialMargin)}`, { note: `維持 ${money(sum.maintenanceMargin)}` }),
    kpi('超額保證金', signedMoney(sum.excessMargin), { cls: sum.excessMargin < 0 ? 'warn' : '', note: '權益數 − 原始保證金' }),
    kpi('距追繳', pointsText(sum.pointsToMarginCall), { note: '權益數跌破維持保證金' }),
    kpi('距代沖銷', pointsText(sum.pointsToLiquidation), { note: `風險指標 ≤ ${pct(state.settings.liquidationRatio, 0)}` }),
    kpi('淨部位（大台口數）', netText, { note: `每點 ${signedMoney(sum.perPoint)} 元` }),
    kpi('槓桿（淨／總）', lev(sum.netLeverage), { note: `總曝險 ${lev(sum.grossLeverage)}` }),
  ].join('');
}

/** 表格內容；沒有資料時顯示跨欄提示列 */
function tableRows(items, cols, emptyText, rowFn) {
  return items.length === 0
    ? `<tr><td colspan="${cols}" class="muted">${emptyText}</td></tr>`
    : items.map(rowFn).join('');
}

// side 只會是 long／short；仍以白名單產生 class，避免任何未驗證字串進入 HTML
const sideCell = (side) => `<td class="${side === 'short' ? 'side-short' : 'side-long'}">${sideLabel(side)}</td>`;

function renderPositions() {
  const { margins } = state.settings;
  $('#positions-body').innerHTML = tableRows(state.positions, 8, '尚無部位', (p) => {
    const pnl = unrealizedPnl(p);
    const label = esc(`${CONTRACTS[p.contract].name} ${sideLabel(p.side)} ${p.qty} 口 成本 ${p.entry}`);
    return `<tr>
      <td>${esc(CONTRACTS[p.contract].name)}</td>
      ${sideCell(p.side)}
      <td class="num">${p.qty}</td>
      <td class="num">${money(p.entry)}</td>
      <td class="num"><input class="inline-price" type="number" min="1" step="1" value="${p.price}" data-price-id="${esc(p.id)}" aria-label="現價：${label}"></td>
      <td class="num ${pnlClass(pnl)}">${signedMoney(pnl)}</td>
      <td class="num">${money(p.qty * margins[p.contract].initial)}</td>
      <td class="actions"><button type="button" class="small" data-close="${esc(p.id)}" aria-label="平倉：${label}">平倉</button>
        <button type="button" class="small danger" data-delete="${esc(p.id)}" aria-label="刪除：${label}">刪除</button></td>
    </tr>`;
  });
}

function renderStress() {
  const rows = state.positions.length === 0 ? [] : stressTest(state);
  $('#stress-body').innerHTML = tableRows(rows, 5, '尚無部位', (r) => `<tr>
      <td class="${pnlClass(r.shock)}">${signedPct(r.shock)}</td>
      <td class="num ${pnlClass(r.pnl)}">${signedMoney(r.pnl)}</td>
      <td class="num">${money(r.equity)}</td>
      <td class="num">${pct(r.riskRatio)}</td>
      <td><span class="pill status-${r.status}">${STATUS_LABEL[r.status]}</span></td>
    </tr>`);
}

function renderEquity() {
  const history = state.equityHistory;
  const dd = drawdown(history);
  const range = dd.peakDate ? `（${dd.peakDate} → ${dd.troughDate}）` : '';
  $('#drawdown-stats').innerHTML = history.length === 0
    ? '<p class="muted">尚無權益紀錄。每天收盤後按「記錄權益」，就能追蹤權益曲線與回撤。</p>'
    : [
      kpi('最大回撤', money(dd.maxDrawdown), { cls: dd.maxDrawdown > 0 ? 'down' : '', note: pct(dd.maxDrawdownPct) + range }),
      kpi('目前回撤', money(dd.currentDrawdown), { cls: dd.currentDrawdown > 0 ? 'down' : '', note: pct(dd.currentDrawdownPct) }),
      kpi('紀錄筆數', String(history.length)),
    ].join('');
  renderEquityChart($('#equity-chart'), history, dd, money);
  $('#equity-body').innerHTML = tableRows([...history].reverse(), 3, '尚無權益紀錄', (h) => `<tr>
      <td>${esc(h.date)}</td><td class="num">${money(h.equity)}</td>
      <td class="actions"><button type="button" class="small danger" data-delete-equity="${esc(h.date)}" aria-label="刪除 ${esc(h.date)} 權益紀錄">刪除</button></td>
    </tr>`);
}

function renderTrades() {
  $('#trades-body').innerHTML = tableRows([...state.trades].reverse(), 9, '尚無平倉紀錄', (t) => `<tr>
      <td>${esc(t.date)}</td><td>${esc(t.contract)}</td>${sideCell(t.side)}
      <td class="num">${t.qty}</td><td class="num">${money(t.entry)}</td><td class="num">${money(t.exit)}</td>
      <td class="num ${pnlClass(t.gross)}">${signedMoney(t.gross)}</td><td class="num">${money(t.cost)}</td>
      <td class="num ${pnlClass(t.net)}">${signedMoney(t.net)}</td>
    </tr>`);
}

function renderSettings() {
  const s = state.settings;
  $('#settings-body').innerHTML = CONTRACT_CODES.map((code) => `<tr>
      <td>${esc(CONTRACTS[code].name)}</td>
      <td class="num"><input name="initial-${code}" type="number" min="1" step="1" value="${s.margins[code].initial}" required aria-label="${code} 原始保證金"></td>
      <td class="num"><input name="maintenance-${code}" type="number" min="1" step="1" value="${s.margins[code].maintenance}" required aria-label="${code} 維持保證金"></td>
      <td class="num"><input name="fee-${code}" type="number" min="0" step="1" value="${s.feePerSide[code]}" required aria-label="${code} 手續費"></td>
    </tr>`).join('');
  const form = $('#settings-form');
  form.marginDate.value = s.marginDate;
  form.taxRate.value = +(s.taxRate * 100000).toFixed(4);
  form.liquidationRatio.value = +(s.liquidationRatio * 100).toFixed(2);
}

function render() {
  renderSummary(computeSummary(state));
  renderPositions();
  renderStress();
  renderEquity();
  renderTrades();
  $('#account-form').balance.value = state.account.balance;
}

function fillContractSelects() {
  const options = CONTRACT_CODES.map((c) => `<option value="${c}">${esc(CONTRACTS[c].name)}</option>`).join('');
  $('#position-form').contract.innerHTML = options;
  $('#price-form').contract.insertAdjacentHTML('beforeend', options);
}

function bindEvents() {
  $('#account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const balance = Number(e.target.balance.value);
    if (!Number.isFinite(balance)) return;
    commit({ ...state, account: { ...state.account, balance } });
  });

  $('#price-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const contract = e.target.contract.value;
    const price = Number(e.target.price.value);
    if (!(price > 0)) return;
    commit({
      ...state,
      positions: setPrice((p) => contract === 'ALL' || p.contract === contract, price),
    });
  });

  $('#position-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const qty = Number(f.qty.value);
    const entry = Number(f.entry.value);
    const price = f.price.value === '' ? entry : Number(f.price.value);
    if (!Number.isInteger(qty) || qty <= 0 || !(entry > 0) || !(price > 0)) return;
    const pos = { id: store.newId(), contract: f.contract.value, side: f.side.value, qty, entry, price };
    commit({ ...state, positions: [...state.positions, pos] });
    f.qty.value = '';
    f.entry.value = '';
    f.price.value = '';
  });

  $('#positions-body').addEventListener('change', (e) => {
    const id = e.target.dataset.priceId;
    if (!id) return;
    const price = Number(e.target.value);
    if (!(price > 0)) {
      render();
      return;
    }
    commit({ ...state, positions: setPrice((p) => p.id === id, price) });
  });

  $('#positions-body').addEventListener('click', (e) => {
    const { close, delete: del } = e.target.dataset;
    if (del) {
      if (confirm('刪除這筆部位？（不會計入已實現損益）')) {
        commit({ ...state, positions: state.positions.filter((p) => p.id !== del) });
      }
    } else if (close) {
      openCloseDialog(close);
    }
  });

  const dialog = $('#close-dialog');
  dialog.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
  $('#close-form').addEventListener('submit', (e) => {
    const f = e.target;
    try {
      commit(closePosition(state, closingId, Number(f.qty.value), Number(f.price.value), f.date.value));
    } catch (err) {
      e.preventDefault();
      alert(err.message);
    }
  });

  $('#equity-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const equity = f.equity.value === '' ? computeSummary(state).equity : Number(f.equity.value);
    if (!f.date.value || !Number.isFinite(equity)) return;
    commit({ ...state, equityHistory: upsertEquity(state.equityHistory, f.date.value, Math.round(equity)) });
    f.equity.value = '';
  });

  $('#equity-body').addEventListener('click', (e) => {
    const date = e.target.dataset.deleteEquity;
    if (date) commit({ ...state, equityHistory: state.equityHistory.filter((h) => h.date !== date) });
  });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const margins = {};
    const feePerSide = {};
    for (const code of CONTRACT_CODES) {
      const initial = Number(f[`initial-${code}`].value);
      const maintenance = Number(f[`maintenance-${code}`].value);
      if (!(initial > 0 && maintenance > 0)) return;
      if (maintenance > initial) {
        alert(`${CONTRACTS[code].name}：維持保證金不應高於原始保證金`);
        return;
      }
      margins[code] = { initial, maintenance };
      feePerSide[code] = Math.max(0, Number(f[`fee-${code}`].value) || 0);
    }
    const settings = {
      margins,
      feePerSide,
      marginDate: f.marginDate.value,
      taxRate: Number(f.taxRate.value) / 100000,
      liquidationRatio: Number(f.liquidationRatio.value) / 100,
    };
    // 交給 normalize 擋掉不合法數值
    replaceState(store.normalize({ ...state, settings }));
  });

  $('#reset-settings').addEventListener('click', () => {
    if (!confirm('把保證金、手續費、稅率與代沖銷門檻還原為預設值？')) return;
    replaceState({ ...state, settings: store.defaultSettings() });
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([store.exportJson(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `twdashboard-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = store.importJson(await file.text());
      if (!confirm('匯入會覆蓋目前所有資料，確定？')) return;
      replaceState(next);
    } catch {
      alert('檔案不是有效的 JSON');
    }
  });

  $('#clear-btn').addEventListener('click', () => {
    if (!confirm('清除所有部位、紀錄與設定？此動作無法復原，建議先匯出 JSON。')) return;
    replaceState(store.defaultState());
  });
}

function openCloseDialog(id) {
  const pos = state.positions.find((p) => p.id === id);
  if (!pos) return;
  closingId = id;
  const f = $('#close-form');
  $('#close-desc').textContent = `${CONTRACTS[pos.contract].name} ${sideLabel(pos.side)} ${pos.qty} 口，成本 ${money(pos.entry)}`;
  f.qty.max = pos.qty;
  f.qty.value = pos.qty;
  f.price.value = pos.price;
  f.date.value = today();
  $('#close-dialog').showModal();
}

// 視窗寬度改變時重畫權益曲線，讓座標文字維持原始大小
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderEquity, 150);
});

fillContractSelects();
$('#equity-form').date.value = today();
bindEvents();
render();
renderSettings();
