import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuote, quoteHintText } from '../js/quote.js';

describe('loadQuote（fetch stub）', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const respond = (body, ok = true) => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok, status: ok ? 200 : 404, json: async () => body };
    };
    return calls;
  };

  test('正常讀取：保留有效欄位、請求 quote.json 且 no-store', async () => {
    const calls = respond({
      quotes: {
        TX: { last: 47262, ref: 47000, time: '2026-10-16T13:30:00+08:00', symbol: 'TXFK6-F', name: 'x', evil: '<script>' },
      },
    });
    const q = await loadQuote();
    assert.deepEqual(q, { quotes: { TX: { last: 47262, ref: 47000, time: '2026-10-16T13:30:00+08:00', symbol: 'TXFK6-F' } } });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^quote\.json\?t=\d+$/);
    assert.equal(calls[0].opts.cache, 'no-store');
  });

  test('res.ok=false → 丟例外', async () => {
    respond({ quotes: { TX: { last: 1 } } }, false);
    await assert.rejects(loadQuote());
  });

  test('fetch 本身 reject → 丟例外', async () => {
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(loadQuote());
  });

  test('last 非正數的商品被丟棄', async () => {
    respond({
      quotes: {
        TX: { last: 0 }, MTX: { last: '47000' }, TMF: { last: 47100 },
      },
    });
    const q = await loadQuote();
    assert.deepEqual(Object.keys(q.quotes), ['TMF']);
  });

  test('last 為負數、NaN、Infinity 亦丟棄；未知商品忽略', async () => {
    respond({ quotes: { TX: { last: -1 }, MTX: { last: null }, TMF: { last: 1 }, ZZ: { last: 5 }, __proto__: { last: 5 } } });
    const q = await loadQuote();
    assert.deepEqual(Object.keys(q.quotes), ['TMF']);
  });

  test('全部無效 → 丟例外', async () => {
    respond({ quotes: { TX: { last: 0 }, MTX: { last: -5 }, TMF: {} } });
    await assert.rejects(loadQuote());
  });

  test('quotes 缺少或 body 為 null → 丟例外', async () => {
    respond({});
    await assert.rejects(loadQuote());
    respond(null);
    await assert.rejects(loadQuote());
  });

  test('json() 解析失敗 → 丟例外', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } });
    await assert.rejects(loadQuote());
  });

  test('symbol 截斷為 16 字元；非字串 → 空字串', async () => {
    respond({ quotes: { TX: { last: 1, symbol: 'A'.repeat(40) }, TMF: { last: 1, symbol: 123 } } });
    const q = await loadQuote();
    assert.equal(q.quotes.TX.symbol, 'A'.repeat(16));
    assert.equal(q.quotes.TMF.symbol, '');
  });

  test('time 非可解析字串 → null', async () => {
    respond({ quotes: { TX: { last: 1, time: 'not a date' }, MTX: { last: 1, time: 1700000000000 }, TMF: { last: 1 } } });
    const q = await loadQuote();
    assert.equal(q.quotes.TX.time, null);
    assert.equal(q.quotes.MTX.time, null);
    assert.equal(q.quotes.TMF.time, null);
  });

  test('ref 非正數 → null', async () => {
    respond({ quotes: { TX: { last: 1, ref: 0 }, MTX: { last: 1, ref: '100' }, TMF: { last: 1, ref: -3 } } });
    const q = await loadQuote();
    assert.equal(q.quotes.TX.ref, null);
    assert.equal(q.quotes.MTX.ref, null);
    assert.equal(q.quotes.TMF.ref, null);
  });
});

describe('quoteHintText', () => {
  const time = '2026-10-16T13:30:00+08:00';
  const t0 = Date.parse(time);
  const quote = { quotes: { TX: { last: 47262, ref: 47000, time, symbol: 'TXFK6-F' }, TMF: { last: 47262, ref: null, time: null, symbol: '' } } };
  const min = 60000;

  test('quote 為 null', () => {
    assert.equal(quoteHintText(null, 'TX'), '行情暫不可用，請手動輸入價格');
  });
  test('商品不存在', () => {
    assert.equal(quoteHintText(quote, 'MTX'), '此商品暫無行情');
  });
  test('完整內容：最新價千分位、台北時間、參考價、symbol', () => {
    const s = quoteHintText(quote, 'TX', t0 + 5 * min);
    assert.equal(s, '最新 47,262 · 13:30 · 參考價 47,000 · TXFK6-F');
  });
  test('30 分鐘內不顯示經過時間；剛好 30 分鐘也不顯示', () => {
    assert.doesNotMatch(quoteHintText(quote, 'TX', t0 + 30 * min), /分鐘前|天前/);
  });
  test('超過 30 分鐘顯示（N 分鐘前）', () => {
    assert.match(quoteHintText(quote, 'TX', t0 + 31 * min), /13:30（31 分鐘前）/);
    assert.match(quoteHintText(quote, 'TX', t0 + 1439 * min), /（1439 分鐘前）/);
  });
  test('≥ 1440 分鐘顯示（N 天前）', () => {
    assert.match(quoteHintText(quote, 'TX', t0 + 1440 * min), /（1 天前）/);
    assert.match(quoteHintText(quote, 'TX', t0 + 3 * 1440 * min + 100 * min), /（3 天前）/);
    assert.doesNotMatch(quoteHintText(quote, 'TX', t0 + 1440 * min), /分鐘前/);
  });
  test('無 time、ref、symbol 時只顯示最新價', () => {
    assert.equal(quoteHintText(quote, 'TMF', t0), '最新 47,262');
  });
  test('最新價小數四捨五入為整數', () => {
    const s = quoteHintText({ quotes: { TX: { last: 47262.6, ref: null, time: null, symbol: '' } } }, 'TX');
    assert.equal(s, '最新 47,263');
  });
});
