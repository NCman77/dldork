/**
 * algo_pattern.js
 * 關聯學派：基於拖牌分析、鄰號效應與版路預測的選號邏輯（100分完美版）
 * 
 * 支援玩法：
 * - 組合型：大樂透 (49選6) / 威力彩 (38選6+8選1) / 今彩539 (39選5)
 * - 數字型：3星彩 (0-9選3) / 4星彩 (0-9選4)
 * 
 * 核心功能：
 * 1. 拖牌分析系統 - 大樂透使用348期資料建立的條件機率矩陣
 * 2. 鄰號效應 - 分析上期開獎號碼的前後鄰號
 * 3. 尾數群聚 - 分析尾數規律
 * 4. 版路預測 - 基於歷史資料的關聯分析
 * 5. 數字型位置分析 - 分析百位/十位/個位的關聯性
 * 
 * 資料來源：
 * - 大樂透：2022-2024共348期（完整拖牌矩陣）
 * - 其他玩法：Live Data（50-100期）
 */

// ============================================
// 大樂透拖牌資料（基於348期歷史資料）
// ============================================

const LOTTO_DRAG_MAP = {
  "1": [{"num": 46, "prob": 22.6}, {"num": 9, "prob": 19.4}, {"num": 20, "prob": 19.4}],
  "2": [{"num": 20, "prob": 28.2}, {"num": 48, "prob": 20.5}, {"num": 11, "prob": 17.9}],
  "3": [{"num": 39, "prob": 20.5}, {"num": 19, "prob": 17.9}],
  "4": [{"num": 18, "prob": 23.5}, {"num": 13, "prob": 20.6}, {"num": 36, "prob": 17.6}],
  "5": [{"num": 13, "prob": 20.5}, {"num": 15, "prob": 17.9}],
  "6": [{"num": 10, "prob": 23.1}, {"num": 29, "prob": 20.5}, {"num": 37, "prob": 17.9}],
  "7": [{"num": 10, "prob": 17.5}, {"num": 11, "prob": 17.5}, {"num": 36, "prob": 17.5}],
  "8": [{"num": 27, "prob": 22.7}, {"num": 23, "prob": 18.2}, {"num": 17, "prob": 17.8}],
  "9": [{"num": 15, "prob": 22.9}, {"num": 33, "prob": 22.9}, {"num": 35, "prob": 22.9}],
  "10": [{"num": 34, "prob": 22.4}, {"num": 48, "prob": 20.4}, {"num": 6, "prob": 18.4}],
  "11": [{"num": 25, "prob": 22.2}, {"num": 2, "prob": 20.0}, {"num": 7, "prob": 17.8}],
  "12": [{"num": 38, "prob": 17.5}],
  "13": [{"num": 5, "prob": 22.5}, {"num": 28, "prob": 22.5}, {"num": 43, "prob": 22.5}],
  "14": [{"num": 20, "prob": 27.5}, {"num": 26, "prob": 22.5}, {"num": 24, "prob": 20.0}],
  "15": [{"num": 39, "prob": 20.0}, {"num": 41, "prob": 20.0}, {"num": 9, "prob": 17.8}],
  "16": [{"num": 29, "prob": 21.4}, {"num": 47, "prob": 17.9}],
  "17": [{"num": 38, "prob": 21.1}, {"num": 24, "prob": 18.4}, {"num": 8, "prob": 17.1}],
  "18": [{"num": 23, "prob": 21.4}, {"num": 4, "prob": 17.9}],
  "19": [{"num": 3, "prob": 21.6}, {"num": 38, "prob": 18.9}],
  "20": [{"num": 2, "prob": 23.9}, {"num": 14, "prob": 23.9}, {"num": 34, "prob": 23.9}],
  "21": [{"num": 38, "prob": 20.0}, {"num": 33, "prob": 18.0}],
  "22": [{"num": 34, "prob": 23.9}, {"num": 33, "prob": 21.7}],
  "23": [{"num": 18, "prob": 20.9}, {"num": 40, "prob": 18.6}, {"num": 8, "prob": 17.4}],
  "24": [{"num": 14, "prob": 20.5}, {"num": 17, "prob": 18.2}],
  "25": [{"num": 11, "prob": 27.8}, {"num": 38, "prob": 19.4}],
  "26": [{"num": 34, "prob": 30.6}, {"num": 14, "prob": 18.4}],
  "27": [{"num": 8, "prob": 22.7}, {"num": 10, "prob": 22.7}, {"num": 32, "prob": 18.2}],
  "28": [{"num": 13, "prob": 24.3}],
  "29": [{"num": 6, "prob": 20.5}, {"num": 16, "prob": 17.9}],
  "30": [{"num": 38, "prob": 19.4}],
  "31": [{"num": 44, "prob": 22.0}, {"num": 46, "prob": 19.5}, {"num": 38, "prob": 17.1}],
  "32": [{"num": 40, "prob": 21.7}, {"num": 27, "prob": 17.4}, {"num": 38, "prob": 17.4}],
  "33": [{"num": 38, "prob": 21.6}, {"num": 9, "prob": 18.9}, {"num": 22, "prob": 18.9}],
  "34": [{"num": 26, "prob": 25.0}, {"num": 20, "prob": 18.3}, {"num": 10, "prob": 18.3}],
  "35": [{"num": 38, "prob": 23.8}, {"num": 9, "prob": 19.0}],
  "36": [{"num": 4, "prob": 19.0}, {"num": 7, "prob": 17.1}],
  "37": [{"num": 6, "prob": 18.6}, {"num": 41, "prob": 17.1}],
  "38": [{"num": 39, "prob": 21.4}, {"num": 35, "prob": 19.0}, {"num": 42, "prob": 19.0}],
  "39": [{"num": 38, "prob": 28.6}, {"num": 15, "prob": 19.0}],
  "40": [{"num": 34, "prob": 23.4}, {"num": 23, "prob": 19.1}, {"num": 32, "prob": 17.0}],
  "41": [{"num": 15, "prob": 21.6}, {"num": 47, "prob": 18.9}, {"num": 37, "prob": 17.8}],
  "42": [{"num": 38, "prob": 17.9}],
  "43": [{"num": 13, "prob": 20.0}, {"num": 49, "prob": 18.0}],
  "44": [{"num": 31, "prob": 23.7}, {"num": 46, "prob": 18.4}],
  "45": [{"num": 11, "prob": 17.8}],
  "46": [{"num": 1, "prob": 22.6}, {"num": 31, "prob": 19.5}, {"num": 44, "prob": 17.1}],
  "47": [{"num": 41, "prob": 19.4}, {"num": 16, "prob": 17.2}],
  "48": [{"num": 10, "prob": 26.3}, {"num": 2, "prob": 18.4}],
  "49": [{"num": 43, "prob": 20.0}]
};

// ============================================
// ★ 新增：三星彩專家選號邏輯（和值 + 連莊 + 冷熱配比）
// ============================================

function select3DExpertPattern(data, range, count, subModeId) {
    // 僅在 3 碼數字型啟用（避免誤用到 4星彩）
    if (count !== 3) {
        return null;
    }
    
    const candidates = [];
    
    // 統計範圍：近 20 期
    const recent = data.slice(0, Math.min(20, data.length));
    if (recent.length === 0) {
        return null;
    }
    
    // 1. 和值黃金區設定（參考統計：10–20 覆蓋約 70% 左右）
    const sumMin = 10;
    const sumMax = 20;
    
    // 2. 連莊號（最近 3 期重複出現的數字）
    const repeatMap = new Map();
    recent.slice(0, Math.min(3, recent.length)).forEach(draw => {
        draw.numbers.slice(0, 3).forEach(d => {
            if (d >= 0 && d <= range) {
                repeatMap.set(d, (repeatMap.get(d) || 0) + 1);
            }
        });
    });
    const repeats = Array.from(repeatMap.entries())
        .filter(([_, c]) => c >= 2)
        .map(([d]) => d);
    
    // 3. 冷熱統計（近 20 期整體頻率）
    const freqMap = new Map();
    recent.forEach(draw => {
        draw.numbers.slice(0, 3).forEach(d => {
            if (d >= 0 && d <= range) {
                freqMap.set(d, (freqMap.get(d) || 0) + 1);
            }
        });
    });
    const sorted = Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1]);
    const hotNums = sorted.slice(0, 4).map(([d]) => d);   // 熱號池
    const warmNums = sorted.slice(4, 10).map(([d]) => d); // 溫號池
    
    // 4. 隨機生成符合條件的組合
    const maxAttempt = 200;
    while (candidates.length < 10 && candidates.length < maxAttempt) {
        let combo = [];
        
        // 4-1 連莊號：有機率塞入 1 顆
        if (repeats.length > 0 && Math.random() < 0.4) {
            const r = repeats[Math.floor(Math.random() * repeats.length)];
            combo.push(r);
        }
        
        // 4-2 冷熱配比：1 熱 + 2 溫（避免全對子）
        while (combo.length < 3) {
            const pool = (combo.length === 0 ? hotNums : warmNums);
            if (pool.length === 0) break;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            combo.push(pick);
        }
        
        if (combo.length !== 3) continue;
        
        // 排序後做去重判斷
        combo = combo.map(x => parseInt(x, 10));
        const sum = combo.reduce((a, b) => a + b, 0);
        
        // 4-3 和值校正：必須落在黃金區
        if (sum < sumMin || sum > sumMax) {
            continue;
        }
        
        // 4-4 避免 3 顆完全一樣（豹子）或 2+1 對子的比例過高
        const uniqueCount = new Set(combo).size;
        if (uniqueCount < 2) {
            continue;
        }
        
        const key = combo.slice().sort((a, b) => a - b).join(',');
        if (!candidates.find(c => c.key === key)) {
            candidates.push({
                key,
                arr: combo
            });
        }
        
        if (candidates.length >= count) {
            break;
        }
    }
    
    if (candidates.length === 0) {
        return null;
    }
    
    console.log(`[Pattern] 三星彩專家模式啟動 | 連莊號: ${repeats.join(',')} | 熱號池: ${hotNums.join(',')}`);
    
    // 轉成與原本數字型結構相同的物件陣列
    const result = candidates.slice(0, count).map((c, idx) => ({
        val: c.arr[0], // 取第一顆作為代表（保持與原結構一致）
        tag: '三星彩專家'
    }));
    
    return result;
}

// ============================================
// 主函數（入口）
// ============================================

export function algoPattern({ data, gameDef, subModeId }) {
    console.log(`[Pattern] 關聯學派啟動 | 玩法: ${gameDef.type} | 資料期數: ${data.length}`);
    
    if (data.length === 0) {
        console.warn(`[Pattern] 無歷史資料，返回隨機選號`);
        return { numbers: [], groupReason: "⚠️ 資料不足" };
    }
    
    // 組合型彩券（大樂透/威力彩/今彩539）
    if (gameDef.type === 'lotto' || gameDef.type === 'power') {
        return handleComboTypePattern(data, gameDef);
    }
    
    // 數字型彩券（3星彩/4星彩）
    else if (gameDef.type === 'digit') {
        return handleDigitTypePattern(data, gameDef, subModeId);
    }
    
    // 未知類型（備援）
    return { numbers: [], groupReason: "不支援的玩法類型" };
}

// ============================================
// 組合型彩券關聯處理
// ============================================

function handleComboTypePattern(data, gameDef) {
    const { range, count, zone2, id } = gameDef;
    
    console.log(`[Pattern] 組合型關聯分析 | 範圍: 1-${range} | 數量: ${count}`);
    
    // 取最近一期開獎號碼
    const lastDraw = data[0].numbers.slice(0, 6);
    
    console.log(`[Pattern] 上期開獎: ${lastDraw.join(', ')}`);
    
    // 第一區選號 ★ 修改：擴充大樂透識別條件，避免 id 僅等於 'lotto' 或 '大樂透' 時拖牌失效
    let zone1Numbers;
    
    if ((id === 'lotto649' || id === 'lotto' || id === '大樂透' || range === 49) && LOTTO_DRAG_MAP) {
        // 大樂透：使用完整拖牌分析（348期條件機率矩陣）
        console.log(`[Pattern] ✅ 使用拖牌分析 | id=${id} | range=${range}`);
        zone1Numbers = selectWithDragAnalysis(lastDraw, range, count);
    } else {
        // 其他玩法：使用鄰號+尾數分析
        console.log(`[Pattern] ℹ️ 使用鄰號+尾數分析 | id=${id} | range=${range}`);
        zone1Numbers = selectWithNeighborAnalysis(data, lastDraw, range, count);
    }
    
    // 如果有第二區（威力彩）
    if (zone2) {
        console.log(`[Pattern] 威力彩第二區關聯分析 | 範圍: 1-${zone2}`);
        const zone2Numbers = selectSecondZonePattern(data, zone2);
        
        return {
            numbers: [...zone1Numbers, ...zone2Numbers],
            groupReason: `🔗 第一區關聯分析 + 第二區版路預測`
        };
    }
    
    // 大樂透 & 今彩539
    return {
        numbers: zone1Numbers,
        groupReason: `🔗 關聯分析：拖牌 + 鄰號 + 尾數群聚`
    };
}

// ============================================
// 大樂透拖牌分析選號
// ============================================

function selectWithDragAnalysis(lastDraw, range, count) {
    const selected = [];
    const used = new Set();
    const candidates = [];
    
    console.log(`[Pattern] 使用拖牌分析（348期條件機率矩陣）`);
    
    // 策略1：拖牌關聯（根據上期號碼找出拖牌）
    lastDraw.forEach(num => {
        const dragData = LOTTO_DRAG_MAP[num.toString()];
        
        if (dragData && dragData.length > 0) {
            dragData.forEach(drag => {
                if (!used.has(drag.num)) {
                    candidates.push({
                        num: drag.num,
                        tag: `${num}強拖${drag.prob}%`,
                        priority: drag.prob
                    });
                }
            });
        }
    });
    
    // 按優先級排序
    candidates.sort((a, b) => b.priority - a.priority);
    
    // 選擇前3個拖牌號碼
    const dragCount = Math.min(3, candidates.length, count);
    for (let i = 0; i < dragCount; i++) {
        selected.push({
            val: candidates[i].num,
            tag: candidates[i].tag
        });
        used.add(candidates[i].num);
    }
    
    console.log(`[Pattern] 拖牌選號: ${selected.map(n => n.val).join(', ')}`);
    
    // 策略2：鄰號效應（補齊剩餘位置）
    const neighbors = [];
    lastDraw.forEach(num => {
        if (num > 1 && !used.has(num - 1)) {
            neighbors.push({ num: num - 1, tag: `${num}鄰號` });
        }
        if (num < range && !used.has(num + 1)) {
            neighbors.push({ num: num + 1, tag: `${num}鄰號` });
        }
    });
    
    // 隨機選擇鄰號
    shuffleArray(neighbors);
    
    for (let i = 0; i < neighbors.length && selected.length < count; i++) {
        if (!used.has(neighbors[i].num)) {
            selected.push({
                val: neighbors[i].num,
                tag: neighbors[i].tag
            });
            used.add(neighbors[i].num);
        }
    }
    
    // 策略3：尾數群聚（補齊）
    const tailNumbers = findTailNumberClusters(lastDraw, range);
    
    for (let i = 0; i < tailNumbers.length && selected.length < count; i++) {
        if (!used.has(tailNumbers[i].num)) {
            selected.push({
                val: tailNumbers[i].num,
                tag: tailNumbers[i].tag
            });
            used.add(tailNumbers[i].num);
        }
    }
    
    // 策略4：隨機補齊（如果還不夠）
    while (selected.length < count) {
        const randomNum = Math.floor(Math.random() * range) + 1;
        if (!used.has(randomNum)) {
            selected.push({
                val: randomNum,
                tag: '版路預測'
            });
            used.add(randomNum);
        }
    }
    
    // 按號碼排序
    selected.sort((a, b) => a.val - b.val);
    
    return selected;
}

// ============================================
// 鄰號分析選號（威力彩/今彩539）
// ============================================

function selectWithNeighborAnalysis(data, lastDraw, range, count) {
    const selected = [];
    const used = new Set();
    
    console.log(`[Pattern] 使用鄰號+尾數分析`);
    
    // 策略1：鄰號（50%）
    const neighborCount = Math.floor(count * 0.5);
    const neighbors = [];
    
    lastDraw.forEach(num => {
        if (num > 1 && !used.has(num - 1)) {
            neighbors.push({ num: num - 1, tag: `${num}鄰號` });
        }
        if (num < range && !used.has(num + 1)) {
            neighbors.push({ num: num + 1, tag: `${num}鄰號` });
        }
    });
    
    shuffleArray(neighbors);
    
    for (let i = 0; i < neighbors.length && selected.length < neighborCount; i++) {
        if (!used.has(neighbors[i].num)) {
            selected.push({
                val: neighbors[i].num,
                tag: neighbors[i].tag
            });
            used.add(neighbors[i].num);
        }
    }
    
    // 策略2：尾數群聚（30%）
    const tailNumbers = findTailNumberClusters(lastDraw, range);
    const tailCount = Math.floor(count * 0.3);
    
    for (let i = 0; i < tailNumbers.length && selected.length < neighborCount + tailCount; i++) {
        if (!used.has(tailNumbers[i].num)) {
            selected.push({
                val: tailNumbers[i].num,
                tag: tailNumbers[i].tag
            });
            used.add(tailNumbers[i].num);
        }
    }
    
    // 策略3：隨機補齊
    while (selected.length < count) {
        const randomNum = Math.floor(Math.random() * range) + 1;
        if (!used.has(randomNum)) {
            selected.push({
                val: randomNum,
                tag: '版路預測'
            });
            used.add(randomNum);
        }
    }
    
    selected.sort((a, b) => a.val - b.val);
    
    return selected;
}

// ============================================
// 尾數群聚分析
// ============================================

function findTailNumberClusters(lastDraw, range) {
    const tailCounts = {};
    
    // 統計上期尾數
    lastDraw.forEach(num => {
        const tail = num % 10;
        tailCounts[tail] = (tailCounts[tail] || 0) + 1;
    });
    
    // 找出高頻尾數
    const hotTails = Object.entries(tailCounts)
        .filter(([tail, count]) => count >= 2)
        .map(([tail]) => parseInt(tail));
    
    if (hotTails.length === 0) {
        return [];
    }
    
    // 生成同尾數號碼
    const candidates = [];
    hotTails.forEach(tail => {
        for (let num = tail; num <= range; num += 10) {
            if (num > 0 && !lastDraw.includes(num)) {
                candidates.push({
                    num: num,
                    tag: `尾數${tail}群聚`
                });
            }
        }
    });
    
    shuffleArray(candidates);
    
    return candidates;
}

// ============================================
// 威力彩第二區版路預測
// ============================================

function selectSecondZonePattern(data, zone2Range) {
    // 統計最近10期的第二區號碼
    const recentZone2 = [];
    
    for (let i = 0; i < Math.min(10, data.length); i++) {
        const zone2Num = data[i].numbers.slice(-1)[0];
        if (zone2Num) {
            recentZone2.push(zone2Num);
        }
    }
    
    if (recentZone2.length === 0) {
        // 備援：隨機選號
        const randomNum = Math.floor(Math.random() * zone2Range) + 1;
        return [{ val: randomNum, tag: '第二區版路' }];
    }
    
    // 找出最近遺漏的號碼
    const missing = [];
    for (let i = 1; i <= zone2Range; i++) {
        if (!recentZone2.includes(i)) {
            missing.push(i);
        }
    }
    
    // 從遺漏號碼中隨機選擇
    if (missing.length > 0) {
        const selectedNum = missing[Math.floor(Math.random() * missing.length)];
        return [{ val: selectedNum, tag: '第二區回補' }];
    }
    
    // 如果都出現過，選最熱號
    const lastNum = recentZone2[0];
    return [{ val: lastNum, tag: '第二區熱號' }];
}

// ============================================
// 數字型彩券關聯處理 ★ 修改：新增三星彩專家模式優先判斷
// ============================================

function handleDigitTypePattern(data, gameDef, subModeId) {
    const { range, count, id } = gameDef; // ★ 新增：讀取 id 方便判斷 3星彩
    
    console.log(`[Pattern] 數字型關聯分析 | 範圍: 0-${range} | 數量: ${count} | id: ${id}`);
    
    // 取最近一期
    const lastDraw = data[0].numbers.slice(0, count);
    
    console.log(`[Pattern] 上期開獎: ${lastDraw.join('-')}`);
    
    // ★ 新增：三星彩專家模式優先（只限定在 3 碼玩法）
    let selected = null;
    if (count === 3 && (id === '3d' || id === '3star' || id === '三星彩')) {
        selected = select3DExpertPattern(data, range, count, subModeId);
        if (selected) {
            return {
                numbers: selected,
                groupReason: `🔗 三星彩專家模式：和值10-20 + 連莊 + 冷熱配比`
            };
        }
    }
    
    // 原有：位置關聯分析（4星彩 / 其他數字型或專家模式回傳 null 時使用）
    selected = selectDigitsByPosition(data, range, count, subModeId);
    
    return {
        numbers: selected,
        groupReason: `🔗 位置關聯分析`
    };
}

// ============================================
// 數字型位置關聯分析
// ============================================

function selectDigitsByPosition(data, range, count, subModeId) {
    const selected = [];
    
    // 統計每個位置的數字頻率（近20期）
    const positionStats = [];
    
    for (let pos = 0; pos < count; pos++) {
        const digitFreq = {};
        for (let d = 0; d <= range; d++) {
            digitFreq[d] = 0;
        }
        
        const recentData = data.slice(0, Math.min(20, data.length));
        recentData.forEach(draw => {
            const digit = draw.numbers[pos];
            if (digit !== undefined && digit >= 0 && digit <= range) {
                digitFreq[digit]++;
            }
        });
        
        positionStats.push(digitFreq);
    }
    
    // 根據頻率選號
    if (subModeId === 'group' || subModeId === 'any') {
        // 組選：可重複
        for (let pos = 0; pos < count; pos++) {
            const sorted = Object.entries(positionStats[pos])
                .sort((a, b) => b[1] - a[1]);
            
            const digit = parseInt(sorted[0][0]);
            selected.push({
                val: digit,
                tag: `位${pos + 1}熱號`
            });
        }
    } else {
        // 正彩：不重複
        const used = new Set();
        
        for (let pos = 0; pos < count; pos++) {
            const sorted = Object.entries(positionStats[pos])
                .filter(([d]) => !used.has(parseInt(d)))
                .sort((a, b) => b[1] - a[1]);
            
            if (sorted.length > 0) {
                const digit = parseInt(sorted[0][0]);
                selected.push({
                    val: digit,
                    tag: `位${pos + 1}關聯`
                });
                used.add(digit);
            }
        }
    }
    
    return selected;
}

// ============================================
// 工具函數：陣列打亂
// ============================================

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
