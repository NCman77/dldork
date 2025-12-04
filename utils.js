/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 * V25.16: 改良 API 抓取重試/timeout、號碼解析、日期正規化、proxy fallback、ZIP 錯誤回報
 */
// --- Firebase Firestore 雲端同步功能 ---
export async function loadFromFirestore(db) {
  if (!db || !window.firebaseModules) return null;
  const { doc, getDoc } = window.firebaseModules;
  try {
    // 注意：確認你的 Firestore 結構是否為 collection/document/collection/document
    const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', 'latest_draws');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      console.log("🔥 [Firebase] 雲端有資料，下載中...");
      return snap.data().games || null;
    } else {
      console.log("☁️ [Firebase] 雲端尚無資料 (等待寫入)");
    }
  } catch (e) {
    console.error("Firebase 讀取失敗 (請檢查規則是否已發布):", e && e.message ? e.message : e);
  }
  return null;
}
export async function saveToFirestore(db, data) {
  if (!db || !window.firebaseModules || !data || Object.keys(data).length === 0) return;
  const { doc, setDoc } = window.firebaseModules;
  try {
    const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', 'latest_draws');
    await setDoc(ref, {
      games: data,
      last_updated: new Date().toISOString()
    }, { merge: true });
    console.log("☁️ [Firebase] 最新開獎號碼已同步至雲端！");
  } catch (e) {
    console.error("Firebase 寫入失敗 (請檢查規則是否已發布):", e && e.message ? e.message : e);
  }
}
// --- 小工具：fetch with timeout + retry + exponential backoff ---
async function fetchWithTimeoutAndRetry(url, options = {}, { retries = 2, timeout = 8000, backoff = 500 } = {}) {
  const attempt = async (n, delay) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(id);
      if (n <= 0) throw err;
      await new Promise(r => setTimeout(r, delay));
      return attempt(n - 1, Math.min(delay * 2, 5000));
    }
  };
  return attempt(retries, backoff);
}
// --- 更健壯的號碼解析器（處理陣列、字串、各種分隔符） ---
function parseNumbersField(field) {
  if (field === null || field === undefined) return [];
  if (Array.isArray(field)) {
    return field.flatMap(f => parseNumbersField(f));
  }
  if (typeof field === 'number') return [field];
  if (typeof field === 'string') {
    // 保留數字與常見分隔符，其他字元替換成空白
    const cleaned = field.replace(/[^\d\s,|;:-]+/g, ' ').trim();
    if (!cleaned) return [];
    return cleaned.split(/[\s,|;:-]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  }
  // 若是物件且含有常見欄位，嘗試遞迴
  if (typeof field === 'object') {
    // 例如 { numbers: "01 02 03" } 或 { winningNumbers: [...] }
    if (field.numbers) return parseNumbersField(field.numbers);
    if (field.winningNumbers) return parseNumbersField(field.winningNumbers);
    return [];
  }
  return [];
}
// --- 日期正規化（回傳 ISO 字串或 null） ---
function normalizeDate(d) {
  if (!d) return null;
  if (typeof d === 'number') {
    const dt = new Date(d);
    return isNaN(dt) ? null : dt.toISOString();
  }
  if (typeof d === 'string') {
    // 嘗試常見格式：ISO、YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD
    // 若是純數字 8 位，嘗試解析為 YYYYMMDD
    const trimmed = d.trim();
    if (/^\d{8}$/.test(trimmed)) {
      const y = trimmed.slice(0, 4);
      const m = trimmed.slice(4, 6);
      const day = trimmed.slice(6, 8);
      const iso = `${y}-${m}-${day}T00:00:00.000Z`;
      const dt = new Date(iso);
      return isNaN(dt) ? null : dt.toISOString();
    }
    const dt = new Date(trimmed);
    return isNaN(dt) ? null : dt.toISOString();
  }
  return null;
}
// --- 官方 API 抓取功能（核心） ---
export async function fetchLiveLotteryData() {
  const now = new Date();
  const year = now.getFullYear();
  const startMonth = `${year}-01`;
  const endMonth = `${year}-12`;
  const timestamp = Date.now(); // 防快取
  console.log(`📡 [API] 啟動背景爬蟲 (${startMonth} ~ ${endMonth})...`);
  const apiMap = {
    '威力彩': {
      url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
      key: 'superLotto638Res',
      type: 'power'
    },
    '大樂透': {
      url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
      key: 'lotto649Res',
      type: 'lotto'
    },
    '今彩539': {
      url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
      key: 'daily539Res',
      type: '539'
    },
    '3星彩': {
      url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
      key: 'l3DRes',
      type: '3d'
    },
    '4星彩': {
      url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
      key: 'l4DRes',
      type: '4d'
    }
  };
  const liveData = {};
  const errors = {};
  const promises = Object.entries(apiMap).map(async ([gameName, config]) => {
    const targetUrl = `${config.url}&_t=${timestamp}`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    // 先嘗試透過 proxy（公共 proxy 可能不穩定）
    try {
      const res = await fetchWithTimeoutAndRetry(proxyUrl, {}, { retries: 2, timeout: 8000 });
      const rawText = await res.text();
      let json;
      try {
        json = JSON.parse(rawText);
      } catch (e) {
        throw new Error("Proxy 回傳非 JSON");
      }
      const content = json.content;
      if (!content) throw new Error("Proxy JSON 無 content");
      const records = content[config.key];
      if (!Array.isArray(records) || records.length === 0) {
        errors[gameName] = { source: 'proxy', message: '無資料' };
        console.warn(`⚠️ [API Empty proxy] ${gameName} 無資料`);
        return;
      }
      liveData[gameName] = records.map(r => {
        const nums = parseNumbersField(r.drawNumberAppear || r.winningNumbers || r.drawNumber || r.numbers);
        const numsSize = parseNumbersField(r.drawNumberSize || r.winningNumbers || r.drawNumberSize || r.numbers_size);
        return {
          period: r.drawTerm || r.period || r.term,
          date: normalizeDate(r.lotteryDate || r.date || r.drawDate),
          numbers: nums,
          numbers_size: numsSize
        };
      });
      console.log(`✅ [API Success proxy] ${gameName} 抓到 ${liveData[gameName].length} 筆 (最新日期: ${liveData[gameName][0].date})`);
      delete errors[gameName];
    } catch (proxyErr) {
      console.warn(`proxy 失敗 (${gameName}):`, proxyErr && proxyErr.message ? proxyErr.message : proxyErr);
      errors[gameName] = { source: 'proxy', message: proxyErr && proxyErr.message ? proxyErr.message : String(proxyErr) };
      // 嘗試直接抓原始 API（若 CORS 允許）
      try {
        const res2 = await fetchWithTimeoutAndRetry(targetUrl, {}, { retries: 1, timeout: 8000 });
        const json2 = await res2.json();
        const content2 = json2.content || json2;
        const records2 = content2[config.key];
        if (!Array.isArray(records2) || records2.length === 0) {
          errors[gameName] = { source: 'direct', message: '無資料' };
          console.warn(`⚠️ [API Empty direct] ${gameName} 無資料`);
          return;
        }
        liveData[gameName] = records2.map(r => {
          const nums = parseNumbersField(r.drawNumberAppear || r.winningNumbers || r.drawNumber || r.numbers);
          const numsSize = parseNumbersField(r.drawNumberSize || r.winningNumbers || r.drawNumberSize || r.numbers_size);
          return {
            period: r.drawTerm || r.period || r.term,
            date: normalizeDate(r.lotteryDate || r.date || r.drawDate),
            numbers: nums,
            numbers_size: numsSize
          };
        });
        console.log(`✅ [API Success direct] ${gameName} 抓到 ${liveData[gameName].length} 筆 (最新日期: ${liveData[gameName][0].date})`);
        delete errors[gameName];
      } catch (directErr) {
        console.error(`❌ [API Failed] ${gameName}:`, directErr && directErr.message ? directErr.message : directErr);
        errors[gameName] = { source: 'direct', message: directErr && directErr.message ? directErr.message : String(directErr) };
      }
    }
  });
  await Promise.all(promises);
  // 回傳 data 與 errors，讓上層可以決定 fallback 策略
  return { data: liveData, errors };
}
// --- ZIP 處理（回傳更明確的結果） ---
export async function fetchAndParseZip(url) {
  try {
    const response = await fetchWithTimeoutAndRetry(url, {}, { retries: 2, timeout: 10000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!window.JSZip) throw new Error("JSZip 未載入");
    const zip = await window.JSZip.loadAsync(blob);
    const files = Object.keys(zip.files);
    for (const filename of files) {
      if (filename.endsWith('.json')) {
        const text = await zip.files[filename].async('string');
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch (e) {
          return { ok: false, error: 'ZIP 內 JSON 解析失敗' };
        }
      }
    }
    return { ok: false, error: 'ZIP 內找不到 JSON 檔案' };
  } catch (e) {
    console.error("fetchAndParseZip 失敗:", e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
// --- 資料合併 ---
export function mergeLotteryData(baseData, zipDataList, liveData = {}, firestoreData = {}) {
  const merged = JSON.parse(JSON.stringify(baseData || {}));
  if (!merged.games) merged.games = {};
  // 如果 liveData 是 { data, errors } 的形式，取 data
  if (liveData && liveData.data) liveData = liveData.data;
  const mergeRecords = (sourceObj) => {
    if (!sourceObj) return;
    for (const [gameName, records] of Object.entries(sourceObj)) {
      if (!Array.isArray(records)) continue;
      if (!merged.games[gameName]) merged.games[gameName] = [];
      const existingPeriods = new Set(merged.games[gameName].map(r => String(r.period)));
      records.forEach(record => {
        if (!existingPeriods.has(String(record.period))) {
          merged.games[gameName].push({
            ...record,
            numbers: record.numbers || [],
            numbers_size: record.numbers_size || []
          });
          existingPeriods.add(String(record.period));
        }
      });
    }
  };
  // zipDataList 可能是陣列或單一物件
  if (Array.isArray(zipDataList)) {
    zipDataList.forEach(zip => mergeRecords(zip.games || zip));
  } else if (zipDataList) {
    mergeRecords(zipDataList.games || zipDataList);
  }
  mergeRecords(firestoreData);
  mergeRecords(liveData);
  for (const gameName in merged.games) {
    merged.games[gameName].sort((a, b) => {
      const da = normalizeDate(a.date) ? new Date(normalizeDate(a.date)).getTime() : 0;
      const db = normalizeDate(b.date) ? new Date(normalizeDate(b.date)).getTime() : 0;
      return db - da;
    });
  }
  return merged;
}
// --- LocalStorage 快取 ---
export function saveToCache(data) {
  try {
    // 建議加上 schema 版本與來源標記
    const payload = {
      t: Date.now(),
      v: 1,
      d: data
    };
    localStorage.setItem('lottery_live_cache', JSON.stringify(payload));
  } catch (e) {
    console.warn("saveToCache 失敗:", e && e.message ? e.message : e);
  }
}
export function loadFromCache() {
  try {
    const raw = localStorage.getItem('lottery_live_cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.warn("loadFromCache 失敗:", e && e.message ? e.message : e);
    return null;
  }
}
// --- 以下演算法維持原樣，不動（保留介面） ---
export function calculateZone(data, range, count, isSpecial, mode, lastDraw = [], customWeights = {}, stats = {}, wuxingContext = {}) { /* 省略原始內容 */ }
export function getLotteryStats(data, range, count) { /* 省略原始內容 */ }
export function calcAC(numbers) { /* 省略原始內容 */ }
export function checkPoisson(num, freq, totalDraws) { /* 省略原始內容 */ }
export function monteCarloSim(numbers, gameDef) { /* 省略原始內容 */ }
export function getGanZhi(year) { /* 省略原始內容 */ }
export function getFlyingStars(gan) { /* 省略原始內容 */ }
export function getHeTuNumbers(star) { /* 省略原始內容 */ }
