/**
 * utils.js
 * 全功能工具箱：包含數學運算、統計邏輯、命理轉換，以及資料讀取與 API 連線 (Scheme B)
 */

// ==========================================
// 1. 資料處理與 IO 工具 (Data & IO Tools)
// ==========================================

// 解析 CSV 字串為物件 (支援大小順序與開出順序)
function parseCSVLine(line) {
    const cleanLine = line.replace(/^\uFEFF/, '').trim(); // 去除 BOM
    if (!cleanLine) return null;
    
    // 處理 CSV 欄位 (去除引號)
    const cols = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) return null;

    // 判斷遊戲類型
    const gameNameMap = {
        '大樂透': 'Lotto649', '威力彩': 'SuperLotto638', '今彩539': 'Daily539',
        '雙贏彩': 'Lotto1224', '3星彩': '3D', '4星彩': '4D'
    };
    let matchedGame = null;
    for (const [ch, en] of Object.entries(gameNameMap)) {
        if (cols[0].includes(ch)) { matchedGame = en; break; }
    }
    if (!matchedGame) return null;

    // 解析日期 (民國轉西元)
    const dateMatch = cols[2].match(/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) return null;
    let year = parseInt(dateMatch[1]);
    if (year < 1911) year += 1911;
    const dateStr = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

    // 解析號碼 (假設 CSV 後面欄位是開出順序，如果 ZIP 格式不同需調整)
    // 這裡我們盡量抓取所有數字欄位
    const numbers = [];
    for (let i = 5; i < cols.length; i++) {
        if (/^\d+$/.test(cols[i])) numbers.push(parseInt(cols[i]));
    }
    if (numbers.length < 2) return null;

    // 因為歷史 CSV 通常只提供一組號碼，我們暫時將其視為 "開出順序" (appear)
    // 並自動排序產生 "大小順序" (size)
    const numsAppear = [...numbers];
    const numsSize = [...numbers].sort((a, b) => a - b);

    return {
        game: matchedGame,
        data: {
            date: dateStr, // 保持字串，合併後轉 Date
            period: cols[1],
            numbers: numsAppear,       // 預設為開出順序
            numbers_size: numsSize,    // 大小順序
            source: 'history_zip'
        }
    };
}

// 下載並解壓縮 ZIP 檔
export async function fetchAndParseZip(url) {
    if (!window.JSZip) { console.error("JSZip library not found"); return {}; }
    try {
        const res = await fetch(url);
        if (!res.ok) return {};
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        const zipData = {};
        
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__')) {
                const text = await zip.files[filename].async("string");
                // 嘗試不同編碼解碼 (JS 讀出來通常是 UTF-8，若亂碼可能需要 TextDecoder，這裡簡化處理)
                const lines = text.split(/\r\n|\n/);
                lines.forEach(line => {
                    const parsed = parseCSVLine(line);
                    if (parsed) {
                        if (!zipData[parsed.game]) zipData[parsed.game] = [];
                        zipData[parsed.game].push(parsed.data);
                    }
                });
            }
        }
        return zipData;
    } catch (e) {
        console.warn(`Failed to parse ZIP ${url}:`, e);
        return {};
    }
}

// 取得前端 API 需要的日期區間 (近3個月)
function getApiDateRange() {
    const today = new Date();
    const endY = today.getFullYear();
    const endM = today.getMonth() + 1;
    
    // 回推3個月 (包含本月) -> 減2
    let startY = endY;
    let startM = endM - 2;
    
    if (startM <= 0) {
        startM += 12;
        startY -= 1;
    }
    
    const pad = (n) => n.toString().padStart(2, '0');
    return {
        startMonth: `${startY}-${pad(startM)}`,
        endMonth: `${endY}-${pad(endM)}`
    };
}

// 前端即時抓取 Live Data
export async function fetchLiveLotteryData() {
    const GAMES = {
        'Lotto649': 'Lotto649', 'SuperLotto638': 'SuperLotto638',
        'Daily539': 'Daily539', 'Lotto1224': 'Lotto1224',
        '3D': '3D', '4D': '4D'
    };
    const API_BASE = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery';
    const { startMonth, endMonth } = getApiDateRange();
    const liveData = {};

    console.log(`[Utils] Fetching Live Data: ${startMonth} ~ ${endMonth}`);

    for (const code of Object.values(GAMES)) {
        try {
            // 建構 URL
            const url = `${API_BASE}/${code}Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`;
            const res = await fetch(url); // 注意: 若無 Proxy 可能遇 CORS
            if (!res.ok) continue;

            const json = await res.json();
            const contentKey = Object.keys(json.content || {})[0]; // 自動抓取 key (如 lotto649Res)
            const records = json.content[contentKey] || [];
            console.log(`🔍 [${code}] contentKey="${contentKey}", records 是陣列嗎？${Array.isArray(records)}, records=`, records);


            if (!liveData[code]) liveData[code] = [];

            records.forEach(item => {
                const dateStr = item.lotteryDate.split('T')[0];
                const numsSize = item.drawNumberSize || [];
                const numsAppear = item.drawNumberAppear || [];
                
                // 確保有數字
                if (numsSize.length > 0 || numsAppear.length > 0) {
                    liveData[code].push({
                        date: dateStr, // 字串
                        period: String(item.period),
                        numbers: numsAppear.length > 0 ? numsAppear : numsSize, // 預設開出順序
                        numbers_size: numsSize.length > 0 ? numsSize : numsAppear, // 大小順序
                        source: 'live_api'
                    });
                }
            });
        } catch (e) {
            console.error(`❌ API 錯誤 [${code}]:`, e);  // ← 改這行
        }
    }
    return liveData;
}

// 合併多重來源資料 (Base + ZIPs + Live + Firestore)
export function mergeLotteryData(baseData, zipResults, liveData, firestoreData) {
    const merged = { ...baseData.games }; // 淺拷貝

    // 1. 合併 ZIP 資料
    zipResults.forEach(zipGameData => {
        for (const [game, rows] of Object.entries(zipGameData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    });

    // 2. 合併 Live Data
    if (liveData) {
        for (const [game, rows] of Object.entries(liveData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    // 3. 合併 Firestore Data (個人補完或歷史紀錄)
    if (firestoreData) {
         for (const [game, rows] of Object.entries(firestoreData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    // 4. 去重與排序
    for (const game in merged) {
        const unique = new Map();
        merged[game].forEach(item => {
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            // Live API > Firestore > ZIP > Base (後蓋前)
            if (!unique.has(key) || item.source === 'live_api') {
                unique.set(key, item);
            }
        });
        // 轉回陣列並排序 (由新到舊)
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
    try {
        localStorage.setItem('lottery_live_cache', JSON.stringify({
            timestamp: Date.now(),
            data: data
        }));
    } catch (e) {}
}

export function loadFromCache() {
    try {
        const raw = localStorage.getItem('lottery_live_cache');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

// Firestore 存取 (包含重複檢查)
export async function saveToFirestore(db, newData) {
    if (!db || !window.firebaseModules) return;
    const { doc, getDoc, setDoc } = window.firebaseModules;
    
    // 只寫入 'live_api' 來源的資料
    for (const [game, rows] of Object.entries(newData)) {
        for (const row of rows) {
            if (row.source === 'live_api') {
                const docId = `${row.date}_${row.period}`;
                const ref = doc(db, 'artifacts', 'lottery-app', 'public', 'data', game, docId);
                
                try {
                    // [Optimization] 先檢查是否存在，避免重複寫入浪費額度
                    const snap = await getDoc(ref);
                    if (!snap.exists()) {
                        await setDoc(ref, row);
                        console.log(`[Firestore] New record saved: ${game} ${row.period}`);
                    }
                } catch (e) {
                    console.error("Firestore Save Error:", e);
                }
            }
        }
    }
}

export async function loadFromFirestore(db) {
    // 這裡實作讀取邏輯，若需要從 Firestore 讀取歷史補完
    // 為避免過多讀取，通常只讀取特定區間，此處回傳空物件示意
    // 若需實作可使用 getDocs + query
    return {}; 
}

// ==========================================
// 2. 核心選號引擎 (The Core Engine)
// ==========================================
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) {
    const max = range; const min = (mode.includes('digit')) ? 0 : 1; 
    const totalDraws = stats ? stats.totalDraws : 0; const recentDrawsCount = 30;
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

// ==========================================
// 3. 統計與數學工具 (Math & Stats Tools)
// ==========================================
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
    if (["武曲", "七殺", "文昌", "擎羊"].some(s => star.includes(s))) return [4, 9]; 
    if (["天機", "貪狼", "天梁"].some(s => star.includes(s))) return [3, 8]; 
    if (["太陰", "天同", "破軍", "巨門", "文曲"].some(s => star.includes(s))) return [1, 6]; 
    if (["太陽", "廉貞", "火星", "鈴星"].some(s => star.includes(s))) return [2, 7]; 
    if (["紫微", "天府", "天相", "左輔", "右弼"].some(s => star.includes(s))) return [5, 0]; 
    return [];
}
