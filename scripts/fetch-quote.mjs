// 由 GitHub Actions 定時執行：從期交所 MIS 抓大台／小台／微台近月報價，寫成 quote.json 隨網站部署。
// 用法：node scripts/fetch-quote.mjs <輸出路徑>
// 結束碼：全部成功 0；部分商品失敗 1（仍寫出成功的部分）；全部失敗 1 且不寫檔。

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONTRACT_CODES } from '../js/contracts.js';

const ENDPOINT = 'https://mis.taifex.com.tw/futures/api/getQuoteList';
// 契約代號 → MIS 商品代號
const MIS_CID = { TX: 'TXF', MTX: 'MXF', TMF: 'TMF' };
// MIS MarketType：'0' 日盤（代號尾碼 -F）、'1' 夜盤（尾碼 -M）
const DAY = '0';
const NIGHT = '1';
// 月契約，例如 TXFJ6-F／TXFJ6-M：第 4 碼月份 A–L（1–12 月）、第 5 碼年份末碼；排除週契約（MX4J6-F）與現貨（TXF-S）
const MONTHLY = /^[A-Z]{3}([A-L])(\d)-[FM]$/;

const num = (s) => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 由月份碼與年份末碼推算到期年月（YYYYMM 數值），取離今年最近、且不早於去年的年份 */
export function expiryKey(symbol, now = new Date()) {
  const m = MONTHLY.exec(symbol);
  if (!m) return null;
  const month = m[1].charCodeAt(0) - 64;
  const thisYear = now.getUTCFullYear();
  const base = Math.floor(thisYear / 10) * 10 + Number(m[2]);
  const year = Math.min(...[base - 10, base, base + 10].filter((y) => y >= thisYear - 1));
  return year * 100 + month;
}

/** 從 MIS 回傳清單挑出近月契約（到期年月最小者），不依賴 API 回傳順序 */
export function pickNearMonth(list, now = new Date()) {
  return list
    .map((q) => ({ q, key: expiryKey(q.SymbolID, now) }))
    .filter((x) => x.key !== null)
    .sort((a, b) => a.key - b.key)[0]?.q ?? null;
}

/**
 * 依臺灣時間決定先抓哪個盤別：08:45–14:59 先日盤（13:45 收盤後到夜盤開盤前仍以日盤收盤價為最新），其餘先夜盤。
 * 回傳 [優先, 備援]，優先盤別抓不到時改抓另一個（例如假日、夜盤暫停）。
 */
export function sessionOrder(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600_000);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return minutes >= 8 * 60 + 45 && minutes < 15 * 60 ? [DAY, NIGHT] : [NIGHT, DAY];
}

function toIsoTime(date, time) {
  if (!/^\d{8}$/.test(date ?? '') || !/^\d{6}$/.test(time ?? '')) return null;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`;
}

async function fetchSession(cid, marketType) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      MarketType: marketType, SymbolType: 'F', KindID: '1', CID: cid,
      ExpireMonth: '', RowSize: '全部', PageNo: '', SortColumn: '', AscDesc: 'A',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const q = pickNearMonth(body?.RtData?.QuoteList ?? []);
  if (!q) throw new Error('找不到近月契約');
  const last = num(q.CLastPrice);
  const ref = num(q.CRefPrice);
  if (!last && !ref) throw new Error('無價格');
  return { symbol: q.SymbolID, name: q.DispCName, last: last ?? ref, ref, time: toIsoTime(q.CDate, q.CTime) };
}

async function fetchNearMonth(cid) {
  const [first, fallback] = sessionOrder();
  try {
    return await fetchSession(cid, first);
  } catch (err) {
    console.error(`::warning::${cid} ${first === DAY ? '日盤' : '夜盤'}抓取失敗（${err.message}），改抓另一盤別`);
    return fetchSession(cid, fallback);
  }
}

async function main(out) {
  const quotes = {};
  const errors = [];
  for (const code of CONTRACT_CODES) {
    try {
      if (!MIS_CID[code]) throw new Error('未設定 MIS 商品代號');
      quotes[code] = await fetchNearMonth(MIS_CID[code]);
    } catch (err) {
      errors.push(`${code}: ${err.message}`);
    }
  }
  for (const e of errors) console.error(`::warning::行情抓取失敗 ${e}`);
  if (Object.keys(quotes).length === 0) return 1;

  const data = { fetchedAt: new Date().toISOString(), source: 'TAIFEX MIS', quotes };
  await writeFile(out, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data));
  return errors.length > 0 ? 1 : 0;
}

// 被測試 import 時不執行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) {
    console.error('用法：node scripts/fetch-quote.mjs <輸出路徑>');
    process.exit(2);
  }
  process.exitCode = await main(out);
}
