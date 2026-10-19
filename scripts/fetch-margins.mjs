// 由 GitHub Actions 隨部署執行：從期交所開放資料抓大台／小台／微台保證金，寫成 margins.json 隨網站部署。
// 用法：node scripts/fetch-margins.mjs <輸出路徑>
// 結束碼：成功 0；抓取失敗或資料不合法 1 且不寫檔（workflow 改沿用線上舊檔）。

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_MARGINS } from '../js/contracts.js';
import { sanitizeOfficial, sameMargins } from '../js/margins.js';

const ENDPOINT = 'https://openapi.taifex.com.tw/v1/IndexFuturesAndOptionsMargining';
// 期交所商品名稱 → 契約代號；完全相符比對，排除「客製化小型臺指期貨」等相似名稱
const CONTRACT_NAMES = { 臺股期貨: 'TX', 小型臺指: 'MTX', 微型臺指期貨: 'TMF' };

// API 欄位一律是字串；非字串（含數字）視為格式異常
const toInt = (s) => (typeof s === 'string' && /^\d+$/.test(s) ? Number(s) : null);
const isDateText = (s) => typeof s === 'string' && /^\d{8}$/.test(s);

/** 把 API 回傳清單整理成 { date, margins }；缺商品、欄位不合法或超出合理範圍回傳 null */
export function parseMargins(list) {
  if (!Array.isArray(list)) return null;
  const margins = {};
  let date = null;
  for (const row of list) {
    const code = CONTRACT_NAMES[row?.Contract];
    if (!code) continue;
    margins[code] = { initial: toInt(row.InitialMargin), maintenance: toInt(row.MaintenanceMargin) };
    if (isDateText(row.Date)) date = `${row.Date.slice(0, 4)}-${row.Date.slice(4, 6)}-${row.Date.slice(6, 8)}`;
  }
  return sanitizeOfficial({ date, margins });
}

async function main(out) {
  let official;
  try {
    const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    official = parseMargins(await res.json());
    if (!official) throw new Error('資料缺漏或超出合理範圍');
  } catch (err) {
    console.error(`::warning::保證金抓取失敗（${err.message}）`);
    return 1;
  }
  if (!sameMargins(official.margins, DEFAULT_MARGINS)) {
    console.error('::warning::期交所保證金與內建 DEFAULT_MARGINS 不同，請更新 js/contracts.js 與 README 保證金表');
  }
  const data = { fetchedAt: new Date().toISOString(), source: 'TAIFEX OpenAPI', ...official };
  await writeFile(out, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data));
  return 0;
}

// 被測試 import 時不執行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) {
    console.error('用法：node scripts/fetch-margins.mjs <輸出路徑>');
    process.exit(2);
  }
  process.exitCode = await main(out);
}
