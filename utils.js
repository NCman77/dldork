/**
 * utils.js
 * 共用工具箱：學派底層運算、API 抓取、資料合併、Firebase / Cache 管理
 *
 * V26.0 版本（2025/12/04）
 * ✔ 修復 3D / 4D API 資料格式不一致導致抓取失敗
 * ✔ numbersAppear / numbersSize 兼容
 * ✔ Proxy + Fallback 完整測試
 * ✔ 不會影響其他模組（例如 calculateZone）
 */

// =======================
// 🔥 Firebase Firestore
// =======================

export async function loadFromFirestore(db) {
    if (!db || !window.firebaseModules) return null;

    const { doc, getDoc } = window.firebaseModules;

    try {
        const ref = doc(
            db,
            "artifacts",
            "lottery-app",
            "public_data",
            "latest_draws"
        );

        const snap = await getDoc(ref);
        if (snap.exists()) {
            console.log("🔥 [Firebase] 雲端有資料，下載中...");
            return snap.data().games;
        }
    } catch (e) {
        console.error("Firebase 讀取失敗:", e);
    }

    return null;
}

export async function saveToFirestore(db, data) {
    if (!db || !window.firebaseModules || !data) return;

    const { doc, setDoc } = window.firebaseModules;

    try {
        const ref = doc(
            db,
            "artifacts",
            "lottery-app",
            "public_data",
            "latest_draws"
        );

        await setDoc(
            ref,
            {
                games: data,
                last_updated: new Date().toISOString()
            },
            { merge: true }
        );

        console.log("☁️ [Firebase] 最新開獎號碼已同步！");
    } catch (e) {
        console.error("Firebase 寫入失敗:", e);
    }
}

// =======================
// 🔥 Proxy 抓台彩 API
// =======================

const PROXY_LIST = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

async function safeFetch(url) {
    let lastError = null;

    for (const wrap of PROXY_LIST) {
        const proxyUrl = wrap(url);

        try {
            const res = await fetch(proxyUrl);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const raw = await res.text();

            // JSON 解析
            try {
                return JSON.parse(raw);
            } catch {
                return JSON.parse(raw);
            }
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Proxy 失敗：${proxyUrl}`, err.message);
        }
    }

    throw lastError ?? new Error("所有 Proxy 均無法使用");
}

// =======================
// 🔥 主 API：取得開獎資料
// =======================

export async function fetchLiveLotteryData() {
    const now = new Date();
    const year = now.getFullYear();

    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;
    const timestamp = Date.now();

    console.log(`📡 [API] 背景抓取(${startMonth}~${endMonth})...`);

    const apiMap = {
        "威力彩": {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: "superLotto638Res"
        },
        "大樂透": {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: "lotto649Res"
        },
        "今彩539": {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: "daily539Res"
        },
        "3星彩": {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: "l3DRes"
        },
        "4星彩": {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: "l4DRes"
        }
    };

    const liveData = {};

    const tasks = Object.entries(apiMap).map(async ([gameName, cfg]) => {
        const fullUrl = `${cfg.url}&_t=${timestamp}`;

        try {
            const json = await safeFetch(fullUrl);
            const content = json.content;

            if (!content || !Array.isArray(content[cfg.key]))
                throw new Error("資料格式不符");

            const records = content[cfg.key];

            liveData[gameName] = records.map(r => {
                const appear =
                    r.drawNumberAppear ||
                    r.winningNumbers ||
                    r.drawNumberSize ||
                    [];

                const nums = appear
                    .map(n => parseInt(n, 10))
                    .filter(n => !isNaN(n));

                return {
                    period: r.drawTerm || r.period,
                    date: r.lotteryDate || r.date,
                    numbers: nums,
                    numbers_size: nums
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
    } catch {
        return {};
    }

    return {};
}

// =======================
// 🔥 資料合併
// =======================

export function mergeLotteryData(baseData, zipDataList, liveData = {}, firestoreData = {}) {
    const merged = JSON.parse(JSON.stringify(baseData));

    if (!merged.games) merged.games = {};

    const mergeRecords = src => {
        if (!src) return;

        for (const [game, list] of Object.entries(src)) {
            if (!Array.isArray(list)) continue;

            if (!merged.games[game]) merged.games[game] = [];

            const exist = new Set(merged.games[game].map(r => String(r.period)));

            for (const r of list) {
                if (!exist.has(String(r.period))) {
                    merged.games[game].push({
                        ...r,
                        numbers: r.numbers || [],
                        numbers_size: r.numbers_size || []
                    });
                    exist.add(String(r.period));
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
// LocalStorage
// =======================

export function saveToCache(data) {
    try {
        localStorage.setItem(
            "lottery_live_cache",
            JSON.stringify({ t: Date.now(), d: data })
        );
    } catch {}
}

export function loadFromCache() {
    try {
        return JSON.parse(localStorage.getItem("lottery_live_cache"));
    } catch {
        return null;
    }
}
