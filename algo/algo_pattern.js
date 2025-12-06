/**
 * algo_pattern.js
 * 關聯學派：基於拖牌分析、鄰號效應與版路預測的選號邏輯（生產級完美版）
 * 
 * 支援玩法：
 * - 組合型：大樂透 (49選6) / 威力彩 (38選6+8選1) / 今彩539 (39選5)
 * - 數字型：3星彩 (0-9選3) / 4星彩 (0-9選4)
 * 
 * 核心功能：
 * 1. 動態拖牌分析系統 - 即時從歷史資料生成300期條件機率矩陣（專業標準）
 * 2. 鄰號效應 - 分析上期開獎號碼的前後鄰號
 * 3. 尾數群聚 - 分析尾數規律
 * 4. 版路預測 - 基於歷史資料的關聯分析
 * 5. 數字型位置分析 - 分析百位/十位/個位的關聯性
 * 6. 三星彩專家模式 - 和值10-20黃金區 + 連莊 + 冷熱配比
 * 
 * 資料來源：
 * - 大樂透：即時從你的573期資料生成300期拖牌矩陣
 * - 其他玩法：Live Data（50-100期）
 */

// ============================================
// 📊 配置中心：統一管理所有 Magic Numbers
// ============================================

const PATTERN_CONFIG = {
    DRAG_PERIODS: 300,        // 拖牌統計期數（專業標準）
    SUM_MIN: 10,              // 三星和值下限（避開0-9冷區）
    SUM_MAX: 20,              // 三星和值上限（避開21-27熱區）
    RECENT_PERIOD: 20,        // 冷熱統計期數
    ZONE2_RECENT: 10,         // 威力彩第二區統計期數
    DRAG_TOP_N: 3,            // 每個膽碼取Top N拖牌
    MAX_ATTEMPTS: 200         // 三星彩生成最大嘗試次數
};

// ============================================
// 💾 全域快取：避免重複計算
// ============================================

let dragMapCache = null;
let lastUpdatePeriod = 0;

// ============================================
// 🚀 動態拖牌分析：300期最佳統計（快取優化版）
// ============================================

function generateDynamicDragMap(data, periods = PATTERN_CONFIG.DRAG_PERIODS) {
    // ★ 快取檢查：相同期數直接返回
    const currentPeriod = data[0]?.period || 0;
    if (dragMapCache && lastUpdatePeriod === currentPeriod) {
        console.log(`[Pattern] 📦 使用快取拖牌矩陣 | 節省 ${periods * 36} 次運算`);
        return dragMapCache;
    }
    
    const dragMap = {};
    const recentData = data.slice(0, Math.min(periods, data.length));
    
    console.log(`[Pattern] 🚀 動態拖牌矩陣生成 | 統計 ${recentData.length}/${periods} 期`);
    
    // 雙層迴圈：本期 → 下期拖牌關係
    for (let i = 0; i < recentData.length - 1; i++) {
        const currentDraw = recentData[i].numbers.slice(0, 6);
        const nextDraw = recentData[i + 1].numbers.slice(0, 6);
        
        currentDraw.forEach(currentNum => {
            if (!dragMap[currentNum]) dragMap[currentNum] = [];
            
            nextDraw.forEach(nextNum => {
                if (currentNum !== nextNum) {
                    const existing = dragMap[currentNum].find(d => d.num === nextNum);
                    existing ? existing.count++ : dragMap[currentNum].push({ num: nextNum, count: 1 });
                }
            });
        });
    }
    
    // 轉機率格式 + TopN排序
    Object.keys(dragMap).forEach(key => {
        const total = dragMap[key].reduce((sum, d) => sum + d.count, 0);
        dragMap[key] = dragMap[key]
            .sort((a, b) => b.count - a.count)
            .slice(0, PATTERN_CONFIG.DRAG_TOP_N)
            .map(drag => ({
                num: drag.num,
                prob: Math.round((drag.count / total) * 100 * 10) / 10
            }));
    });
    
    // ★ 更新快取
    dragMapCache = dragMap;
    lastUpdatePeriod = currentPeriod;
    
    const validKeys = Object.keys(dragMap).length;
    console.log(`[Pattern] ✅ 生成完成 | 有效膽碼: ${validKeys}/49 | 快取已更新`);
    
    return dragMap;
}

// ============================================
// 🎯 三星彩專家選號邏輯（配置化）
// ============================================

function select3DExpertPattern(data, range, count, subModeId) {
    if (count !== 3) return null;
    
    const candidates = [];
    const recent = data.slice(0, Math.min(PATTERN_CONFIG.RECENT_PERIOD, data.length));
    if (recent.length === 0) return null;
    
    // 1. 和值黃金區（配置化）
    const sumMin = PATTERN_CONFIG.SUM_MIN;
    const sumMax = PATTERN_CONFIG.SUM_MAX;
    
    // 2. 連莊號（最近3期重複數字）
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
    
    // 3. 冷熱統計
    const freqMap = new Map();
    recent.forEach(draw => {
        draw.numbers.slice(0, 3).forEach(d => {
            if (d >= 0 && d <= range) {
                freqMap.set(d, (freqMap.get(d) || 0) + 1);
            }
        });
    });
    const sorted = Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1]);
    const hotNums = sorted.slice(0, 4).map(([d]) => d);
    const warmNums = sorted.slice(4, 10).map(([d]) => d);
    
    // 4. 生成符合條件的組合
    let attempts = 0;
    while (candidates.length < count && attempts < PATTERN_CONFIG.MAX_ATTEMPTS) {
        attempts++;
        let combo = [];
        
        if (repeats.length > 0 && Math.random() < 0.4) {
            const r = repeats[Math.floor(Math.random() * repeats.length)];
            combo.push(r);
        }
        
        while (combo.length < 3) {
            const pool = (combo.length === 0 ? hotNums : warmNums);
            if (pool.length === 0) break;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            combo.push(pick);
        }
        
        if (combo.length !== 3) continue;
        
        combo = combo.map(x => parseInt(x, 10));
        const sum = combo.reduce((a, b) => a + b, 0);
        
        if (sum < sumMin || sum > sumMax) continue;
        
        const uniqueCount = new Set(combo).size;
        if (uniqueCount < 2) continue;
        
        const key = combo.slice().sort((a, b) => a - b).join(',');
        if (!candidates.find(c => c.key === key)) {
            candidates.push({ key, arr: combo });
        }
    }
    
    if (candidates.length === 0) return null;
    
    console.log(`[Pattern] 🎯 三星專家 | 連莊: ${repeats.join(',')} | 熱號: ${hotNums.join(',')} | 生成: ${candidates.length}組`);
    
    return candidates.slice(0, count).map(c => ({
        val: c.arr[0],
        tag: '三星專家'
    }));
}

// ============================================
// 主函數（入口）
// ============================================

export function algoPattern({ data, gameDef, subModeId }) {
    console.log(`[Pattern] 🚀 關聯學派啟動 | 玩法: ${gameDef.type} | 資料: ${data.length}期`);
    
    if (!data || data.length === 0) {
        console.warn(`[Pattern] ⚠️ 無歷史資料，返回隨機選號`);
        return { numbers: [], groupReason: "⚠️ 資料不足" };
    }
    
    if (gameDef.type === 'lotto' || gameDef.type === 'power') {
        return handleComboTypePattern(data, gameDef);
    } else if (gameDef.type === 'digit') {
        return handleDigitTypePattern(data, gameDef, subModeId);
    }
    
    return { numbers: [], groupReason: "❌ 不支援的玩法類型" };
}

// ============================================
// 組合型彩券關聯處理（生產級防呆）
// ============================================

function handleComboTypePattern(data, gameDef) {
    const { range, count, zone2, id } = gameDef;
    
    // ★ 輸入驗證
    if (!Array.isArray(data) || data.length === 0 || !data[0]?.numbers) {
        return { numbers: [], groupReason: "❌ 資料格式錯誤" };
    }
    
    console.log(`[Pattern] 📊 組合型分析 | 範圍: 1-${range} | 需求: ${count} | ID: ${id}`);
    const lastDraw = data[0].numbers.slice(0, 6);
    console.log(`[Pattern] 🎲 上期開獎: ${lastDraw.join(', ')}`);
    
    let zone1Numbers;
    
    // ★ 300期動態拖牌分析（快取優化）
    const dynamicDragMap = generateDynamicDragMap(data);
    
    if ((id === 'lotto649' || id === 'lotto' || id === '大樂透' || range === 49) && dynamicDragMap) {
        console.log(`[Pattern] 🎯 300期動態拖牌啟動`);
        zone1Numbers = selectWithDragAnalysis(lastDraw, range, count, dynamicDragMap);
    } else {
        console.log(`[Pattern] ℹ️ 鄰號+尾數分析 | ID: ${id}`);
        zone1Numbers = selectWithNeighborAnalysis(data, lastDraw, range, count);
    }
    
    if (zone2) {
        console.log(`[Pattern] ⚡ 威力彩第二區 | 範圍: 1-${zone2}`);
        const zone2Numbers = selectSecondZonePattern(data, zone2);
        return {
            numbers: [...zone1Numbers, ...zone2Numbers],
            groupReason: `🔗 動態拖牌 + 第二區版路`
        };
    }
    
    return {
        numbers: zone1Numbers,
        groupReason: `🔗 300期動態拖牌 + 鄰號 + 尾數`
    };
}

// ============================================
// 大樂透動態拖牌分析（防呆強化）
// ============================================

function selectWithDragAnalysis(lastDraw, range, count, dragMap) {
    const selected = [];
    const used = new Set();
    const candidates = [];
    
    console.log(`[Pattern] 🔍 300期拖牌分析執行`);
    
    // ★ 防呆：驗證輸入
    if (!Array.isArray(lastDraw) || lastDraw.length < 1) {
        console.warn(`[Pattern] ⚠️ 上期資料異常，使用備援邏輯`);
        return generateFallbackNumbers(range, count);
    }
    
    lastDraw.forEach(num => {
        // ★ 型別與邊界檢查
        if (typeof num !== 'number' || num < 1 || num > 49) return;
        
        const dragData = dragMap[num];
        if (!dragData || !Array.isArray(dragData) || dragData.length === 0) return;
        
        dragData.forEach(drag => {
            if (!used.has(drag.num) && drag.num >= 1 && drag.num <= range) {
                candidates.push({
                    num: drag.num,
                    tag: `${num}→${drag.num}(${drag.prob}%)`,
                    priority: drag.prob
                });
            }
        });
    });
    
    candidates.sort((a, b) => b.priority - a.priority);
    const dragCount = Math.min(PATTERN_CONFIG.DRAG_TOP_N, candidates.length, count);
    
    for (let i = 0; i < dragCount; i++) {
        selected.push({
            val: candidates[i].num,
            tag: candidates[i].tag
        });
        used.add(candidates[i].num);
    }
    
    console.log(`[Pattern] 🏆 拖牌核心(${dragCount}顆): ${selected.map(n => n.val).join(', ')}`);
    
    // 補位邏輯（鄰號 → 尾數 → 隨機）
    fillRemainingNumbers(selected, used, lastDraw, range, count);
    selected.sort((a, b) => a.val - b.val);
    
    return selected;
}

// ============================================
// 鄰號+尾數分析（威力彩/今彩539）
// ============================================

function selectWithNeighborAnalysis(data, lastDraw, range, count) {
    const selected = [];
    const used = new Set();
    
    console.log(`[Pattern] 🔗 鄰號+尾數分析`);
    
    const neighborCount = Math.floor(count * 0.5);
    const neighbors = generateNeighbors(lastDraw, range, used);
    shuffleArray(neighbors);
    
    for (let i = 0; i < neighbors.length && selected.length < neighborCount; i++) {
        if (!used.has(neighbors[i].num)) {
            selected.push({ val: neighbors[i].num, tag: neighbors[i].tag });
            used.add(neighbors[i].num);
        }
    }
    
    const tailNumbers = findTailNumberClusters(lastDraw, range);
    const tailCount = Math.floor(count * 0.3);
    
    for (let i = 0; i < tailNumbers.length && selected.length < neighborCount + tailCount; i++) {
        if (!used.has(tailNumbers[i].num)) {
            selected.push({ val: tailNumbers[i].num, tag: tailNumbers[i].tag });
            used.add(tailNumbers[i].num);
        }
    }
    
    fillRemainingNumbers(selected, used, lastDraw, range, count);
    selected.sort((a, b) => a.val - b.val);
    
    return selected;
}

// ============================================
// 🔧 通用補位函數 + 尾數群聚 + 工具函數
// ============================================

function fillRemainingNumbers(selected, used, lastDraw, range, count) {
    // 尾數群聚補位
    const tailNumbers = findTailNumberClusters(lastDraw, range);
    for (let i = 0; i < tailNumbers.length && selected.length < count; i++) {
        if (!used.has(tailNumbers[i].num)) {
            selected.push({ val: tailNumbers[i].num, tag: tailNumbers[i].tag });
            used.add(tailNumbers[i].num);
        }
    }
    
    // 隨機補齊（最終保障）
    while (selected.length < count) {
        const randomNum = Math.floor(Math.random() * range) + 1;
        if (!used.has(randomNum)) {
            selected.push({ val: randomNum, tag: '版路預測' });
            used.add(randomNum);
        }
    }
}

function generateNeighbors(lastDraw, range, used) {
    const neighbors = [];
    lastDraw.forEach(num => {
        if (num > 1 && !used.has(num - 1)) {
            neighbors.push({ num: num - 1, tag: `${num}-1` });
        }
        if (num < range && !used.has(num + 1)) {
            neighbors.push({ num: num + 1, tag: `${num}+1` });
        }
    });
    return neighbors;
}

function findTailNumberClusters(lastDraw, range) {
    const tailCounts = {};
    
    lastDraw.forEach(num => {
        const tail = num % 10;
        tailCounts[tail] = (tailCounts[tail] || 0) + 1;
    });
    
    const hotTails = Object.entries(tailCounts)
        .filter(([_, count]) => count >= 2)
        .map(([tail]) => parseInt(tail));
    
    if (hotTails.length === 0) return [];
    
    const candidates = [];
    hotTails.forEach(tail => {
        for (let num = tail; num <= range; num += 10) {
            if (num > 0 && !lastDraw.includes(num)) {
                candidates.push({ num, tag: `尾數${tail}` });
            }
        }
    });
    
    shuffleArray(candidates);
    return candidates;
}

function generateFallbackNumbers(range, count) {
    const selected = [];
    const used = new Set();
    while (selected.length < count) {
        const num = Math.floor(Math.random() * range) + 1;
        if (!used.has(num)) {
            selected.push({ val: num, tag: '備援隨機' });
            used.add(num);
        }
    }
    return selected.sort((a, b) => a.val - b.val);
}

function selectSecondZonePattern(data, zone2Range) {
    const recentZone2 = [];
    
    for (let i = 0; i < Math.min(PATTERN_CONFIG.ZONE2_RECENT, data.length); i++) {
        const zone2Num = data[i].numbers.slice(-1)[0];
        if (zone2Num && zone2Num >= 1 && zone2Num <= zone2Range) {
            recentZone2.push(zone2Num);
        }
    }
    
    if (recentZone2.length === 0) {
        const randomNum = Math.floor(Math.random() * zone2Range) + 1;
        return [{ val: randomNum, tag: '第二區版路' }];
    }
    
    const missing = [];
    for (let i = 1; i <= zone2Range; i++) {
        if (!recentZone2.includes(i)) missing.push(i);
    }
    
    if (missing.length > 0) {
        const selectedNum = missing[Math.floor(Math.random() * missing.length)];
        return [{ val: selectedNum, tag: '第二區回補' }];
    }
    
    const lastNum = recentZone2[0];
    return [{ val: lastNum, tag: '第二區熱號' }];
}

function handleDigitTypePattern(data, gameDef, subModeId) {
    const { range, count, id } = gameDef;
    
    console.log(`[Pattern] 🔢 數字型分析 | 範圍: 0-${range} | 需求: ${count} | ID: ${id}`);
    
    const lastDraw = data[0]?.numbers?.slice(0, count) || [];
    console.log(`[Pattern] 🎲 上期: ${lastDraw.join('-')}`);
    
    let selected = null;
    if (count === 3 && (id === '3d' || id === '3star' || id === '三星彩')) {
        selected = select3DExpertPattern(data, range, count, subModeId);
        if (selected) {
            return {
                numbers: selected,
                groupReason: `🔗 三星專家：和值${PATTERN_CONFIG.SUM_MIN}-${PATTERN_CONFIG.SUM_MAX} + 連莊 + 冷熱`
            };
        }
    }
    
    selected = selectDigitsByPosition(data, range, count, subModeId);
    
    return {
        numbers: selected,
        groupReason: `🔗 位置關聯分析`
    };
}

function selectDigitsByPosition(data, range, count, subModeId) {
    const selected = [];
    const positionStats = [];
    
    for (let pos = 0; pos < count; pos++) {
        const digitFreq = {};
        for (let d = 0; d <= range; d++) digitFreq[d] = 0;
        
        const recentData = data.slice(0, Math.min(PATTERN_CONFIG.RECENT_PERIOD, data.length));
        recentData.forEach(draw => {
            const digit = draw.numbers[pos];
            if (digit !== undefined && digit >= 0 && digit <= range) {
                digitFreq[digit]++;
            }
        });
        
        positionStats.push(digitFreq);
    }
    
    if (subModeId === 'group' || subModeId === 'any') {
        for (let pos = 0; pos < count; pos++) {
            const sorted = Object.entries(positionStats[pos]).sort((a, b) => b[1] - a[1]);
            const digit = parseInt(sorted[0][0]);
            selected.push({ val: digit, tag: `位${pos + 1}熱號` });
        }
    } else {
        const used = new Set();
        for (let pos = 0; pos < count; pos++) {
            const sorted = Object.entries(positionStats[pos])
                .filter(([d]) => !used.has(parseInt(d)))
                .sort((a, b) => b[1] - a[1]);
            
            if (sorted.length > 0) {
                const digit = parseInt(sorted[0][0]);
                selected.push({ val: digit, tag: `位${pos + 1}關聯` });
                used.add(digit);
            }
        }
    }
    
    return selected;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
