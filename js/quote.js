// 讀取隨網站部署的 quote.json（GitHub Actions 定時從期交所抓取，非即時）。

import { CONTRACT_CODES } from './contracts.js';
import { isPos } from './validate.js';

const MAX_SYMBOL_LENGTH = 16;

/**
 * 回傳 { quotes: { TX: { last, ref, time, symbol } } }；
 * 檔案不存在或沒有任何有效報價時丟出例外。quote.json 視為不可信，只保留通過驗證的欄位。
 */
export async function loadQuote() {
  const res = await fetch(`quote.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('行情檔不存在');
  const raw = await res.json();
  const quotes = {};
  for (const code of CONTRACT_CODES) {
    const q = raw?.quotes?.[code];
    if (q && isPos(q.last)) {
      quotes[code] = {
        last: q.last,
        ref: isPos(q.ref) ? q.ref : null,
        time: typeof q.time === 'string' && !Number.isNaN(Date.parse(q.time)) ? q.time : null,
        symbol: typeof q.symbol === 'string' ? q.symbol.slice(0, MAX_SYMBOL_LENGTH) : '',
      };
    }
  }
  if (Object.keys(quotes).length === 0) throw new Error('行情檔沒有有效報價');
  return { quotes };
}

/** 給畫面顯示的行情說明文字 */
export function quoteHintText(quote, code, now = Date.now()) {
  if (!quote) return '行情暫不可用，請手動輸入價格';
  const q = quote.quotes[code];
  if (!q) return '此商品暫無行情';
  const fmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  const parts = [`最新 ${fmt.format(q.last)}`];
  if (q.time) {
    const t = new Date(q.time);
    const mins = Math.round((now - t.getTime()) / 60000);
    const hhmm = t.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
    let age = '';
    if (mins >= 1440) age = `（${Math.floor(mins / 1440)} 天前）`;
    else if (mins > 30) age = `（${mins} 分鐘前）`;
    parts.push(hhmm + age);
  }
  if (q.ref) parts.push(`參考價 ${fmt.format(q.ref)}`);
  if (q.symbol) parts.push(q.symbol);
  return parts.join(' · ');
}
