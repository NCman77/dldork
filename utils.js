/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 *
 * V25.13: 修正 API 資料解析結構 (使用 drawNumberSize/drawNumberAppear)
 * V25.14: 最終 CORS Proxy 修正 (更換為 thingproxy.freeboard.io)
 * V25.15: 🔥 Proxy 全面修正（thingproxy 已失效 → 改 corsproxy.io）
 *         + 加上 Proxy fallback，避免 APP 因 Proxy 掛掉而整個死掉
 */

// =======================
// 🔥【 Firebase Firestore 】
// =======================

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



// =======================
// 🔥【 Proxy 抓取台彩 API 】
// =======================

/**
 * Proxy 選擇（第一個壞掉會自動改第二個）
 */
const PROXY_LIST = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,   // 主 Proxy（速度快）
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // 備用
];

/**
 * 封裝：自動使用 Proxy（會 fallback）
 */
async function safeFetch(url) {
    let lastError = null;

    for (const wrap of PROXY_LIST) {
        const proxyUrl = wrap(url);

        try {
            const res = await fetch(proxyUrl, { method: "GET" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();

            // 嘗試解析 JSON（避免代理包 double-encode）
            try {
                const obj = JSON.parse(text);
                return obj;
            } catch {
                // 有的 Proxy 會直接回 raw JSON，不包 content-type
                return JSON.parse(text);
            }

        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Proxy 失敗：${proxyUrl}`, err.message);
        }
    }

    throw lastError ?? new Error("所有 Proxy 均無法使用");
}



/**
 * === 主函式：從台彩官方 API 取得最新開獎紀錄 ===
 */
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
            const json = await safeFetch(fullUrl);

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
            console.error(`❌ [API] ${gameName} 抓取失敗：`, e.message);
        }
    });

    await Promise.all(tasks);
    return liveData;
}



// =======================
// ZIP Parser
// =======================

export async function fetchAndParseZip(url) {
    try {
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
    } catch { return {}; }

    return {};
}



// =======================
// 資料合併
// =======================

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



// =======================
// LocalStorage Cache
// =======================

export function saveToCache(data) {
    try {
        localStorage.setItem('lottery_live_cache', JSON.stringify({ t: Date.now(), d: data }));
    } catch { }
}

export function loadFromCache() {
    try {
        return JSON.parse(localStorage.getItem('lottery_live_cache'));
    } catch {
        return null;
    }
}

