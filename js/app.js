// 介面層：分頁切換、讀取輸入、即時重算與渲染。所有風控判斷交給 calc.js。

import { CONTRACTS, CONTRACT_CODES, BUFFER_ZONES, SHOCK_OPTIONS } from './contracts.js';
import { positionMetrics, requiredDeposit, gridLadder, leverageForBuffer, GRID_STATUS } from './calc.js';
import { loadQuote, quoteHintText } from './quote.js';
import { renderGauge } from './gauge.js';
import { LIMITS, isValidMargin, isValidRatio } from './validate.js';
import * as store from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmt0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = (n) => `NT$ ${fmt0.format(Math.round(n))}`;
const points = (n) => `${fmt0.format(Math.round(n))} 點`;
const pct = (r, d = 1) => `${(r * 100).toFixed(d)}%`;
const signedPct = (r) => (r > 0 ? '+' : '') + pct(r, 2);

const setText = (id, text) => { document.getElementById(id).textContent = text; };
const setTexts = (map) => { for (const [id, text] of Object.entries(map)) setText(id, text); };

/** 建立元素：props 直接指定到元素屬性（className、textContent、colSpan…），子節點可為字串或元素 */
function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let state = store.load();
let quote = null;

function persist() {
  $('#storage-warning').hidden = store.save(state);
}

// ---------- 兩個試算表單（爆倉計算、網格）共用的輸入邏輯 ----------

const FORMS = {
  calc: {
    form: '#calc-form',
    priceField: 'entry',
    fields: {
      entry: { label: '開倉價格' },
      deposit: { label: '存入保證金' },
      qty: { label: '持倉口數', max: LIMITS.maxQty },
    },
    render: () => renderCalc(),
  },
  grid: {
    form: '#grid-form',
    priceField: 'start',
    fields: {
      start: { label: '起始價格' },
      spacing: { label: '每格間距' },
      qtyPerLevel: { label: '每格口數', max: LIMITS.maxQty },
      levels: { label: '格數', max: LIMITS.maxLevels },
      deposit: { label: '存入保證金' },
    },
    render: () => renderGrid(),
  },
};

function update(key, patch) {
  state = { ...state, [key]: { ...state[key], ...patch } };
  persist();
  FORMS[key].render();
  renderQuoteHint(key);
}

function setSideButtons(form, side) {
  for (const b of $$('[data-side]', form)) b.setAttribute('aria-pressed', String(b.dataset.side === side));
}

/** 把 state 寫回表單欄位並清除錯誤標記 */
function syncForm(key) {
  const cfg = FORMS[key];
  const form = $(cfg.form);
  const values = state[key];
  form.contract.value = values.contract;
  for (const name of Object.keys(cfg.fields)) {
    form[name].value = values[name];
    form[name].removeAttribute('aria-invalid');
  }
  setSideButtons(form, values.side);
  $('[data-form-error]', form).textContent = '';
}

/** 驗證單一數字欄位；有 max 的欄位視為整數。回傳合法值或 null，並更新錯誤提示 */
function readField(key, input) {
  const { label, max } = FORMS[key].fields[input.name];
  const v = Number(input.value);
  const ok = input.value !== '' && Number.isFinite(v) && v > 0 && (max === undefined || (Number.isInteger(v) && v <= max));
  input.toggleAttribute('aria-invalid', !ok);

  const form = $(FORMS[key].form);
  const invalid = $$('input[aria-invalid]', form).map((i) => {
    const f = FORMS[key].fields[i.name];
    return f.max === undefined ? `${f.label}需為正數` : `${f.label}需為 1 到 ${f.max} 的整數`;
  });
  $('[data-form-error]', form).textContent = invalid.join('；');
  return ok ? v : null;
}

function bindForm(key) {
  const cfg = FORMS[key];
  const form = $(cfg.form);
  const errorEl = $('[data-form-error]', form);
  errorEl.id = `${key}-error`;
  for (const [name, f] of Object.entries(cfg.fields)) {
    form[name].setAttribute('aria-describedby', errorEl.id);
    if (f.max !== undefined) form[name].max = String(f.max);
  }

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'contract') update(key, { contract: t.value });
    else if (t.name in cfg.fields) {
      const v = readField(key, t);
      if (v !== null) update(key, { [t.name]: v });
    }
  });

  form.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-side]');
    if (!b) return;
    update(key, { side: b.dataset.side });
    setSideButtons(form, b.dataset.side);
  });

  $('[data-fetch-quote]', form).addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = '抓取中…';
    await refreshQuote();
    b.disabled = false;
    b.textContent = '抓取行情';
    const q = quote?.quotes[state[key].contract];
    if (q) {
      update(key, { [cfg.priceField]: q.last });
      syncForm(key);
    }
  });
}

// ---------- 行情 ----------

function renderQuoteHint(key) {
  $(`${FORMS[key].form} [data-quote-hint]`).textContent = quoteHintText(quote, state[key].contract);
}

async function refreshQuote() {
  try {
    quote = await loadQuote();
  } catch {
    quote = null;
  }
  renderQuoteHint('calc');
  renderQuoteHint('grid');
}

// ---------- ① 爆倉價格計算 ----------

function gaugeZones(maxLeverage, ratio) {
  const zones = [];
  let from = 0;
  for (const z of BUFFER_ZONES) {
    const to = z.min === -Infinity ? maxLeverage : leverageForBuffer(z.min, maxLeverage, ratio);
    zones.push({ ...z, from, to });
    from = to;
  }
  return zones;
}

function renderLeverage(c, m) {
  const zones = gaugeZones(m.maxLeverage, state.settings.liquidationRatio);
  renderGauge($('#gauge'), { leverage: m.leverage, max: m.maxLeverage, zones });
  setTexts({
    'lev-value': fmt1.format(m.leverage),
    'lev-zone': `${m.zone.label} · 可扛反向 ${pct(Math.max(m.buffer, 0))}`,
    'lev-sub': `契約市值 ${money(m.notional)} ÷ 存入 ${money(c.deposit)}`,
  });
  $('#lev-zone').className = `gauge-zone-label zone-text zone-${m.zone.key}`;

  $('#zone-legend').replaceChildren(...zones.map((z, i) => {
    const cond = z.min === -Infinity ? `< ${pct(BUFFER_ZONES[i - 1].min, 0)}` : `≥ ${pct(z.min, 0)}`;
    // 分區可能超過最大槓桿（存入保證金低於原始保證金才到得了），如實標示
    const text = z.from >= m.maxLeverage
      ? `${z.label}（可扛 ${cond}）：需低於原始保證金，無法開倉`
      : `${z.label} ${fmt1.format(z.from)}–${fmt1.format(Math.min(z.to, m.maxLeverage))}x（可扛 ${cond}）`;
    return h('li', { className: `zone-${z.key}`, textContent: text });
  }));
}

function renderRisk(c, m) {
  const { margins, liquidationRatio } = state.settings;
  const warn = $('#calc-open-warning');
  if (m.liquidated) warn.textContent = '存入保證金已低於斷頭線，這個部位一開倉就會被代沖銷。';
  else if (!m.canOpen) warn.textContent = `存入保證金低於原始保證金 ${money(m.initialMargin)}，期貨商不會讓你開這個部位。`;
  warn.hidden = m.canOpen && !m.liquidated;

  $('#risk-badge').textContent = m.zone.label;
  $('#risk-badge').className = `pill zone-pill zone-${m.zone.key}`;

  let mcText = '—';
  if (m.belowMaintenance) mcText = '已低於維持保證金';
  else if (m.marginCallPrice > 0) mcText = points(m.marginCallPrice);

  const maintRatio = margins[c.contract].maintenance / margins[c.contract].initial;
  setTexts({
    'liq-price': m.neverLiquidates ? '不會斷頭（價格歸零前）' : points(m.liquidationPrice),
    'liq-distance': m.neverLiquidates
      ? '—'
      : `${signedPct((m.liquidationPrice - c.entry) / c.entry)}（${fmt0.format(m.liquidationPoints)} 點）`,
    'mc-price': mcText,
    'risk-ratio': pct(m.riskRatio),
    'risk-ratio-note': `低於 ${pct(maintRatio)} 追繳 · 低於 ${pct(liquidationRatio, 0)} 斷頭`,
  });

  const scale = 4; // 量表 0% ~ 400%
  const meter = $('#risk-meter');
  meter.style.width = `${Math.min(m.riskRatio / scale, 1) * 100}%`;
  meter.className = `meter-fill zone-bg zone-${m.zone.key}`;
  $('#risk-mark').style.left = `${(liquidationRatio / scale) * 100}%`;
}

function renderAdvice(c, m) {
  const wrap = $('#shock-options');
  if (wrap.childElementCount === 0) {
    wrap.append(...SHOCK_OPTIONS.map((sh) => h('button', { type: 'button', value: String(sh) })));
  }
  for (const b of $$('button', wrap)) {
    const sh = Number(b.value);
    b.setAttribute('aria-pressed', String(sh === c.shock));
    b.replaceChildren(pct(sh, 0), h('small', { textContent: points(c.entry * sh) }));
  }

  const need = requiredDeposit(c, state.settings, c.shock);
  const shock = pct(c.shock, 0);
  setTexts({
    'advice-buffer': m.liquidated
      ? '目前一開倉就在斷頭線以下'
      : `目前可扛反向 ${pct(m.buffer)}（${points(m.liquidationPoints)}）才會斷頭`,
    'advice-loss-label': `反向 ${shock}（${points(c.entry * c.shock)}）虧損`,
    'advice-loss': money(need.loss),
    'advice-liq': money(need.avoidLiquidation),
    'advice-mc': money(need.avoidMarginCall),
    'advice-gap': need.gap > 0
      ? `還差 ${money(need.gap)} 才扛得住 ${shock} 不被斷頭。`
      : `已足夠扛住 ${shock} 不被斷頭（多出 ${money(-need.gap)}）。`,
  });
  $('#advice-gap').className = `advice-gap ${need.gap > 0 ? 'bad' : 'good'}`;
}

function renderDetail(m) {
  setTexts({
    'd-notional': money(m.notional),
    'd-initial': money(m.initialMargin),
    'd-maint': money(m.maintenanceMargin),
    'd-ratio': pct(state.settings.liquidationRatio, 0),
    'd-liq-equity': money(m.liquidationEquity),
    'd-maxloss': m.maxLoss > 0 ? money(m.maxLoss) : '—',
    'd-lev': `${fmt1.format(m.leverage)}x ／ ${fmt1.format(m.maxLeverage)}x`,
  });
}

function renderCalc() {
  const c = state.calc;
  const { margins } = state.settings;
  const m = positionMetrics(c, state.settings);
  setText('calc-contract-info',
    `原始保證金 ${money(margins[c.contract].initial)} · 維持 ${money(margins[c.contract].maintenance)} · 乘數 ${m.multiplier}`);
  // 快捷鈕的選中狀態由目前數值推得：手動輸入剛好等於某個快捷值時也會亮起，改了口數後保證金倍數不再相符就熄滅
  for (const b of $$('[data-qty]')) b.setAttribute('aria-pressed', String(Number(b.dataset.qty) === c.qty));
  for (const b of $$('[data-deposit-mult]')) {
    const target = Number(b.dataset.depositMult) * margins[c.contract].initial * c.qty;
    b.setAttribute('aria-pressed', String(target === c.deposit));
  }
  renderLeverage(c, m);
  renderRisk(c, m);
  renderAdvice(c, m);
  renderDetail(m);
}

function bindCalcExtras() {
  const form = $('#calc-form');
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const c = state.calc;
    let patch = null;
    if (b.dataset.step) {
      const key = b.dataset.step;
      const next = c[key] + Number(b.dataset.delta);
      if (next >= 1 && (key !== 'qty' || next <= LIMITS.maxQty)) patch = { [key]: next };
    } else if (b.dataset.qty) {
      patch = { qty: Number(b.dataset.qty) };
    } else if (b.dataset.depositMult) {
      patch = { deposit: Number(b.dataset.depositMult) * state.settings.margins[c.contract].initial * c.qty };
    } else if (b.id === 'calc-reset') {
      patch = store.defaultState().calc;
    }
    if (patch) {
      update('calc', patch);
      syncForm('calc');
    }
  });

  $('#shock-options').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) update('calc', { shock: Number(b.value) });
  });
}

// ---------- ② 網格倉位階梯 ----------

function gridRow(r) {
  const num = (text) => h('td', { className: 'num', textContent: text });
  const head = [h('td', { textContent: String(r.level) }), num(fmt0.format(r.price))];
  if (r.status === GRID_STATUS.OK) {
    return h('tr', { className: `zone-row zone-${r.zone.key}` }, ...head,
      num(String(r.qty)),
      num(fmt1.format(r.avg)),
      num(`${fmt1.format(r.leverage)}x`),
      num(pct(r.riskRatio, 0)),
      num(r.marginCallPrice > 0 ? fmt0.format(r.marginCallPrice) : '—'),
      num(r.liquidationPrice > 0 ? fmt0.format(r.liquidationPrice) : '—'),
      num(r.liquidationPrice > 0 ? pct(r.buffer) : '不會斷頭'));
  }
  const reason = {
    [GRID_STATUS.NO_MARGIN]: () => `保證金不足無法加碼：權益 ${money(r.equity)} ＜ 需求 ${money(r.required)}`,
    [GRID_STATUS.LIQUIDATED]: () => `到不了這格：價格先觸及斷頭價 ${fmt0.format(r.liquidationPrice)}`,
    [GRID_STATUS.INVALID_PRICE]: () => '價格 ≤ 0，網格超出合理範圍',
  }[r.status]();
  return h('tr', { className: 'stop-row' }, ...head, h('td', { className: 'stop', colSpan: 7, textContent: reason }));
}

function gridSummary(g, rows) {
  const okRows = rows.filter((r) => r.status === GRID_STATUS.OK);
  const last = okRows[okRows.length - 1];
  const stop = rows.find((r) => r.status !== GRID_STATUS.OK);
  if (!last) {
    return stop?.status === GRID_STATUS.NO_MARGIN
      ? `存入保證金不足以開第一格（需要 ${money(stop.required)}）。`
      : '請檢查輸入。';
  }
  const head = `最多加碼到第 ${last.level} 格（${fmt0.format(last.price)}），共 ${last.qty} 口，均價 ${fmt1.format(last.avg)}；`
    + (last.liquidationPrice > 0
      ? `此時斷頭價 ${fmt0.format(last.liquidationPrice)}，距斷頭 ${pct(last.buffer)}，`
      : '價格歸零前都不會斷頭，')
    + `槓桿 ${fmt1.format(last.leverage)}x。`;
  const tail = {
    [GRID_STATUS.NO_MARGIN]: `第 ${stop?.level} 格保證金不足，無法再加碼。`,
    [GRID_STATUS.LIQUIDATED]: `價格到第 ${stop?.level} 格前就會先被斷頭。`,
    [GRID_STATUS.INVALID_PRICE]: `第 ${stop?.level} 格價格 ≤ 0，只有前 ${last.level} 格有效。`,
  }[stop?.status] ?? `${g.levels} 格全部可執行。`;
  return `${head} ${tail}`;
}

function renderGrid() {
  const rows = gridLadder(state.grid, state.settings);
  $('#grid-body').replaceChildren(...rows.map(gridRow));
  setText('grid-summary', gridSummary(state.grid, rows));
}

// ---------- ③ 法規與設定 ----------

function renderRules() {
  const { margins, liquidationRatio } = state.settings;
  for (const el of $$('[data-liq-ratio]')) el.textContent = pct(liquidationRatio, 0);
  const { initial, maintenance } = margins.TMF;
  const gap = (initial - maintenance) / CONTRACTS.TMF.multiplier;
  setText('rules-example', `以微台為例，原始 ${money(initial)}、維持 ${money(maintenance)}，相差 ${fmt0.format(initial - maintenance)} 元 ÷ 乘數 ${CONTRACTS.TMF.multiplier} ≈ ${points(gap)}，指數反向走這麼多就會收到追繳。`);
}

function renderSettings() {
  const s = state.settings;
  const marginInput = (code, kind) => {
    const input = h('input', { type: 'number', name: `${kind}-${code}`, min: '1', step: '1', required: true, value: String(s.margins[code][kind]) });
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('aria-label', `${CONTRACTS[code].short}${kind === 'initial' ? '原始' : '維持'}保證金`);
    return h('td', { className: 'num' }, input);
  };
  $('#settings-body').replaceChildren(...CONTRACT_CODES.map((code) => h('tr', {},
    h('td', { textContent: CONTRACTS[code].short }),
    marginInput(code, 'initial'),
    marginInput(code, 'maintenance'))));
  const f = $('#settings-form');
  f.marginDate.value = s.marginDate;
  f.liquidationRatio.value = +(s.liquidationRatio * 100).toFixed(2);
}

function bindSettings() {
  const msg = (text) => setText('settings-msg', text);
  const apply = (settings, text) => {
    state = store.normalize({ ...state, settings });
    persist();
    renderAll();
    msg(text);
  };

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const margins = {};
    for (const code of CONTRACT_CODES) {
      const m = { initial: Number(f[`initial-${code}`].value), maintenance: Number(f[`maintenance-${code}`].value) };
      if (!isValidMargin(m)) {
        msg(`${CONTRACTS[code].short}：保證金需為正數，且維持保證金不可高於原始保證金。`);
        return;
      }
      margins[code] = m;
    }
    const ratio = Number(f.liquidationRatio.value) / 100;
    if (!isValidRatio(ratio)) {
      msg('代沖銷門檻需介於 0% 到 100% 之間。');
      return;
    }
    apply({ ...state.settings, margins, marginDate: f.marginDate.value, liquidationRatio: ratio }, '已儲存。');
  });

  $('#reset-settings').addEventListener('click', () => {
    apply({ ...store.defaultSettings(), colorScheme: state.settings.colorScheme }, '已還原為預設值。');
  });
}

// ---------- 漲跌配色與分頁 ----------

function applyColorScheme() {
  document.documentElement.dataset.colors = state.settings.colorScheme;
  for (const b of $$('[data-colors]')) b.setAttribute('aria-pressed', String(b.dataset.colors === state.settings.colorScheme));
}

function bindColorToggle() {
  for (const b of $$('button[data-colors]')) {
    b.addEventListener('click', () => {
      state = { ...state, settings: { ...state.settings, colorScheme: b.dataset.colors } };
      persist();
      applyColorScheme();
    });
  }
}

const PAGES = ['calc', 'grid', 'rules'];

function route() {
  const hash = location.hash.slice(1);
  const page = PAGES.includes(hash) ? hash : 'calc';
  for (const p of $$('[data-page]')) p.hidden = p.dataset.page !== page;
  for (const a of $$('[data-tab]')) {
    if (a.dataset.tab === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ---------- 啟動 ----------

/** 依目前 state 重繪所有畫面（設定表單會被覆寫，只在整份取代設定時呼叫） */
function renderAll() {
  renderSettings();
  renderRules();
  renderCalc();
  renderGrid();
}

for (const select of $$('[data-contract-select]')) {
  for (const code of CONTRACT_CODES) select.add(new Option(CONTRACTS[code].name, code));
}
bindForm('calc');
bindForm('grid');
bindCalcExtras();
bindSettings();
bindColorToggle();
syncForm('calc');
syncForm('grid');
applyColorScheme();
renderAll();
route();
window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});
refreshQuote();
