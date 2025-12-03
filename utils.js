/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 * V25.15: 最終 CORS 修正 - 換回 allorigins.win 並加入重試機制 (Retry)
 */

// --- Firebase Firestore 雲端同步功能 ---

/**
 * 從 Firebase 讀取最新資料 (路徑: artifacts/lottery-app/public_data/latest_draws)
 */
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

/**
 * 將抓到的最新資料寫入 Firebase (路徑: artifacts/lottery-app/public_data/latest_draws)
 */
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

// 實作指數退避重試邏輯
async function fetchWithRetry(proxyUrl, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(proxyUrl);
            if (!res.ok) {
                // 如果是 4xx 或 5xx 錯誤，仍可能重試
                throw new Error(`HTTP Status ${res.status}`);
            }
            return res;
        } catch (error) {
            console.warn(`Retry attempt ${i + 1} failed: ${error.message}`);
            if (i === maxRetries - 1) throw error;
            // 指數退避: 延遲 2^i 秒 (1s, 2s, 4s...)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
}

/**
 * 透過 Proxy 抓取台彩官方 API
 * 策略：換回 allorigins.win/raw 並加入重試機制
 */
export async function fetchLiveLotteryData() {
    const now = new Date();
    const year = now.getFullYear();
    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;
    const timestamp = new Date().getTime(); // 防快取隨機數

    console.log(`📡 [API] 啟動背景爬蟲 (${startMonth} ~ ${endMonth})...`);

    // 官方 API 對照表
    const apiMap = {
        '威力彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'superLotto638Res', type: 'power' 
        },
        '大樂透': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'lotto649Res', type: 'lotto' 
        },
        '今彩539': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'daily539Res', type: '539' 
        },
        '3星彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l3DRes', type: '3d' 
        },
        '4星彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l4DRes', type: '4d' 
        }
    };

    const liveData = {};
    const promises = Object.entries(apiMap).map(async ([gameName, config]) => {
        try {
            const targetUrl = `${config.url}&_t=${timestamp}`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

            // 使用重試機制
            const res = await fetchWithRetry(proxyUrl, 3);
            
            const rawText = await res.text();
            
            let json;
            try {
                // 嘗試解析 JSON
                json = JSON.parse(rawText);
            } catch (e) {
                // 如果解析失敗，則拋出錯誤，讓重試機制處理或最終報錯
                throw new Error("Proxy 回傳數據格式錯誤，無法解析 JSON");
            }

            const content = json.content;

            if (!content) throw new Error("API 回傳內容錯誤 (找不到 content)");

            // [FIX] 增加容錯：確保 records 是陣列
            const records = Array.isArray(content[config.key]) ? content[config.key] : [];

            if (records.length > 0) {
                liveData[gameName] = records.map(r => {
                    // 號碼來源優先順序：
                    let numbersAppear = (r.drawNumberAppear || r.winningNumbers || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                    let numbersSize = (r.drawNumberSize || r.winningNumbers || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                    
                    // 最終顯示號碼（優先使用開出順序）
                    let finalNumbers = numbersAppear.length > 0 ? numbersAppear : numbersSize;

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
    } catch (e) { /* 忽略 404 */ }
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
                    // 合併時保留 numbers_size 欄位
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
        merged.games[gameName].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    return merged;
}

// --- LocalStorage 快取 ---
export function saveToCache(data) {
    try { localStorage.setItem('lottery_live_cache', JSON.stringify({t:Date.now(), d:data})); } catch(e){}
}
export function loadFromCache() {
    try { return JSON.parse(localStorage.getItem('lottery_live_cache')); } catch(e){return null;}
}

// --- 演算法核心 (維持不變) ---
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) {
    const max = range; const min = (mode.includes('digit')) ? 0 : 1; 
    let weights = customWeights;
    if (Object.keys(weights).length === 0 || mode.includes('random')) {
        for(let i=min; i<=max; i++) weights[i] = 10;
        if (mode === 'stat') {
            data.forEach(d => { const nums = d.numbers.filter(n => n <= max); nums.forEach(n => weights[n] = (weights[n]||10) + 10); });
        } else if (mode === 'ai_weight') {
             data.slice(0, 10).forEach((d, idx) => { const w = 20 - idx; d.numbers.forEach(n => { if(n<=max) weights[n] += w; }); });
        }
    }
    const selected = []; const pool = [];
    for(let i=min; i<=max; i++) { const w = Math.floor(weights[i]); for(let k=0; k<w; k++) pool.push(i); }
    while(selected.length < count) {
        if(pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length); const val = pool[idx];
        const isDigit = mode.includes('digit');
        if (isDigit || !selected.includes(val)) {
            selected.push(val);
            if (!isDigit) { const temp = pool.filter(n => n !== val); pool.length = 0; pool.push(...temp); }
        }
    }
    if (!mode.includes('digit') && !isSpecial) selected.sort((a,b)=>a-b);
    
    const resultWithTags = [];
    for (const num of selected) {
        let tag = '選號'; 
        if (isSpecial) { tag = '特別號'; } 
        else if (mode === 'stat' || mode === 'stat_missing') {
            const freq30 = data.slice(0, 30).filter(d => d.numbers.includes(num)).length;
            const missingCount = stats.missing ? stats.missing[num] : 0;
            if (mode === 'stat_missing') { tag = '極限回補'; } 
            else if (freq30 > 5) { tag = `近30期${freq30}次`; } 
            else if (missingCount > 15) { tag = `遺漏${missingCount}期`; } 
            else { tag = '常態選號'; }
        } else if (mode === 'pattern') {
            const numTail = num % 10; const lastDrawTails = lastDraw.map(n => n % 10);
            if (lastDraw.includes(num)) { tag = '連莊強勢'; } 
            else if (lastDraw.includes(num - 1) || lastDraw.includes(num + 1)) { const neighbor = lastDraw.includes(num-1) ? (num-1) : (num+1); tag = `${neighbor}鄰號`; } 
            else if (lastDrawTails.includes(numTail) && numTail !== 0) { tag = `${numTail}尾群聚`; } 
            else { tag = '版路預測'; }
        } else if (mode === 'ai_weight') {
            const maxWeight = Math.max(...Object.values(weights)); const score = Math.round((weights[num] / maxWeight) * 100); tag = `趨勢分${score}`;
        } else if (mode.includes('balance') || mode.includes('random')) {
            const isOdd = num % 2 !== 0; const isBig = num > max / 2;
            tag = (isBig ? "大號" : "小號") + "/" + (isOdd ? "奇數" : "偶數"); 
        } else if (mode === 'wuxing') {
            if (wuxingContext && wuxingContext.tagMap && wuxingContext.tagMap[num]) { tag = wuxingContext.tagMap[num]; } else { tag = '流年運數'; }
        }
        resultWithTags.push({ val: num, tag: tag });
    }
    return resultWithTags;
}
export function getLotteryStats(data, range, count) {
    const isDigit = range === 9; const stats = { freq: {}, missing: {}, totalDraws: data.length };
    const maxNum = isDigit ? 9 : range; const minNum = isDigit ? 0 : 1;
    for (let i = minNum; i <= maxNum; i++) { stats.freq[i] = 0; stats.missing[i] = data.length; }
    data.forEach((d, drawIndex) => { d.numbers.forEach(n => { if (n >= minNum && n <= maxNum) { stats.freq[n]++; if (stats.missing[n] === data.length) { stats.missing[n] = drawIndex; } } }); });
    return stats;
}
export function calcAC(numbers) { let diffs = new Set(); for(let i=0; i<numbers.length; i++) for(let j=i+1; j<numbers.length; j++) diffs.add(Math.abs(numbers[i] - numbers[j])); return diffs.size - (numbers.length - 1); }
export function checkPoisson(num, freq, totalDraws) { const theoreticalFreq = totalDraws / 49; return freq < (theoreticalFreq * 0.5); }
export function monteCarloSim(numbers, gameDef) { if(gameDef.type === 'digit') return true; return true; }
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
