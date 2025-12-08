/**
 * utils.js
 * 全功能工具箱：包含數學運算、統計邏輯、命理轉換，以及資料讀取與 API 連線
 * V27.4：修正 API 資料欄位映射，確保 totalAmount (累積獎金) 被正確抓取
 */

// ==========================================
// 1. 資料處理與 IO 工具 (Data & IO Tools)
// ==========================================

// 解析 CSV 字串為物件
function parseCSVLine(line) {
    const cleanLine = line.replace(/^\uFEFF/, '').trim();
    if (!cleanLine) return null;
    
    const cols = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) return null;

    const gameNameMap = {
        '大樂透': '大樂透', '威力彩': '威力彩', '今彩539': '今彩539',
        '雙贏彩': '雙贏彩', '3星彩': '3星彩', '4星彩': '4星彩',
        '三星彩': '3星彩', '四星彩': '4星彩'
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
    for (let i = 6; i < cols.length; i++) {
        if (/^\d+$/.test(cols[i])) numbers.push(parseInt(cols[i]));
    }

    if (numbers.length < 2) return null;

    const numsAppear = [...numbers];
    const numsSize = [...numbers].sort((a, b) => a - b);

    // CSV 通常沒有即時的累積獎金資訊，totalAmount 設為 null
    return {
        game: matchedGame,
        data: {
            date: dateStr,
            period: cols[1],
            numbers: numsAppear,
            numbers_size: numsSize,
            totalAmount: null, // CSV 無此欄位
            source: 'history_zip'
        }
    };
}

export async function fetchAndParseZip(url) {
    console.log(`📦 [ZIP] 開始下載: ${url}`);
    if (!window.JSZip) { console.error("❌ [ZIP] JSZip not found"); return {}; }
    
    try {
        const res = await fetch(url);
        if (!res.ok) { console.error(`❌ [ZIP] HTTP 錯誤: ${url}`); return {}; }
        
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        const zipData = {};
        
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__')) {
                const text = await zip.files[filename].async("string");
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
        console.error(`❌ [ZIP] 處理失敗: ${url}`, e);
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

    console.log(`[Utils] 🔄 抓取資料: ${monthsToFetch.join(', ')}`);

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
                return json.content[contentKey] || [];
            } catch (e) {
                return [];
            }
        });

        const allMonthRecords = await Promise.all(monthPromises);
        const allRecords = allMonthRecords.flat();

        allRecords.forEach(item => {
            const dateStr = item.lotteryDate.split('T')[0];
            const numsSize = item.drawNumberSize || [];
            const numsAppear = item.drawNumberAppear || [];
            
            if (numsSize.length > 0 || numsAppear.length > 0) {
                // ✨ 修正重點：在這裡抓取 totalAmount
                // 某些 API 回傳可能是字串或數字，統一轉字串處理
                let amount = item.totalAmount || item.jackpot || null;
                // 如果是數字，加上千分位符號
                if (typeof amount === 'number') {
                    amount = amount.toLocaleString();
                }

                liveData[gameName].push({
                    date: dateStr,
                    period: String(item.period),
                    numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                    numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                    totalAmount: amount, // ✅ 這裡！把錢存進來
                    source: 'live_api'
                });
            }
        });
    }
    
    return liveData;
}

// 合併多重來源資料
export function mergeLotteryData(baseData, zipResults, liveData, firestoreData) {
    const merged = { ...baseData.games };

    // 合併各來源 (ZIP, Live, Firestore...)
    [zipResults, liveData ? [liveData] : [], firestoreData ? [firestoreData] : []].flat().forEach(dataset => {
        // 修正：處理 zipResults 是陣列的情況
        if(Array.isArray(dataset)) return; // zipResults is array of objects
        
        // 如果 dataset 是 zipResults (Array of Objects)
        if(dataset && !dataset.games && !dataset['大樂透']) { // It's an object { '大樂透': [] }
             for (const [game, rows] of Object.entries(dataset)) {
                if (!merged[game]) merged[game] = [];
                merged[game] = [...merged[game], ...rows];
            }
        }
    });
    
    // 重新寫合併邏輯以確保正確性
    const sources = [
        ...zipResults, 
        liveData || {}, 
        firestoreData || {}
    ];

    sources.forEach(source => {
        for (const [game, rows] of Object.entries(source)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    });

    // 去重與排序
    for (const game in merged) {
        const unique = new Map();
        merged[game].forEach(item => {
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            // Live API > Firestore > ZIP
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

// Firestore 存取
export async function saveToFirestore(db, newData) {
    if (!db || !window.firebaseModules) return;
    const { doc, getDoc, setDoc } = window.firebaseModules;
    
    for (const [game, rows] of Object.entries(newData)) {
        for (const row of rows) {
            if (row.source === 'live_api') {
                const docId = `${row.date}_${row.period}`;
                const ref = doc(db, 'artifacts', 'lottery-app', 'public_data', `${game}_${docId}`);
                
                try {
                    const snap = await getDoc(ref);
                    if (!snap.exists()) {
                        await setDoc(ref, { ...row, game: game });
                    }
                } catch (e) { console.error("Firestore Save Error:", e); }
            }
        }
    }
}

export async function loadFromFirestore(db) {
    if (!db || !window.firebaseModules) return {};
    const { collection, getDocs, query, where, orderBy, limit } = window.firebaseModules;
    
    try {
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const dateThreshold = twoMonthsAgo.toISOString().split('T')[0];
        const gamesList = ['大樂透', '威力彩', '今彩539', '雙贏彩', '3星彩', '4星彩'];
        
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
                                totalAmount: data.totalAmount || null, // 確保從 Firestore 讀回時也包含
                                source: 'firestore'
                            });
                        }
                    });
                    return { game: gameName, data: gameData };
                }
                return { game: gameName, data: [] };
            } catch (e) { return { game: gameName, data: [] }; }
        });
        
        const results = await Promise.all(queryPromises);
        const gamesData = {};
        results.forEach(result => {
            if (result.data.length > 0) gamesData[result.game] = result.data;
        });
        return gamesData;
    } catch (e) { return {}; }
}

// ==========================================
// 2. 核心選號引擎 (保持不變)
// ==========================================
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
            if (lastDraw.includes(num)) { tag = '連莊強勢'; } 
            else if (lastDraw.includes(num - 1) || lastDraw.includes(num + 1)) { const neighbor = lastDraw.includes(num-1) ? (num-1) : (num+1); tag = `${neighbor}鄰號`; } 
            else { tag = '版路預測'; }
        } else if (mode === 'ai_weight') {
            const maxWeight = Math.max(...Object.values(weights)); const score = Math.round((weights[num] / maxWeight) * 100); tag = `趨勢分${score}`;
        } else if (mode.includes('balance') || mode.includes('random')) {
            const isOdd = num % 2 !== 0; const isBig = num > max / 2;
            tag = (isBig ? "大號" : "小號") + "/" + (isOdd ? "奇數" : "偶數"); 
        } else if (mode === 'wuxing') {
            tag = (wuxingContext && wuxingContext.tagMap && wuxingContext.tagMap[num]) ? wuxingContext.tagMap[num] : '流年運數';
        }
        resultWithTags.push({ val: num, tag: tag });
    }
    return resultWithTags;
}

// ==========================================
// 3. 統計與數學工具 (保持不變)
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
// 4. 命理玄學工具 (保持不變)
// ==========================================
export function getGanZhi(year) {
    const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
    const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
    const offset = year - 4; 
    return { gan: stems[offset % 10], zhi: branches[offset % 12] };
}
export function getFlyingStars(gan) {
    const map = { "甲": { lu: "廉貞", ji: "太陽" }, "乙": { lu: "天機", ji: "太陰" }, "丙": { lu: "天同", ji: "廉貞" }, "丁": { lu: "太陰", ji: "巨門" }, "戊": { lu: "貪狼", ji: "天機" }, "己": { lu: "武曲", ji: "文曲" }, "庚": { lu: "太陽", ji: "天同" }, "辛": { lu: "巨門", ji: "文昌" }, "壬": { lu: "天梁", ji: "武曲" }, "癸": { lu: "破軍", ji: "貪狼" } };
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
