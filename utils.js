/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 * V25.8: 整合官方 API (Proxy)、Firebase 跨裝置同步
 */

// --- 資料處理工具 (Data Handling Tools) ---

/**
 * 從 Firebase Firestore 讀取最新的開獎資料 (跨裝置同步)
 * 路徑: artifacts/lottery-app/public/data/latest_draws
 */
export async function loadFromFirestore(db) {
    if (!db || !window.firebaseModules) return null;
    const { doc, getDoc } = window.firebaseModules;
    try {
        const ref = doc(db, 'artifacts', 'lottery-app', 'public', 'data', 'latest_draws');
        const snap = await getDoc(ref);
        if (snap.exists()) {
            console.log("🔥 [Firebase] 成功讀取雲端最新開獎資料");
            return snap.data().games;
        }
    } catch (e) {
        console.warn("Firebase load failed:", e);
    }
    return null;
}

/**
 * 將最新的開獎資料寫入 Firebase Firestore
 */
export async function saveToFirestore(db, data) {
    if (!db || !window.firebaseModules || !data) return;
    const { doc, setDoc } = window.firebaseModules;
    try {
        // 只儲存必要的遊戲資料
        const ref = doc(db, 'artifacts', 'lottery-app', 'public', 'data', 'latest_draws');
        await setDoc(ref, { 
            games: data,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log("☁️ [Firebase] 最新資料已同步至雲端");
    } catch (e) {
        console.warn("Firebase save failed:", e);
    }
}

/**
 * 透過官方 API (Via Proxy) 抓取當年度最新開獎結果
 * 使用者提供的 API: startMonth=YYYY-01 & endMonth=YYYY-12
 */
export async function fetchLiveLotteryData() {
    const now = new Date();
    const year = now.getFullYear();
    // 鎖定當年度 1月 到 12月，確保抓到今年所有資料
    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;

    const apiMap = {
        '威力彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: 'superLotto638Res', type: 'power' 
        },
        '大樂透': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: 'lotto649Res', type: 'lotto' 
        },
        '今彩539': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: 'daily539Res', type: '539' 
        },
        '3星彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: 'l3DRes', type: '3d' 
        },
        '4星彩': { 
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=200`,
            key: 'l4DRes', type: '4d' 
        }
    };

    const liveData = {};
    console.log(`📡 [API] 開始抓取官方資料 (${startMonth} ~ ${endMonth})...`);

    const promises = Object.entries(apiMap).map(async ([gameName, config]) => {
        try {
            // 使用 allorigins 作為 CORS Proxy
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(config.url)}`;
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const json = await res.json();
            
            // 解析資料 (台彩 API 結構通常在 content 下)
            const content = json.content || {};
            let records = content[config.key];
            
            // 備用方案：如果 key 不對，嘗試找 content 裡面的第一個陣列
            if (!records && typeof content === 'object') {
                const arrays = Object.values(content).filter(v => Array.isArray(v));
                if (arrays.length > 0) records = arrays[0];
            }

            if (Array.isArray(records)) {
                // 正規化資料格式 (Normalize)
                liveData[gameName] = records.map(r => {
                    // 處理號碼
                    let numbers = [];
                    if (config.type === 'power') {
                        // 威力彩: firstSection + secondSection
                        const z1 = (r.firstSection || []).map(n => parseInt(n, 10));
                        const z2 = (r.secondSection || []).map(n => parseInt(n, 10));
                        numbers = [...z1, ...z2];
                    } else if (config.type === 'lotto') {
                        // 大樂透: winningNumbers + specialNumber
                        const z1 = (r.winningNumbers || []).map(n => parseInt(n, 10));
                        const sp = parseInt(r.specialNumber, 10);
                        numbers = [...z1, sp];
                    } else {
                        // 539, 3星, 4星: winningNumbers
                        numbers = (r.winningNumbers || []).map(n => parseInt(n, 10));
                    }
                    
                    // 去除 NaN (防止 API 格式錯誤)
                    numbers = numbers.filter(n => !isNaN(n));

                    return {
                        period: r.drawTerm || r.period, // 期數
                        date: r.date,                   // 日期 (YYYY-MM-DD)
                        numbers: numbers
                    };
                });
                console.log(`✅ [API] ${gameName}: 抓到 ${liveData[gameName].length} 筆資料`);
            }
        } catch (e) {
            console.warn(`⚠️ [API] ${gameName} 抓取失敗:`, e);
        }
    });

    await Promise.all(promises);
    return liveData;
}

/**
 * 從 ZIP 檔案中讀取並解析 JSON 資料
 */
export async function fetchAndParseZip(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        let jsonContent = null;
        const files = Object.keys(zip.files);
        for (const filename of files) {
            if (filename.endsWith('.json')) {
                const fileData = await zip.files[filename].async('string');
                jsonContent = JSON.parse(fileData);
                break; 
            }
        }
        return jsonContent || {};
    } catch (e) {
        // console.warn(`ZIP load failed: ${url}`); // 靜默失敗，不干擾
        return {};
    }
}

/**
 * 資料儲存機制：將最新的資料存入 localStorage (單機備份)
 */
export function saveToCache(data) {
    try {
        const cacheObj = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem('lottery_live_cache', JSON.stringify(cacheObj));
    } catch (e) {
        console.warn("Cache save failed", e);
    }
}

export function loadFromCache() {
    try {
        const str = localStorage.getItem('lottery_live_cache');
        if (!str) return null;
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

/**
 * 合併多個來源的彩券資料
 * 優先順序：Live API > Firestore > ZIP > Base JSON
 */
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
                    merged.games[gameName].push(record);
                    existingPeriods.add(String(record.period));
                }
            });
        }
    };

    // 1. 合併 ZIP (歷史)
    zipDataList.forEach(zip => mergeRecords(zip.games || zip));
    // 2. 合併 Firestore (雲端同步的最新資料)
    mergeRecords(firestoreData);
    // 3. 合併 Live API (當下抓到的最新資料)
    mergeRecords(liveData);
    
    // 4. 全域排序 (日期新到舊)
    for (const gameName in merged.games) {
        merged.games[gameName].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    return merged;
}

// --- 核心選號引擎 (維持不變) ---
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
            const freq30 = data.slice(0, recentDrawsCount).filter(d => d.numbers.includes(num)).length;
            const missingCount = stats.missing ? stats.missing[num] : 0;
            if (mode === 'stat_missing') { tag = '極限回補'; } 
            else if (freq30 > 5) { tag = `近${recentDrawsCount}期${freq30}次`; } 
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
            if (wuxingContext && wuxingContext.tagMap && wuxingContext.tagMap[num]) {
                tag = wuxingContext.tagMap[num];
            } else {
                tag = '流年運數'; 
            }
        }
        resultWithTags.push({ val: num, tag: tag });
    }
    return resultWithTags;
}

// --- 統計與數學工具 (Math & Stats Tools) ---
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

// --- 命理玄學工具 (Metaphysical Tools) ---
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
