/** 
 * utils.js 
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數 
 * V25.15: 修正所有遊戲抓取 API 的開獎號碼與日期，使用 thingproxy.freeboard.io/fetch 代理
 */ 

// --- Firebase Firestore 雲端同步功能 ---
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
            console.log("☁️ [Firebase] 雲端尚無資料 (等待寫入)");
        }
    } catch (e) {
        console.error("Firebase 讀取失敗 (請檢查規則是否已發布):", e);
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
        console.error("Firebase 寫入失敗 (請檢查規則是否已發布):", e);
    }
}

// --- 官方 API 抓取功能 (核心) ---
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

    const promises = Object.entries(apiMap).map(async ([gameName, config]) => {
        try {
            const targetUrl = `${config.url}&_t=${timestamp}`;
            const proxyUrl = `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(targetUrl)}`;

            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const rawText = await res.text();
            let json;
            try { json = JSON.parse(rawText); } 
            catch { throw new Error("Proxy 回傳數據格式錯誤，無法解析 JSON"); }

            const content = json.content;
            if (!content) throw new Error("API 回傳內容錯誤 (找不到 content)");

            const records = content[config.key];
            if (Array.isArray(records) && records.length > 0) {
                liveData[gameName] = records.map(r => {
                    let numbersAppear = (r.drawNumberAppear || r.winningNumbers || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                    let numbersSize = (r.drawNumberSize || r.winningNumbers || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n));

                    let finalNumbers = (config.type === '3d' || config.type === '4d' || config.type === '539') 
                                         ? numbersAppear
                                         : (config.type === 'lotto' || config.type === 'power') && numbersAppear.length > 0
                                            ? numbersAppear
                                            : numbersAppear;

                    return {
                        period: r.drawTerm || r.period,
                        date: r.lotteryDate || r.date,
                        numbers: finalNumbers,
                        numbers_size: numbersSize
                    };
                });
                console.log(`✅ [API Success] ${gameName} 抓到 ${liveData[gameName].length} 筆 (最新日期: ${liveData[gameName][0].date})`);
            } else {
                console.warn(`⚠️ [API Empty] ${gameName} 無資料`);
            }
        } catch (e) {
            console.error(`❌ [API Failed] ${gameName}:`, e.message);
        }
    });

    await Promise.all(promises);
    return liveData;
}

// --- ZIP 處理 ---
export async function fetchAndParseZip(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.status);
        const blob = await response.blob();
        const zip = await window.JSZip.loadAsync(blob);
        const files = Object.keys(zip.files);
        for (const filename of files) {
            if (filename.endsWith('.json')) {
                const text = await zip.files[filename].async('string');
                return JSON.parse(text);
            }
        }
    } catch(e){ }
    return {};
}

// --- 資料合併 ---
export function mergeLotteryData(baseData, zipDataList, liveData = {}, firestoreData = {}) {
    const merged = JSON.parse(JSON.stringify(baseData));
    if (!merged.games) merged.games = {};

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

    zipDataList.forEach(zip => mergeRecords(zip.games || zip));
    mergeRecords(firestoreData);
    mergeRecords(liveData);

    for (const gameName in merged.games) {
        merged.games[gameName].sort((a,b)=>new Date(b.date)-new Date(a.date));
    }

    return merged;
}

// --- LocalStorage 快取 ---
export function saveToCache(data) { try { localStorage.setItem('lottery_live_cache', JSON.stringify({t:Date.now(), d:data})); } catch(e){} }
export function loadFromCache() { try { return JSON.parse(localStorage.getItem('lottery_live_cache')); } catch(e){return null;} }

// --- 以下演算法維持原樣，不動 ---
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) { /* 省略原始內容 */ }
export function getLotteryStats(data, range, count) { /* 省略原始內容 */ }
export function calcAC(numbers) { /* 省略原始內容 */ }
export function checkPoisson(num, freq, totalDraws) { /* 省略原始內容 */ }
export function monteCarloSim(numbers, gameDef) { /* 省略原始內容 */ }
export function getGanZhi(year) { /* 省略原始內容 */ }
export function getFlyingStars(gan) { /* 省略原始內容 */ }
export function getHeTuNumbers(star) { /* 省略原始內容 */ }
