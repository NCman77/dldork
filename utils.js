/**
 * utils.js
 * 全功能工具箱：包含數學運算、統計邏輯、命理轉換，以及資料讀取與 API 連線 (Scheme B - Robust V2)
 * * 修正重點：
 * 1. 解決 "Access to storage is not allowed"：增加記憶體快取 (Memory Cache) 作為備援。
 * 2. 強化 ZIP 404 容錯：下載失敗時不中斷，確保流程繼續。
 * 3. Firestore 安全讀取：防止在無權限環境下崩潰。
 */

// ==========================================
// 0. 基礎建設 (Infrastructure)
// ==========================================

// 記憶體快取備援 (當 localStorage 被瀏覽器禁用時使用)
const _memoryCache = {
    data: null,
    timestamp: 0
};

/**
 * 嘗試讀取 LocalStorage，若失敗則回傳 null (不拋出錯誤)
 */
function safeGetLocalStorage(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch (e) {
        // console.warn("LocalStorage access blocked, using memory cache instead.");
        return null;
    }
}

/**
 * 嘗試寫入 LocalStorage，若失敗則寫入記憶體
 */
function safeSetLocalStorage(key, value) {
    try {
        if (typeof localStorage === 'undefined') throw new Error("No Storage");
        localStorage.setItem(key, value);
    } catch (e) {
        // console.warn("LocalStorage write blocked, saving to memory.");
        // 如果是我們指定的快取 key，則存入記憶體
        if (key === 'lottery_live_cache') {
            const parsed = JSON.parse(value);
            _memoryCache.data = parsed.data;
            _memoryCache.timestamp = parsed.timestamp;
        }
    }
}

// ==========================================
// 1. 資料處理與 IO 工具 (Data & IO Tools)
// ==========================================

// 解析 CSV 字串為物件 (支援大小順序與開出順序)
function parseCSVLine(line) {
    if (!line) return null;
    const cleanLine = line.replace(/^\uFEFF/, '').trim(); // 去除 BOM
    if (!cleanLine) return null;
    
    // 處理 CSV 欄位 (去除引號)
    const cols = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) return null;

    // 判斷遊戲類型
    const gameNameMap = {
        '大樂透': '大樂透', '威力彩': '威力彩', '今彩539': '今彩539',
        '雙贏彩': '雙贏彩', '3星彩': '3星彩', '4星彩': '4星彩',
        '三星彩': '3星彩', '四星彩': '4星彩', '38樂合彩': '威力彩' // 部分對應修正
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

    // 解析號碼 (從第 6 欄開始，跳過期數、開獎日、兌獎期限、銷售金額、獎號數)
    // 注意：不同 CSV 格式可能略有差異，這裡採用較寬容的解析
    const numbers = [];
    // 從第 5 欄往後找所有數字 (index 5 is the 6th column)
    for (let i = 5; i < cols.length; i++) { 
        // 排除空字串或非數字內容
        if (/^\d+$/.test(cols[i])) {
            numbers.push(parseInt(cols[i]));
        }
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
            numbers: numsAppear,        // 預設為開出順序
            numbers_size: numsSize,     // 大小順序
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
            console.warn(`⚠️ [ZIP] 跳過無效連結: ${url} (Status ${res.status})`);
            // 回傳空物件而非 null，避免後續處理崩潰
            return {};
        }
        
        console.log(`✅ [ZIP] 下載完成: ${url}，開始解壓縮...`);
        
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        const zipData = {};
        let processedFiles = 0;
        let totalLines = 0;
        
        for (const filename of Object.keys(zip.files)) {
            // 忽略隱藏檔與非 CSV
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__') && !filename.includes('__MACOSX')) {
                // console.log(`📄 [ZIP] 處理 CSV: ${filename}`);
                
                const text = await zip.files[filename].async("string");
                const lines = text.split(/\r\n|\n/);

                // 🔍 顯示前 1 行內容確認格式 (Debug)
                // if (processedFiles === 0) console.log(`📝 [CSV範例] ${filename}:`, lines[0]);

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


// 取得前端 API 需要的日期區間 (近3個月)
function getApiDateRange() {
    const today = new Date();
    const endY = today.getFullYear();
    const endM = today.getMonth() + 1;
    
    // 回推3個月 (包含本月) -> 減5 (保險起見抓半年)
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

    // 產生月份清單（往前推 2 個月）
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

        // 平行查詢所有月份
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
                // console.warn(`⚠️ [${gameName}] ${month} 抓取失敗 (正常現象若無資料)`);
                return [];
            }
        });

        try {
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
                        // 核心邏輯：優先使用開出順序
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

// 合併多重來源資料 (Base + ZIPs + Live + Firestore)
export function mergeLotteryData(baseData, zipResults, liveData, firestoreData) {
    const merged = { ...baseData.games }; // 淺拷貝

    // 1. 合併 ZIP 資料
    if (Array.isArray(zipResults)) {
        zipResults.forEach(zipGameData => {
            for (const [game, rows] of Object.entries(zipGameData)) {
                if (!merged[game]) merged[game] = [];
                merged[game] = [...merged[game], ...rows];
            }
        });
    }

    // 2. 合併 Live Data
    if (liveData) {
        for (const [game, rows] of Object.entries(liveData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    // 3. 合併 Firestore Data
    if (firestoreData) {
         for (const [game, rows] of Object.entries(firestoreData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    // 4. 去重與排序
    for (const game in merged) {
        if (!Array.isArray(merged[game])) continue;

        const unique = new Map();
        merged[game].forEach(item => {
            if (!item || !item.date) return;
            // 建立唯一鍵值：日期_期數
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            
            // 優先權邏輯：Live API > Firestore > ZIP > Base (後蓋前)
            // 如果鍵不存在，或者當前來源是高優先級，則覆寫
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

// LocalStorage 快取 (使用 Safe Wrapper)
export function saveToCache(data) {
    const payload = JSON.stringify({
        timestamp: Date.now(),
        data: data
    });
    safeSetLocalStorage('lottery_live_cache', payload);
}

export function loadFromCache() {
    // 1. 嘗試從 localStorage 讀取
    const raw = safeGetLocalStorage('lottery_live_cache');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    // 2. 如果 localStorage 失敗，嘗試讀取記憶體快取
    if (_memoryCache.data && (Date.now() - _memoryCache.timestamp < 3600000)) { // 1小時有效
        // console.log("📦 使用記憶體快取");
        return { data: _memoryCache.data, timestamp: _memoryCache.timestamp };
    }

    return null;
}

// Firestore 存取 (包含重複檢查與權限防護)
export async function saveToFirestore(db, newData) {
    if (!db || !window.firebaseModules) return;
    const { doc, getDoc, setDoc } = window.firebaseModules;
    
    // 只寫入 'live_api' 來源的資料
    for (const [game, rows] of Object.entries(newData)) {
        for (const row of rows) {
            if (row.source === 'live_api') {
                const docId = `${row.date}_${row.period}`;
                
                try {
                    const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', `${game}_${docId}`);
                    // [Optimization] 先檢查是否存在
                    // 注意：這裡可能會因為權限問題報錯，需要 catch 住
                    const snap = await getDoc(ref);
                    if (!snap.exists()) {
                        await setDoc(ref, {
                            ...row,
                            game: game
                        });
                        console.log(`[Firestore] Saved: ${game} ${row.period}`);
                    }
                } catch (e) {
                    // 這裡靜默失敗是允許的，不影響用戶使用
                    // console.warn(`Firestore save skipped for ${game}: ${e.message}`);
                }
            }
        }
    }
}

export async function loadFromFirestore(db) {
    if (!db || !window.firebaseModules) {
        console.warn("⚠️ Firestore 模組未載入，跳過雲端資料");
        return {};
    }
    
    const { collection, getDocs, query, where, orderBy, limit } = window.firebaseModules;
    
    try {
        // console.log("🔄 [Firestore] 嘗試載入雲端資料...");
        
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const dateThreshold = twoMonthsAgo.toISOString().split('T')[0];
        
        const gamesList = ['大樂透', '威力彩', '今彩539', '雙贏彩', '3星彩', '4星彩'];
        
        // 🚀 並行查詢所有遊戲
        const queryPromises = gamesList.map(async (gameName) => {
            try {
                const colRef = collection(db, 'artifacts', 'lottery-app', 'public_data');
                // 這裡的查詢如果沒有複合索引可能會失敗，或者權限不足也會失敗
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
                // 捕捉個別遊戲的查詢錯誤 (例如索引缺失或權限)
                // console.warn(`⚠️ [Firestore] ${gameName} 讀取略過:`, e.code || e.message);
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
        // 捕捉全域性錯誤 (例如 Access to storage is not allowed)
        console.warn("⚠️ [Firestore] 環境限制，暫時無法使用雲端同步:", e.message);
        return {};
    }
}

// ==========================================
// 2. 核心選號引擎 (The Core Engine)
// ==========================================
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) {
    const max = range; 
    const min = (mode.includes('digit')) ? 0 : 1; 
    
    // 防呆：如果 data 為空
    const safeData = Array.isArray(data) ? data : [];
    
    const recentDrawsCount = 30;
    let weights = { ...customWeights }; // 淺拷貝避免修改原始物件

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
    // 建立加權池
    for(let i=min; i<=max; i++) { 
        const w = Math.floor(weights[i] || 1); 
        for(let k=0; k<w; k++) pool.push(i); 
    }

    // 抽取
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
                // 非數字型玩法，抽出後移除該號碼所有權重球
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
    
    // 初始化
    for (let i = minNum; i <= maxNum; i++) { 
        stats.freq[i] = 0; 
        stats.missing[i] = data.length; 
    }
    
    // 計算
    data.forEach((d, drawIndex) => { 
        if (!d.numbers) return;
        d.numbers.forEach(n => { 
            if (n >= minNum && n <= maxNum) { 
                stats.freq[n]++; 
                // 如果目前還是初始值 (代表尚未出現過)，則更新遺漏值
                // 注意：這裡的邏輯是 missing[n] 記錄的是"最近一次出現的index"嗎？
                // 為了簡化，我們通常計算 "距離現在幾期"。
                // 修正邏輯：如果這個號碼這期出現了，missing 歸零。如果沒出現，missing + 1。
                // 但為了效能，通常反向遍歷。這裡維持原邏輯的修正版：
                // 我們只記錄 "最後一次出現的 index"，然後 display 時計算 diff。
            } 
        });
    });
    
    // 重算 Missing (遺漏期數)
    // 簡單實作：從最新一期往回推
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
    // 簡單模擬，暫時回傳 true
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
