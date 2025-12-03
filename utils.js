/**
 * utils.js
 * 共用工具箱：存放所有學派都會用到的底層數學運算、統計邏輯與命理轉換函數
 * V25.5: 新增 ZIP 解壓縮與資料合併工具
 */

// --- 資料處理工具 (Data Handling Tools) ---

/**
 * 從 ZIP 檔案中讀取並解析 JSON 資料
 * @param {string} url - ZIP 檔案的路徑
 * @returns {Promise<Object>} - 解析後的 JSON 物件
 */
export async function fetchAndParseZip(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        const zip = await JSZip.loadAsync(blob);
        
        // 假設 ZIP 裡只有一個主要的 JSON 檔，或者我們找特定名稱的
        // 這裡遍歷所有檔案，找到第一個 .json 結尾的
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
        console.warn(`Failed to load ZIP from ${url}:`, e);
        return {};
    }
}

/**
 * 合併多個來源的彩券資料，並過濾掉重複或無效的項目
 * @param {Object} baseData - 基礎資料 (from lottery-data.json)
 * @param {Array<Object>} zipDataList - 來自 ZIP 檔的資料陣列
 * @returns {Object} - 合併後的完整資料
 */
export function mergeLotteryData(baseData, zipDataList) {
    const merged = JSON.parse(JSON.stringify(baseData)); // Deep copy
    if (!merged.games) merged.games = {}; // 確保結構

    zipDataList.forEach(zipJson => {
        // 假設 ZIP 裡的 JSON 結構也是 { games: { ... } } 或者直接是 { '大樂透': [...] }
        const sourceGames = zipJson.games || zipJson; 
        
        for (const [gameName, records] of Object.entries(sourceGames)) {
            if (!Array.isArray(records)) continue;
            
            if (!merged.games[gameName]) merged.games[gameName] = [];
            
            // 合併並去重 (以期數 period 為鍵)
            const existingPeriods = new Set(merged.games[gameName].map(r => r.period));
            records.forEach(record => {
                if (!existingPeriods.has(record.period)) {
                    merged.games[gameName].push(record);
                    existingPeriods.add(record.period);
                }
            });
            
            // 重新排序 (日期新到舊)
            merged.games[gameName].sort((a, b) => new Date(b.date) - new Date(a.date));
        }
    });
    
    return merged;
}


// --- 核心選號引擎 (The Core Engine) ---
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
