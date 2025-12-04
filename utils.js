/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 *
 * V25.13: 修正 API 資料解析結構 (使用 drawNumberSize/drawNumberAppear)
 * V25.14: 最終 CORS Proxy 修正 (更換為 thingproxy.freeboard.io)
 * V25.15: 🔥 Proxy 全面修正（thingproxy 已失效 → 改 corsproxy.io）
 * V25.16: ✅ Safe fetch: 本地檔案直連、遠端 API 使用 Proxy + fallback
 */

/* =======================
   Firebase Firestore
   ======================= */
export async function loadFromFirestore(db) {
    if (!db || !window.firebaseModules) return null;
    const { doc, getDoc } = window.firebaseModules;

    try {
        const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', 'latest_draws');
        const snap = await getDoc(ref);

        if (snap.exists()) {
            console.log("🔥 [Firebase] 雲端有資料，下載中...");
            return snap.data().games;
        } else {
            console.log("☁️ [Firebase] 雲端尚無資料");
        }
    } catch (e) {
        console.error("Firebase 讀取失敗:", e);
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

        console.log("☁️ [Firebase] 最新開獎號碼已同步！");
    } catch (e) {
        console.error("Firebase 寫入失敗:", e);
    }
}

/* =======================
   Safe Fetch / Proxy
   ======================= */

/**
 * Proxy list (先主 Proxy，再備援)
 * 每個 entry 是一個 wrapper，將原始目標 URL 包成代理 URL
 * 若想改 proxy 只需要改這邊
 */
const PROXY_LIST = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,   // 主 Proxy（效能、穩定）
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // 備援
    // 如需再加其他 proxy 可在此加入
];

/**
 * safeFetch:
 * - 若為本地資源（相對路徑 / data/ / assets/ / file-like） → 直接 fetch(url)
 * - 若為遠端（以 http 或 https 開頭） → 依序嘗試 PROXY_LIST，若所有 proxy 失敗 → 最後嘗試直接 fetch 原始 url（作最後退路）
 *
 * 回傳：
 * - 若呼叫者需要 text/json，呼叫 safeFetchText / safeFetchJSON / safeFetchRawBlob 更直觀
 */
async function safeFetchRaw(url, options = {}) {
    // 判斷是否為本地路徑 (相對路徑或不以 http(s) 開頭)
    const isLocal = !/^https?:\/\//i.test(url);

    if (isLocal) {
        // 直接用原生 fetch（本地檔案不能走外部 proxy）
        return fetch(url, options);
    }

    // 遠端：http(s) -> 嘗試代理清單
    let lastErr = null;
    for (const wrapper of PROXY_LIST) {
        const proxyUrl = wrapper(url);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 9000);
            const res = await fetch(proxyUrl, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            lastErr = err;
            console.warn(`⚠️ proxy 失敗: ${proxyUrl} -> ${err.message}`);
        }
    }

    // 所有 proxy 都失敗，最後嘗試直接 fetch 原始 URL（可能會被 CORS 擋住，但仍作為最後退路）
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    } catch (err) {
        lastErr = lastErr || err;
        console.error("❌ safeFetch 最後直接 fetch 也失敗：", err.message);
        throw lastErr;
    }
}

async function safeFetchJSON(url, options = {}) {
    const res = await safeFetchRaw(url, options);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        // 有些 proxy (或目標) 會已經回傳 JSON object when used via certain proxies;
        // 若解析失敗，再嘗試返回原始 text 作為最後手段（讓呼叫端決定）
        throw new Error("回傳非 JSON 或解析失敗");
    }
}

async function safeFetchText(url, options = {}) {
    const res = await safeFetchRaw(url, options);
    return await res.text();
}

async function safeFetchBlob(url, options = {}) {
    const res = await safeFetchRaw(url, options);
    return await res.blob();
}

/* =======================
   Live Lottery API 抓取
   ======================= */

export async function fetchLiveLotteryData() {
    const now = new Date();
    const year = now.getFullYear();

    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;
    const timestamp = Date.now();

    console.log(`📡 [API] 啟動背景爬蟲 (${startMonth} ~ ${endMonth})`);

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
    const tasks = Object.entries(apiMap).map(async ([gameName, cfg]) => {

        const fullUrl = `${cfg.url}&_t=${timestamp}`;

        try {
            const json = await safeFetchJSON(fullUrl);

            const content = json.content;
            if (!content) throw new Error("content 缺失");

            const records = content[cfg.key];
            if (!Array.isArray(records)) throw new Error("資料格式錯誤");

            liveData[gameName] = records.map(r => {
                let numbersAppear = (r.drawNumberAppear || r.winningNumbers || [])
                    .map(n => parseInt(n, 10)).filter(n => !isNaN(n));

                let numbersSize = (r.drawNumberSize || r.winningNumbers || [])
                    .map(n => parseInt(n, 10)).filter(n => !isNaN(n));

                let finalNumbers = numbersAppear;

                return {
                    period: r.drawTerm || r.period,
                    date: r.lotteryDate || r.date,
                    numbers: finalNumbers,
                    numbers_size: numbersSize
                };
            });

            console.log(`✅ [API] ${gameName} → ${liveData[gameName].length} 筆`);

        } catch (e) {
            console.error(`❌ [API] ${gameName} 抓取失敗：`, e.message || e);
        }
    });

    await Promise.all(tasks);
    return liveData;
}

/* =======================
   ZIP Parser (本地 ZIP)
   ======================= */

export async function fetchAndParseZip(url) {
    try {
        // 本地 zip 一定用原生 fetch
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.status);

        const blob = await response.blob();
        const zip = await window.JSZip.loadAsync(blob);

        for (const filename of Object.keys(zip.files)) {
            if (filename.endsWith(".json")) {
                const text = await zip.files[filename].async("string");
                return JSON.parse(text);
            }
        }
    } catch (err) {
        // 忽略錯誤（例如 404），回傳空物件
        console.warn(`fetchAndParseZip failed for ${url}:`, err.message || err);
        return {};
    }

    return {};
}

/* =======================
   資料合併
   ======================= */

export function mergeLotteryData(baseData, zipDataList, liveData = {}, firestoreData = {}) {
    const merged = JSON.parse(JSON.stringify(baseData));
    if (!merged.games) merged.games = {};

    const mergeRecords = (src) => {
        if (!src) return;
        for (const [gameName, records] of Object.entries(src)) {
            if (!Array.isArray(records)) continue;

            if (!merged.games[gameName]) merged.games[gameName] = [];
            const exists = new Set(merged.games[gameName].map(r => String(r.period)));

            for (const r of records) {
                if (!exists.has(String(r.period))) {
                    merged.games[gameName].push({
                        ...r,
                        numbers: r.numbers || [],
                        numbers_size: r.numbers_size || []
                    });
                    exists.add(String(r.period));
                }
            }
        }
    };

    zipDataList.forEach(z => mergeRecords(z.games || z));
    mergeRecords(firestoreData);
    mergeRecords(liveData);

    for (const game of Object.keys(merged.games)) {
        merged.games[game].sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    return merged;
}

/* =======================
   LocalStorage Cache
   ======================= */

export function saveToCache(data) {
    try {
        // 同時存 d(舊版) 與 data(可能在新版 app.js 被使用)
        localStorage.setItem('lottery_live_cache', JSON.stringify({ t: Date.now(), d: data, data: data }));
    } catch (e) {
        console.warn("saveToCache failed:", e && e.message);
    }
}

export function loadFromCache() {
    try {
        return JSON.parse(localStorage.getItem('lottery_live_cache'));
    } catch (e) {
        return null;
    }
}

/* =======================
   演算法核心（維持原有邏輯）
   ======================= */

export function calculateZone(data, range, count, isSpecial, mode, lastDraw = [], customWeights = {}, stats = {}, wuxingContext = {}) {
    const max = range;
    const min = (mode && mode.includes && mode.includes('digit')) ? 0 : 1;
    let weights = { ...customWeights };

    if (Object.keys(weights).length === 0 || (mode && mode.includes('random'))) {
        for (let i = min; i <= max; i++) weights[i] = 10;
        if (mode === 'stat') {
            data.forEach(d => {
                const nums = d.numbers.filter(n => n <= max);
                nums.forEach(n => weights[n] = (weights[n] || 10) + 10);
            });
        } else if (mode === 'ai_weight') {
            data.slice(0, 10).forEach((d, idx) => {
                const w = 20 - idx;
                d.numbers.forEach(n => {
                    if (n <= max) weights[n] += w;
                });
            });
        }
    }

    const selected = [];
    const pool = [];
    for (let i = min; i <= max; i++) {
        const w = Math.max(0, Math.floor(weights[i] || 0));
        for (let k = 0; k < w; k++) pool.push(i);
    }

    while (selected.length < count) {
        if (pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length);
        const val = pool[idx];
        const isDigit = mode && mode.includes && mode.includes('digit');
        if (isDigit || !selected.includes(val)) {
            selected.push(val);
            if (!isDigit) {
                // 移除所有 pool 中的 val
                let temp = pool.filter(n => n !== val);
                pool.length = 0;
                pool.push(...temp);
            }
        }
    }

    if (!(mode && mode.includes && mode.includes('digit')) && !isSpecial) selected.sort((a, b) => a - b);

    const resultWithTags = [];
    for (const num of selected) {
        let tag = '選號';
        if (isSpecial) { tag = '特別號'; }
        else if (mode === 'stat' || mode === 'stat_missing') {
            const freq30 = data.slice(0, 30).filter(d => d.numbers.includes(num)).length;
            const missingCount = stats && stats.missing ? (stats.missing[num] || 0) : 0;
            if (mode === 'stat_missing') { tag = '極限回補'; }
            else if (freq30 > 5) { tag = `近30期${freq30}次`; }
            else if (missingCount > 15) { tag = `遺漏${missingCount}期`; }
            else { tag = '常態選號'; }
        } else if (mode === 'pattern') {
            const numTail = num % 10;
            const lastDrawTails = lastDraw.map(n => n % 10);
            if (lastDraw.includes(num)) { tag = '連莊強勢'; }
            else if (lastDraw.includes(num - 1) || lastDraw.includes(num + 1)) {
                const neighbor = lastDraw.includes(num - 1) ? (num - 1) : (num + 1);
                tag = `${neighbor}鄰號`;
            } else if (lastDrawTails.includes(numTail) && numTail !== 0) { tag = `${numTail}尾群聚`; }
            else { tag = '版路預測'; }
        } else if (mode === 'ai_weight') {
            const maxWeight = Math.max(...Object.values(weights));
            const score = Math.round((weights[num] / (maxWeight || 1)) * 100);
            tag = `趨勢分${score}`;
        } else if (mode && (mode.includes('balance') || mode.includes('random'))) {
            const isOdd = num % 2 !== 0;
            const isBig = num > max / 2;
            tag = (isBig ? "大號" : "小號") + "/" + (isOdd ? "奇數" : "偶數");
        } else if (mode === 'wuxing') {
            if (wuxingContext && wuxingContext.tagMap && wuxingContext.tagMap[num]) { tag = wuxingContext.tagMap[num]; } else { tag = '流年運數'; }
        }
        resultWithTags.push({ val: num, tag: tag });
    }

    return resultWithTags;
}

export function getLotteryStats(data, range, count) {
    const isDigit = range === 9;
    const stats = { freq: {}, missing: {}, totalDraws: data.length };
    const maxNum = isDigit ? 9 : range;
    const minNum = isDigit ? 0 : 1;
    for (let i = minNum; i <= maxNum; i++) { stats.freq[i] = 0; stats.missing[i] = data.length; }
    data.forEach((d, drawIndex) => { d.numbers.forEach(n => { if (n >= minNum && n <= maxNum) { stats.freq[n]++; if (stats.missing[n] === data.length) { stats.missing[n] = drawIndex; } } }); });
    return stats;
}

export function calcAC(numbers) {
    let diffs = new Set();
    for (let i = 0; i < numbers.length; i++)
        for (let j = i + 1; j < numbers.length; j++)
            diffs.add(Math.abs(numbers[i] - numbers[j]));
    return diffs.size - (numbers.length - 1);
}

export function checkPoisson(num, freq, totalDraws) {
    const theoreticalFreq = totalDraws / 49;
    return freq < (theoreticalFreq * 0.5);
}

export function monteCarloSim(numbers, gameDef) {
    // placeholder, 保持向後相容：預設回傳 true
    if (gameDef && gameDef.type === 'digit') return true;
    return true;
}

export function getGanZhi(year) {
    const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
    const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
    const offset = year - 4;
    return { gan: stems[offset % 10], zhi: branches[offset % 12] };
}

export function getFlyingStars(gan) {
    const map = {
        "甲": { lu: "廉貞", ji: "太陽" }, "乙": { lu: "天機", ji: "太陰" }, "丙": { lu: "天同", ji: "廉貞" },
        "丁": { lu: "太陰", ji: "巨門" }, "戊": { lu: "貪狼", ji: "天機" }, "己": { lu: "武曲", ji: "文曲" },
        "庚": { lu: "太陽", ji: "天同" }, "辛": { lu: "巨門", ji: "文昌" }, "壬": { lu: "天梁", ji: "武曲" },
        "癸": { lu: "破軍", ji: "貪狼" }
    };
    return map[gan] || { lu: "吉星", ji: "煞星" };
}

export function getHeTuNumbers(star) {
    if (["武曲", "七殺", "文昌", "擎羊"].some(s => star.includes(s))) return [4, 9];
    if (["天機", "貪狼", "天梁"].some(s => star.includes(s))) return [3, 8];
    if (["太陰", "天同", "破軍", "巨門", "文曲"].some(s => star.includes(s))) return [1, 6];
    if (["太陽", "廉貞", "火星", "鈴星"].some(s => star.includes(s))) return [2, 7];
    if (["紫微", "天府", "天相", "左輔", "右弼"].some(s => star.includes(s))) return [5, 0];
    return [];
}
