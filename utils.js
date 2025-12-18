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
        // 標準遊戲
        '大樂透': '大樂透', '威力彩': '威力彩', '今彩539': '今彩539',
        '雙贏彩': '雙贏彩', '3星彩': '3星彩', '4星彩': '4星彩',
        '三星彩': '3星彩', '四星彩': '4星彩',

        // 修正：解決「大樂透加開獎項」CSV 第一欄顯示為活動名稱的問題
        '春節': '大樂透',
        '端午': '大樂透',
        '中秋': '大樂透',
        '加開': '大樂透',

        // 修正：解決樂合彩與賓果賓果解析為 0 筆的問題
        '49樂合彩': '49樂合彩', 
        '39樂合彩': '39樂合彩', 
        '38樂合彩': '38樂合彩',
        '賓果賓果': '賓果賓果'
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

// 解析號碼 (從第 6 欄開始，跳過銷售金額)
const numbers = [];
for (let i = 6; i < cols.length; i++) {  // ← 改成 6
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
    console.log(`📦 [ZIP] 開始下載: ${url}`);
    
    if (!window.JSZip) { 
        console.error("❌ [ZIP] JSZip library not found"); 
        return {}; 
    }
    
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`❌ [ZIP] HTTP 錯誤: ${url} - Status ${res.status}`);
            return {};
        }
        
        console.log(`✅ [ZIP] 下載完成: ${url}，開始解壓縮...`);
        
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        console.log(`📂 [ZIP] 解壓縮完成: ${url}，檔案數量: ${Object.keys(zip.files).length}`);
        
        const zipData = {};
        let processedFiles = 0;
        let totalLines = 0;
        
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__')) {
                console.log(`📄 [ZIP] 處理 CSV: ${filename}`);
                
                const text = await zip.files[filename].async("string");
const lines = text.split(/\r\n|\n/);

// 🔍 显示前 3 行内容（用于 Debug）
console.log(`📝 [CSV内容] ${filename} 前 3 行:`, lines.slice(0, 3));

let validLines = 0;
lines.forEach(line => {

                    const parsed = parseCSVLine(line);
                    if (parsed) {
                        if (!zipData[parsed.game]) zipData[parsed.game] = [];
                        zipData[parsed.game].push(parsed.data);
                        validLines++;
                    }
                });
                
                console.log(`   ✓ ${filename}: ${validLines} 筆有效資料`);
                processedFiles++;
                totalLines += validLines;
            }
        }
        
        console.log(`📊 [ZIP] 解析完成: ${url}`, {
            處理檔案數: processedFiles,
            遊戲種類: Object.keys(zipData).length,
            總筆數: totalLines,
            遊戲列表: Object.keys(zipData)
        });
        
        return zipData;
        
    } catch (e) {
        console.error(`❌ [ZIP] 處理失敗: ${url}`, e);
        return {};
    }
}


// 取得前端 API 需要的日期區間 (近3個月)
function getApiDateRange() {
    const today = new Date();
    const endY = today.getFullYear();
    const endM = today.getMonth() + 1;
    
    // 回推3個月 (包含本月) -> 減5
    let startY = endY;
    let startM = endM - 5;
    
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
    const liveData = {};

    // 代碼轉換
    const codeMap = {
        'Lotto649': '大樂透', 'SuperLotto638': '威力彩',
        'Daily539': '今彩539', 'Lotto1224': '雙贏彩',
        '3D': '3星彩', '4D': '4星彩'
    };

    // 產生月份清單（往前推 2 個月，加速）
    const today = new Date();
    const monthsToFetch = [];
    for (let i = 0; i < 2; i++) {
        const targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const yearMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(yearMonth);
    }

    console.log(`[Utils] 🔄 抓取資料: ${monthsToFetch.join(', ')}`);

    // 修正 contentKey 函數
    const getContentKey = (code) => {
        if (code === '3D') return 'lotto3DRes';
        if (code === '4D') return 'lotto4DRes';
        return code.charAt(0).toLowerCase() + code.slice(1) + 'Res';
    };

    for (const code of Object.values(GAMES)) {
        const gameName = codeMap[code] || code;
        if (!liveData[gameName]) liveData[gameName] = [];

        // 平行查詢所有月份（加速）
        const monthPromises = monthsToFetch.map(async (month) => {
            try {
                const url = `${API_BASE}/${code}Result?month=${month}&pageNum=1&pageSize=100`;
                const res = await fetch(url);
                if (!res.ok) return [];

                const json = await res.json();
                const contentKey = getContentKey(code);
                const records = json.content[contentKey] || [];
                
                if (records.length > 0) {
                    console.log(`✅ [${gameName}] ${month}: ${records.length} 筆`);
                }
                
                return records;
            } catch (e) {
                console.warn(`⚠️ [${gameName}] ${month} 失敗`);
                return [];
            }
        });

        const allMonthRecords = await Promise.all(monthPromises);
        const allRecords = allMonthRecords.flat();

        // 處理所有記錄
        allRecords.forEach(item => {
            const dateStr = item.lotteryDate.split('T')[0];
            const numsSize = item.drawNumberSize || [];
            const numsAppear = item.drawNumberAppear || [];
            
            if (numsSize.length > 0 || numsAppear.length > 0) {
                liveData[gameName].push({
                    date: dateStr,
                    period: String(item.period),
                    // 核心修改：確保 numbers 預設為 drawNumberAppear (開出順序)
                    // 如果沒有开出顺序，才用大小顺序
                    numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                    numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                    // [新增] 抓取累積獎金 (totalAmount)
                    jackpot: item.totalAmount || 0,
                    source: 'live_api'
                });
            }
        });

        // 備援：如果逐月查詢失敗，嘗試區間查詢
        if (allRecords.length === 0) {
            console.log(`🔄 [${gameName}] 逐月無資料，嘗試區間查詢...`);
            try {
                const startMonth = monthsToFetch[monthsToFetch.length - 1];
                const endMonth = monthsToFetch[0];
                const url = `${API_BASE}/${code}Result?startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=100`;
                const res = await fetch(url);
                
                if (res.ok) {
                    const json = await res.json();
                    const contentKey = getContentKey(code);
                    const records = json.content[contentKey] || [];

                    if (records.length > 0) {
                        console.log(`✅ [${gameName}] 區間查詢: ${records.length} 筆`);
                        
                        records.forEach(item => {
                            const dateStr = item.lotteryDate.split('T')[0];
                            const numsSize = item.drawNumberSize || [];
                            const numsAppear = item.drawNumberAppear || [];
                            
                            if (numsSize.length > 0 || numsAppear.length > 0) {
                                liveData[gameName].push({
                                    date: dateStr,
                                    period: String(item.period),
                                    numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                                    numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                                    // [新增] 抓取累積獎金 (totalAmount) - 這是備援區塊
                                    jackpot: item.totalAmount || 0,
                                    source: 'live_api'
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [${gameName}] 區間查詢失敗`);
            }
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

    // 4. 去重與排序（修正：使用優先權比較）
    for (const game in merged) {
        const unique = new Map();
        
        // 定義優先權（數字越大越優先）
        const priority = { 'live_api': 3, 'firestore': 2, 'history_zip': 1 };
        
        merged[game].forEach(item => {
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            
            // 比較優先權，後來的優先權 >= 既有的就覆蓋
            const existingPriority = unique.has(key) ? priority[unique.get(key).source] || 0 : 0;
            const newPriority = priority[item.source] || 0;
            
            if (newPriority >= existingPriority) {
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
                const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', `${game}_${docId}`);
                
                try {
                    // [Optimization] 先檢查是否存在，避免重複寫入浪費額度
                    const snap = await getDoc(ref);
if (!snap.exists()) {
    await setDoc(ref, {
        ...row,
        game: game  // 新增遊戲名稱欄位
    });
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
    if (!db || !window.firebaseModules) return {};
    
    const { collection, getDocs, query, where, orderBy, limit } = window.firebaseModules;
    
    try {
        console.log("🔄 [Firestore] 正在載入快取資料...");
        
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const dateThreshold = twoMonthsAgo.toISOString().split('T')[0];
        
        const gamesList = ['大樂透', '威力彩', '今彩539', '雙贏彩', '3星彩', '4星彩'];
        
        // 🚀 並行查詢所有遊戲（不用等待）
        const queryPromises = gamesList.map(async (gameName) => {
            try {
                const colRef = collection(db, 'artifacts/lottery-app/public_data');
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
                    
                    console.log(`✅ [Firestore] ${gameName}: ${gameData.length} 筆`);
                    return { game: gameName, data: gameData };
                }
                return { game: gameName, data: [] };
            } catch (e) {
                if (e.code === 'failed-precondition') {
                    console.error(`❌ [Firestore] ${gameName} 需要建立索引`);
                } else {
                    console.warn(`⚠️ [Firestore] ${gameName} 讀取失敗:`, e.message);
                }
                return { game: gameName, data: [] };
            }
        });
        
        // 等待所有查詢完成
        const results = await Promise.all(queryPromises);
        
        // 組合結果
        const gamesData = {};
        results.forEach(result => {
            if (result.data.length > 0) {
                gamesData[result.game] = result.data;
            }
        });
        
        return gamesData;
        
    } catch (e) {
        console.warn("⚠️ [Firestore] 整體讀取失敗:", e);
        return {};
    }
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

// ==========================================
// 5. AI 學派專用統計工具 (AI School Stats V7.0)
// ==========================================

/**
 * 計算半衰期指數衰減權重
 * @param {number} dataLength - 歷史資料總筆數
 * @param {number} halfLife - 半衰期參數（h）
 * @returns {number[]} - 權重陣列，[0] 為最新一期
 */
export function ai_computeHalfLifeWeights(dataLength, halfLife) {
    const weights = [];
    for (let i = 0; i < dataLength; i++) {
        weights.push(Math.pow(0.5, i / halfLife));
    }
    return weights;
}

/**
 * 計算加權統計（曝光槽位 E 和出現次數 C）
 * 注意：numbersPerDraw 必須由呼叫端依據 gameDef 拆好區（主區/特別號/第2區）
 * @param {number[][]} numbersPerDraw - 每期號碼陣列（已拆區），例如 [[1,2,3,4,5,6], [3,5,7,9,12,18], ...]
 * @param {number[]} weights - 權重陣列
 * @param {number} minNum - 最小號碼（樂透為 1，digit 為 0）
 * @param {number} maxNum - 最大號碼（樂透為 range，digit 為 9）
 * @returns {Object} { E: 加權曝光槽位, C: 每個號碼的加權出現次數 }
 */
export function ai_computeWeightedStats(numbersPerDraw, weights, minNum, maxNum) {
    let E = 0;
    const C = {};
    
    // 初始化 C（包含所有可能號碼，含 0）
    for (let n = minNum; n <= maxNum; n++) {
        C[n] = 0;
    }
    
    numbersPerDraw.forEach((nums, idx) => {
        // 防護：weights 越界時視為權重 0
        const w = (idx < weights.length) ? weights[idx] : 0;
        E += w * nums.length; // 該期曝光槽位數 × 權重
        
        nums.forEach(num => {
            if (C[num] !== undefined) {
                C[num] += w;
            }
        });
    });
    
    return { E, C };
}

/**
 * 計算 Log-Lift 動能分數
 * @param {Object} C_short - 短期加權出現次數 { [num]: count }
 * @param {number} E_short - 短期加權曝光槽位
 * @param {Object} C_long - 長期加權出現次數 { [num]: count }
 * @param {number} E_long - 長期加權曝光槽位
 * @param {number} minNum - 最小號碼
 * @param {number} maxNum - 最大號碼
 * @param {number} epsilon - 加性平滑參數（預設 0.5）
 * @returns {Object} - { [num]: momentum }
 */
export function ai_computeLogLift(C_short, E_short, C_long, E_long, minNum, maxNum, epsilon = 0.5) {
    const momentum = {};
    const rangeCount = maxNum - minNum + 1;
    
    for (let n = minNum; n <= maxNum; n++) {
        const p_short = (C_short[n] + epsilon) / (E_short + epsilon * rangeCount);
        const p_long = (C_long[n] + epsilon) / (E_long + epsilon * rangeCount);
        momentum[n] = Math.log(p_short / p_long);
    }
    
    return momentum;
}

/**
 * 計算 Kish 有效樣本數並進行收縮
 * @param {number[]} weights - 權重陣列
 * @param {number} k - 先驗強度參數（預設 8）
 * @returns {number} - 收縮係數 s（0~1 之間）
 */
export function ai_computeKishShrinkage(weights, k = 8) {
    const sumW = weights.reduce((a, b) => a + b, 0);
    const sumW2 = weights.reduce((a, b) => a + b * b, 0);
    
    // 防護：避免除以 0
    if (sumW2 === 0) return 0;
    
    const Neff = (sumW * sumW) / sumW2;
    const s = Neff / (Neff + k);
    return s;
}

/**
 * Percentile Rank 轉換（含低變異拉伸）
 * @param {Object} scores - { [num]: finalScore }
 * @param {number} clampMin - 最小趨勢分（預設 10）
 * @param {number} clampMax - 最大趨勢分（預設 98）
 * @param {number} lowVarianceThreshold - 低變異門檻（預設 0.15）
 * @param {number} stretchFactor - 拉伸係數（預設 1.8）
 * @returns {Object} - { [num]: trendScore (clampMin ~ clampMax) }
 */
export function ai_percentileRankTransform(scores, clampMin = 10, clampMax = 98, lowVarianceThreshold = 0.15, stretchFactor = 1.8) {
    const nums = Object.keys(scores).map(Number);
    const values = nums.map(n => scores[n]);
    
    // 防護：空陣列
    if (values.length === 0) return {};
    
    // 計算標準差
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    
    // 低變異拉伸（以 mean 為中心，在 percentile 之前做）
    let processedScores = { ...scores };
    if (std < lowVarianceThreshold) {
        nums.forEach(n => {
            processedScores[n] = mean + stretchFactor * (scores[n] - mean);
        });
    }
    
    // Deterministic 排序（同分時用號碼 n 決定）
    const sortedNums = nums.sort((a, b) => {
        const diff = processedScores[a] - processedScores[b];
        if (Math.abs(diff) < 1e-10) return a - b; // tie-break: 號碼小的排前面
        return diff;
    });
    
    // Percentile Rank 轉換為趨勢分（線性映射 10~98）
    const trendScores = {};
    const rangeSpan = clampMax - clampMin; // 98 - 10 = 88
    
    sortedNums.forEach((n, rank) => {
        let trendScore;
        if (sortedNums.length === 1) {
            // 防護：只有 1 個號碼時給中間值
            trendScore = clampMin + Math.round(rangeSpan / 2);
        } else {
            // 線性映射：10 + (rank / (n-1)) * 88
            trendScore = clampMin + Math.round((rank / (sortedNums.length - 1)) * rangeSpan);
        }
        
        trendScores[n] = trendScore;
    });
    
    return trendScores;
}
