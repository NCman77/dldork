/**
 * utils.js
 * 全功能工具箱：包含數學運算、統計邏輯、命理轉換，以及資料讀取與 API 連線 (Scheme C - Circuit Breaker V3)
 * * V3 修正重點：
 * 1. 🔥 Firestore 熔斷機制：一旦偵測到環境限制 (Storage/Network Error)，自動永久停用 Firestore，防止 400 錯誤連發。
 * 2. 🛡️ 深度錯誤攔截：針對 'Access to storage is not allowed' 進行全域防護。
 * 3. 💾 強制記憶體模式：在無痕或沙盒環境下，完全依靠記憶體變數運作。
 */

// ==========================================
// 0. 基礎建設 (Infrastructure)
// ==========================================

// 記憶體快取備援
const _memoryCache = {
    data: null,
    timestamp: 0
};

// Firestore 熔斷開關：一旦發生致命錯誤，將設為 true，停止所有後續連線
let _firestoreDisabled = false;

/**
 * 嘗試讀取 LocalStorage，失敗則回傳 null
 */
function safeGetLocalStorage(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch (e) {
        // 靜默失敗，不污染 Console
        return null;
    }
}

/**
 * 嘗試寫入 LocalStorage，失敗則寫入記憶體
 */
function safeSetLocalStorage(key, value) {
    try {
        if (typeof localStorage === 'undefined') throw new Error("No Storage");
        localStorage.setItem(key, value);
    } catch (e) {
        // 如果是指定的快取 key，轉存記憶體
        if (key === 'lottery_live_cache') {
            try {
                const parsed = JSON.parse(value);
                _memoryCache.data = parsed.data;
                _memoryCache.timestamp = parsed.timestamp;
            } catch (err) { /* ignore */ }
        }
    }
}

// ==========================================
// 1. 資料處理與 IO 工具 (Data & IO Tools)
// ==========================================

// 解析 CSV 字串為物件
function parseCSVLine(line) {
    if (!line) return null;
    const cleanLine = line.replace(/^\uFEFF/, '').trim();
    if (!cleanLine) return null;
    
    const cols = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) return null;

    const gameNameMap = {
        '大樂透': '大樂透', '威力彩': '威力彩', '今彩539': '今彩539',
        '雙贏彩': '雙贏彩', '3星彩': '3星彩', '4星彩': '4星彩',
        '三星彩': '3星彩', '四星彩': '4星彩', '38樂合彩': '威力彩'
    };

    let matchedGame = null;
    for (const [ch, en] of Object.entries(gameNameMap)) {
        if (cols[0].includes(ch)) { matchedGame = en; break; }
    }
    if (!matchedGame) return null;

    const dateMatch = cols[2].match(/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) return null;
    let year = parseInt(dateMatch[1]);
    if (year < 1911) year += 1911;
    const dateStr = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

    const numbers = [];
    for (let i = 5; i < cols.length; i++) { 
        if (/^\d+$/.test(cols[i])) {
            numbers.push(parseInt(cols[i]));
        }
    }

    if (numbers.length < 2) return null;

    const numsAppear = [...numbers];
    const numsSize = [...numbers].sort((a, b) => a - b);

    return {
        game: matchedGame,
        data: {
            date: dateStr,
            period: cols[1],
            numbers: numsAppear,
            numbers_size: numsSize,
            source: 'history_zip'
        }
    };
}

// 下載並解壓縮 ZIP 檔
export async function fetchAndParseZip(url) {
    console.log(`📦 [ZIP] 開始下載: ${url}`);
    
    if (!window.JSZip) { 
        console.error("❌ [ZIP] JSZip library not found"); 
        return {}; 
    }
    
    try {
        const res = await fetch(url);
        if (!res.ok) {
            // 這是預期中的錯誤 (404)，使用 warn 而非 error，並不回傳資料
            console.warn(`⚠️ [ZIP] 跳過無效連結: ${url} (Status ${res.status})`);
            return {};
        }
        
        console.log(`✅ [ZIP] 下載完成: ${url}，開始解壓縮...`);
        
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        const zipData = {};
        let processedFiles = 0;
        let totalLines = 0;
        
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__') && !filename.includes('__MACOSX')) {
                const text = await zip.files[filename].async("string");
                const lines = text.split(/\r\n|\n/);

                let validLines = 0;
                lines.forEach(line => {
                    const parsed = parseCSVLine(line);
                    if (parsed) {
                        if (!zipData[parsed.game]) zipData[parsed.game] = [];
                        zipData[parsed.game].push(parsed.data);
                        validLines++;
                    }
                });
                
                processedFiles++;
                totalLines += validLines;
            }
        }
        
        console.log(`📊 [ZIP] 解析完成: ${url}`, {
            處理檔案數: processedFiles,
            遊戲種類: Object.keys(zipData).length,
            總筆數: totalLines
        });
        
        return zipData;
        
    } catch (e) {
        console.error(`❌ [ZIP] 處理異常: ${url}`, e);
        return {};
    }
}

// 前端即時抓取 Live Data
export async function fetchLiveLotteryData() {
    const GAMES = {
        'Lotto649': 'Lotto649', 'SuperLotto638': 'SuperLotto638',
        'Daily539': 'Daily539', 'Lotto1224': 'Lotto1224',
        '3D': '3D', '4D': '4D'
    };
    const API_BASE = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery';
    const liveData = {};

    const codeMap = {
        'Lotto649': '大樂透', 'SuperLotto638': '威力彩',
        'Daily539': '今彩539', 'Lotto1224': '雙贏彩',
        '3D': '3星彩', '4D': '4星彩'
    };

    const today = new Date();
    const monthsToFetch = [];
    for (let i = 0; i < 2; i++) {
        const targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const yearMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(yearMonth);
    }

    console.log(`[Utils] 🔄 抓取 Live 資料: ${monthsToFetch.join(', ')}`);

    const getContentKey = (code) => {
        if (code === '3D') return 'lotto3DRes';
        if (code === '4D') return 'lotto4DRes';
        return code.charAt(0).toLowerCase() + code.slice(1) + 'Res';
    };

    for (const code of Object.values(GAMES)) {
        const gameName = codeMap[code] || code;
        if (!liveData[gameName]) liveData[gameName] = [];

        const monthPromises = monthsToFetch.map(async (month) => {
            try {
                const url = `${API_BASE}/${code}Result?month=${month}&pageNum=1&pageSize=100`;
                const res = await fetch(url);
                if (!res.ok) return [];

                const json = await res.json();
                const contentKey = getContentKey(code);
                const records = json.content[contentKey] || [];
                return records;
            } catch (e) {
                return [];
            }
        });

        try {
            const allMonthRecords = await Promise.all(monthPromises);
            const allRecords = allMonthRecords.flat();

            allRecords.forEach(item => {
                const dateStr = item.lotteryDate.split('T')[0];
                const numsSize = item.drawNumberSize || [];
                const numsAppear = item.drawNumberAppear || [];
                
                if (numsSize.length > 0 || numsAppear.length > 0) {
                    liveData[gameName].push({
                        date: dateStr,
                        period: String(item.period),
                        numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                        numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                        source: 'live_api'
                    });
                }
            });
            
            if (liveData[gameName].length > 0) {
                 console.log(`✅ [Live] ${gameName}: 取得 ${liveData[gameName].length} 筆`);
            }

        } catch (err) {
            console.error(`❌ [Live] ${gameName} 處理錯誤`, err);
        }
    }
    
    return liveData;
}

// 合併多重來源資料
export function mergeLotteryData(baseData, zipResults, liveData, firestoreData) {
    const merged = { ...baseData.games };

    if (Array.isArray(zipResults)) {
        zipResults.forEach(zipGameData => {
            for (const [game, rows] of Object.entries(zipGameData)) {
                if (!merged[game]) merged[game] = [];
                merged[game] = [...merged[game], ...rows];
            }
        });
    }

    if (liveData) {
        for (const [game, rows] of Object.entries(liveData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    if (firestoreData) {
         for (const [game, rows] of Object.entries(firestoreData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    for (const game in merged) {
        if (!Array.isArray(merged[game])) continue;

        const unique = new Map();
        merged[game].forEach(item => {
            if (!item || !item.date) return;
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            
            if (!unique.has(key) || item.source === 'live_api') {
                unique.set(key, item);
            }
        });
        merged[game] = Array.from(unique.values()).sort((a, b) => {
            const da = new Date(a.date);
            const db = new Date(b.date);
            return db - da;
        });
    }

    return { games: merged };
}

// LocalStorage 快取
export function saveToCache(data) {
    const payload = JSON.stringify({
        timestamp: Date.now(),
        data: data
    });
    safeSetLocalStorage('lottery_live_cache', payload);
}

export function loadFromCache() {
    const raw = safeGetLocalStorage('lottery_live_cache');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    if (_memoryCache.data && (Date.now() - _memoryCache.timestamp < 3600000)) {
        return { data: _memoryCache.data, timestamp: _memoryCache.timestamp };
    }

    return null;
}

// Firestore 存取 (含熔斷機制)
export async function saveToFirestore(db, newData) {
    // 1. 檢查模塊與熔斷狀態
    if (_firestoreDisabled || !db || !window.firebaseModules) return;
    
    const { doc, getDoc, setDoc } = window.firebaseModules;
    
    for (const [game, rows] of Object.entries(newData)) {
        for (const row of rows) {
            if (row.source === 'live_api') {
                const docId = `${row.date}_${row.period}`;
                
                try {
                    const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', `${game}_${docId}`);
                    
                    // 2. 嘗試讀取 (這是最容易觸發 Access Denied 的地方)
                    const snap = await getDoc(ref);
                    
                    if (!snap.exists()) {
                        await setDoc(ref, {
                            ...row,
                            game: game
                        });
                        console.log(`[Firestore] Saved: ${game} ${row.period}`);
                    }
                } catch (e) {
                    // 3. 捕捉致命錯誤：如果環境禁止存取，立即熔斷
                    if (e.message && (e.message.includes('storage') || e.code === 'permission-denied' || e.message.includes('WebChannel'))) {
                        console.warn("🛡️ [Firestore] 環境受限，啟動熔斷機制 (停止後續同步)");
                        _firestoreDisabled = true; 
                        return; // 立即退出
                    }
                    // 其他錯誤則忽略
                }
            }
        }
    }
}

export async function loadFromFirestore(db) {
    // 1. 檢查熔斷狀態
    if (_firestoreDisabled) {
        // console.warn("🛡️ [Firestore] 熔斷中，跳過讀取");
        return {};
    }

    if (!db || !window.firebaseModules) {
        console.warn("⚠️ Firestore 模組未載入");
        return {};
    }
    
    const { collection, getDocs, query, where, orderBy, limit } = window.firebaseModules;
    
    try {
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const dateThreshold = twoMonthsAgo.toISOString().split('T')[0];
        
        const gamesList = ['大樂透', '威力彩', '今彩539', '雙贏彩', '3星彩', '4星彩'];
        
        const queryPromises = gamesList.map(async (gameName) => {
            // 雙重檢查
            if (_firestoreDisabled) return { game: gameName, data: [] };

            try {
                const colRef = collection(db, 'artifacts', 'lottery-app', 'public_data');
                const q = query(
                    colRef,
                    where('game', '==', gameName),
                    orderBy('date', 'desc'),
                    limit(100)
                );
                
                const snapshot = await getDocs(q);
                
                if (!snapshot.empty) {
                    const gameData = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        if (data.date >= dateThreshold) {
                            gameData.push({
                                date: data.date,
                                period: data.period,
                                numbers: data.numbers || [],
                                numbers_size: data.numbers_size || [],
                                source: 'firestore'
                            });
                        }
                    });
                    
                    if (gameData.length > 0) {
                        console.log(`✅ [Firestore] ${gameName}: ${gameData.length} 筆`);
                    }
                    return { game: gameName, data: gameData };
                }
                return { game: gameName, data: [] };

            } catch (e) {
                // 捕捉個別錯誤
                if (e.message && (e.message.includes('storage') || e.message.includes('WebChannel'))) {
                    _firestoreDisabled = true; // 觸發熔斷
                }
                return { game: gameName, data: [] };
            }
        });
        
        const results = await Promise.all(queryPromises);
        
        const gamesData = {};
        results.forEach(result => {
            if (result && result.data && result.data.length > 0) {
                gamesData[result.game] = result.data;
            }
        });
        
        return gamesData;
        
    } catch (e) {
        console.warn("⚠️ [Firestore] 環境限制，暫時無法使用雲端同步");
        _firestoreDisabled = true; // 全域熔斷
        return {};
    }
}

// ==========================================
// 2. 核心選號引擎 (The Core Engine)
// ==========================================
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) {
    const max = range; 
    const min = (mode.includes('digit')) ? 0 : 1; 
    const safeData = Array.isArray(data) ? data : [];
    
    const recentDrawsCount = 30;
    let weights = { ...customWeights };

    if (Object.keys(weights).length === 0 || mode.includes('random')) {
        for(let i=min; i<=max; i++) weights[i] = 10;
        
        if (mode === 'stat') {
            safeData.forEach(d => { 
                const nums = d.numbers.filter(n => n <= max); 
                nums.forEach(n => weights[n] = (weights[n]||10) + 10); 
            });
        } else if (mode === 'ai_weight') {
             safeData.slice(0, 10).forEach((d, idx) => { 
                 const w = 20 - idx; 
                 d.numbers.forEach(n => { 
                     if(n<=max) weights[n] = (weights[n]||0) + w; 
                 }); 
             });
        }
    }

    const selected = []; 
    const pool = [];
    for(let i=min; i<=max; i++) { 
        const w = Math.floor(weights[i] || 1); 
        for(let k=0; k<w; k++) pool.push(i); 
    }

    let safeGuard = 0;
    while(selected.length < count && safeGuard < 1000) {
        safeGuard++;
        if(pool.length === 0) break;
        
        const idx = Math.floor(Math.random() * pool.length); 
        const val = pool[idx];
        const isDigit = mode.includes('digit');
        
        if (isDigit || !selected.includes(val)) {
            selected.push(val);
            if (!isDigit) { 
                const temp = pool.filter(n => n !== val); 
                pool.length = 0; 
                pool.push(...temp); 
            }
        }
    }
    
    if (!mode.includes('digit') && !isSpecial) selected.sort((a,b)=>a-b);
    
    const resultWithTags = [];
    for (const num of selected) {
        let tag = '選號'; 
        if (isSpecial) { 
            tag = '特別號'; 
        } else if (mode === 'stat' || mode === 'stat_missing') {
            const freq30 = safeData.slice(0, recentDrawsCount).filter(d => d.numbers.includes(num)).length;
            const missingCount = (stats && stats.missing) ? stats.missing[num] : 0;
            
            if (mode === 'stat_missing') { tag = '極限回補'; } 
            else if (freq30 > 5) { tag = `近${recentDrawsCount}期${freq30}次`; } 
            else if (missingCount > 15) { tag = `遺漏${missingCount}期`; } 
            else { tag = '常態選號'; }
        } else if (mode === 'pattern') {
            const numTail = num % 10; 
            const lastDrawTails = lastDraw.map(n => n % 10);
            
            if (lastDraw.includes(num)) { tag = '連莊強勢'; } 
            else if (lastDraw.includes(num - 1) || lastDraw.includes(num + 1)) { 
                const neighbor = lastDraw.includes(num-1) ? (num-1) : (num+1); 
                tag = `${neighbor}鄰號`; 
            } 
            else if (lastDrawTails.includes(numTail) && numTail !== 0) { tag = `${numTail}尾群聚`; } 
            else { tag = '版路預測'; }
        } else if (mode === 'ai_weight') {
            const vals = Object.values(weights);
            const maxWeight = vals.length > 0 ? Math.max(...vals) : 1;
            const score = Math.round(((weights[num] || 0) / maxWeight) * 100); 
            tag = `趨勢分${score}`;
        } else if (mode.includes('balance') || mode.includes('random')) {
            const isOdd = num % 2 !== 0; 
            const isBig = num > max / 2;
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

// ==========================================
// 3. 統計與數學工具 (Math & Stats Tools)
// ==========================================
export function getLotteryStats(data, range, count) {
    const isDigit = range === 9; 
    const stats = { freq: {}, missing: {}, totalDraws: data.length };
    const maxNum = isDigit ? 9 : range; 
    const minNum = isDigit ? 0 : 1;
    
    for (let i = minNum; i <= maxNum; i++) { 
        stats.freq[i] = 0; 
        stats.missing[i] = data.length; 
    }
    
    data.forEach((d, drawIndex) => { 
        if (!d.numbers) return;
        d.numbers.forEach(n => { 
            if (n >= minNum && n <= maxNum) { 
                stats.freq[n]++; 
            } 
        });
    });
    
    // 重算 Missing (遺漏期數)
    for (let i = minNum; i <= maxNum; i++) {
        let missing = 0;
        for (let j = 0; j < data.length; j++) {
            if (data[j].numbers.includes(i)) break;
            missing++;
        }
        stats.missing[i] = missing;
    }

    return stats;
}

export function calcAC(numbers) { 
    if (!numbers || numbers.length < 2) return 0;
    let diffs = new Set(); 
    for(let i=0; i<numbers.length; i++) {
        for(let j=i+1; j<numbers.length; j++) {
            diffs.add(Math.abs(numbers[i] - numbers[j]));
        }
    }
    return diffs.size - (numbers.length - 1); 
}

export function checkPoisson(num, freq, totalDraws) { 
    if (totalDraws === 0) return false;
    const theoreticalFreq = totalDraws / 49; 
    return freq < (theoreticalFreq * 0.5); 
}

export function monteCarloSim(numbers, gameDef) { 
    return true; 
}

// ==========================================
// 4. 命理玄學工具 (Metaphysical Tools)
// ==========================================
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
    if (!star) return [];
    if (["武曲", "七殺", "文昌", "擎羊"].some(s => star.includes(s))) return [4, 9]; 
    if (["天機", "貪狼", "天梁"].some(s => star.includes(s))) return [3, 8]; 
    if (["太陰", "天同", "破軍", "巨門", "文曲"].some(s => star.includes(s))) return [1, 6]; 
    if (["太陽", "廉貞", "火星", "鈴星"].some(s => star.includes(s))) return [2, 7]; 
    if (["紫微", "天府", "天相", "左輔", "右弼"].some(s => star.includes(s))) return [5, 0]; 
    return [];
}
