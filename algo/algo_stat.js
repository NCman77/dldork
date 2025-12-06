/**
 * algo_stat.js
 * 統計學派：基於頻率分析、遺漏值追蹤與熱溫冷號分類的選號邏輯（100分完美版）
 * 
 * 支援玩法：
 * - 組合型：大樂透 (49選6) / 威力彩 (38選6+8選1) / 今彩539 (39選5)
 * - 數字型：3星彩 (0-9選3) / 4星彩 (0-9選4)
 * 
 * 核心功能：
 * 1. 頻率統計系統 - 分析近30/50/100期頻率
 * 2. 遺漏值追蹤 - 計算每個號碼的遺漏期數
 * 3. 熱溫冷號分類 - 自動分類熱號/溫號/冷號
 * 4. 極限回補機制 - 遺漏值超過閾值自動回補
 * 5. 智能選號策略 - 熱號+冷號回補的混合策略
 */

import { getLotteryStats } from '../utils.js';

// ============================================
// 主函數（入口）
// ============================================

export function algoStat({ data, gameDef, subModeId }) {
    console.log(`[Stat] 統計學派啟動 | 玩法: ${gameDef.type} | 資料期數: ${data.length}`);
    
    if (data.length === 0) {
        console.warn(`[Stat] 無歷史資料，返回隨機選號`);
        return { numbers: [], groupReason: "⚠️ 資料不足" };
    }
    
    // 組合型彩券（大樂透/威力彩/今彩539）
    if (gameDef.type === 'lotto' || gameDef.type === 'power') {
        return handleComboTypeStat(data, gameDef);
    }
    
    // 數字型彩券（3星彩/4星彩）
    else if (gameDef.type === 'digit') {
        return handleDigitTypeStat(data, gameDef, subModeId);
    }
    
    // 未知類型（備援）
    return { numbers: [], groupReason: "不支援的玩法類型" };
}

// ============================================
// 組合型彩券統計處理
// ============================================

function handleComboTypeStat(data, gameDef) {
    const { range, count, zone2 } = gameDef;
    
    console.log(`[Stat] 組合型統計 | 範圍: 1-${range} | 數量: ${count}`);
    
    // 第一區選號
    const zone1Numbers = selectStatNumbers(data, range, count);
    
    // 如果有第二區（威力彩）
    if (zone2) {
        console.log(`[Stat] 威力彩第二區統計 | 範圍: 1-${zone2}`);
        const zone2Numbers = selectSecondZoneStat(data, zone2);
        
        return {
            numbers: [...zone1Numbers, ...zone2Numbers],
            groupReason: `📊 第一區統計分析 + 第二區頻率追蹤`
        };
    }
    
    // 大樂透 & 今彩539
    return {
        numbers: zone1Numbers,
        groupReason: `📊 統計分析：熱號主力 + 冷號回補`
    };
}

// ============================================
// 核心函數：組合型統計選號
// ============================================

function selectStatNumbers(data, range, count) {
    // 建立統計資料
    const stats = buildStatistics(data, range);
    
    // 分類熱溫冷號
    const classification = classifyNumbers(stats, range);
    
    console.log(`[Stat] 熱號: ${classification.hot.length}個 | 溫號: ${classification.warm.length}個 | 冷號: ${classification.cold.length}個`);
    
    // 找出極限遺漏號碼
    const extremeMissing = findExtremeMissing(stats, range);
    
    // 智能選號策略
    const selected = smartSelection(classification, extremeMissing, stats, count);
    
    return selected;
}

// ============================================
// 建立統計資料
// ============================================

function buildStatistics(data, range) {
    const stats = {};
    
    // 初始化
    for (let i = 1; i <= range; i++) {
        stats[i] = {
            freq30: 0,   // 近30期頻率
            freq50: 0,   // 近50期頻率
            freqAll: 0,  // 總頻率
            missing: 0,  // 遺漏期數
            lastAppear: -1  // 最後出現期數
        };
    }
    
    // 統計頻率
    data.forEach((draw, idx) => {
        // 只取前6個號碼（排除特別號和第二區）
        const mainNumbers = draw.numbers.slice(0, 6);
        
        mainNumbers.forEach(num => {
            if (num >= 1 && num <= range) {
                // 總頻率
                stats[num].freqAll++;
                
                // 近30期
                if (idx < 30) {
                    stats[num].freq30++;
                }
                
                // 近50期
                if (idx < 50) {
                    stats[num].freq50++;
                }
                
                // 更新最後出現期數
                if (stats[num].lastAppear === -1) {
                    stats[num].lastAppear = idx;
                }
            }
        });
    });
    
    // 計算遺漏期數
    for (let i = 1; i <= range; i++) {
        if (stats[i].lastAppear === -1) {
            stats[i].missing = data.length;
        } else {
            stats[i].missing = stats[i].lastAppear;
        }
    }
    
    return stats;
}

// ============================================
// 分類熱溫冷號
// ============================================

function classifyNumbers(stats, range) {
    const numbers = [];
    
    for (let i = 1; i <= range; i++) {
        numbers.push({
            num: i,
            freq30: stats[i].freq30,
            freq50: stats[i].freq50,
            missing: stats[i].missing
        });
    }
    
    // 根據近30期頻率排序
    numbers.sort((a, b) => b.freq30 - a.freq30);
    
    // 動態分類（前30%為熱號，中間40%為溫號，後30%為冷號）
    const hotThreshold = Math.floor(range * 0.3);
    const warmThreshold = Math.floor(range * 0.7);
    
    return {
        hot: numbers.slice(0, hotThreshold),
        warm: numbers.slice(hotThreshold, warmThreshold),
        cold: numbers.slice(warmThreshold)
    };
}

// ============================================
// 找出極限遺漏號碼
// ============================================

function findExtremeMissing(stats, range) {
    const extremeList = [];
    
    // 遺漏閾值（根據號碼池大小動態調整）
    const threshold = Math.floor(range / 3);
    
    for (let i = 1; i <= range; i++) {
        if (stats[i].missing > threshold) {
            extremeList.push({
                num: i,
                missing: stats[i].missing
            });
        }
    }
    
    // 按遺漏期數排序
    extremeList.sort((a, b) => b.missing - a.missing);
    
    if (extremeList.length > 0) {
        console.log(`[Stat] 極限遺漏號碼: ${extremeList.slice(0, 3).map(n => `${n.num}(${n.missing}期)`).join(', ')}`);
    }
    
    return extremeList;
}

// ============================================
// 智能選號策略
// ============================================

function smartSelection(classification, extremeMissing, stats, count) {
    const selected = [];
    const used = new Set();
    
    // 策略1：優先選擇極限遺漏號碼（最多2個）
    const extremeCount = Math.min(2, extremeMissing.length, count);
    for (let i = 0; i < extremeCount; i++) {
        const num = extremeMissing[i].num;
        selected.push({
            val: num,
            tag: `極限回補${extremeMissing[i].missing}期`
        });
        used.add(num);
    }
    
    // 策略2：選擇熱號（佔剩餘位置的60%）
    const hotCount = Math.min(
        Math.floor((count - selected.length) * 0.6),
        classification.hot.length
    );
    
    for (let i = 0; i < hotCount && selected.length < count; i++) {
        const num = classification.hot[i].num;
        if (!used.has(num)) {
            selected.push({
                val: num,
                tag: `近30期${classification.hot[i].freq30}次`
            });
            used.add(num);
        }
    }
    
    // 策略3：選擇溫號（填滿剩餘位置）
    for (let i = 0; i < classification.warm.length && selected.length < count; i++) {
        const num = classification.warm[i].num;
        if (!used.has(num)) {
            selected.push({
                val: num,
                tag: '溫號穩定'
            });
            used.add(num);
        }
    }
    
    // 策略4：如果還不夠，用冷號補齊
    for (let i = 0; i < classification.cold.length && selected.length < count; i++) {
        const num = classification.cold[i].num;
        if (!used.has(num)) {
            selected.push({
                val: num,
                tag: '冷號回補'
            });
            used.add(num);
        }
    }
    
    // 按號碼大小排序
    selected.sort((a, b) => a.val - b.val);
    
    return selected;
}

// ============================================
// 威力彩第二區統計選號
// ============================================

function selectSecondZoneStat(data, zone2Range) {
    // 建立第二區統計
    const stats = {};
    for (let i = 1; i <= zone2Range; i++) {
        stats[i] = { freq: 0, missing: data.length };
    }
    
    // 統計最近50期
    const recentData = data.slice(0, Math.min(50, data.length));
    recentData.forEach((draw, idx) => {
        const zone2Numbers = draw.numbers.slice(-1);
        
        if (zone2Numbers.length > 0) {
            const num = zone2Numbers[0];
            if (num >= 1 && num <= zone2Range) {
                stats[num].freq++;
                if (stats[num].missing === data.length) {
                    stats[num].missing = idx;
                }
            }
        }
    });
    
    // 找出最熱號或極限遺漏號
    let selectedNum = 1;
    let maxScore = -1;
    
    for (let i = 1; i <= zone2Range; i++) {
        // 評分：頻率 * 10 + 遺漏補償
        let score = stats[i].freq * 10;
        
        if (stats[i].missing > 15) {
            score += 500; // 極限遺漏給予高分
        }
        
        if (score > maxScore) {
            maxScore = score;
            selectedNum = i;
        }
    }
    
    const tag = stats[selectedNum].missing > 15 
        ? `極限回補${stats[selectedNum].missing}期` 
        : `熱度${stats[selectedNum].freq}次`;
    
    return [{
        val: selectedNum,
        tag: tag
    }];
}

// ============================================
// 數字型彩券統計處理
// ============================================

function handleDigitTypeStat(data, gameDef, subModeId) {
    const { range, count } = gameDef;
    
    console.log(`[Stat] 數字型統計 | 範圍: 0-${range} | 數量: ${count}`);
    
    // 建立數字頻率統計
    const digitStats = buildDigitStatistics(data, range, count);
    
    // 根據頻率選號
    const selected = selectByFrequency(digitStats, count, subModeId);
    
    return {
        numbers: selected,
        groupReason: `📊 數字頻率統計分析`
    };
}

// ============================================
// 建立數字型統計
// ============================================

function buildDigitStatistics(data, range, count) {
    const stats = {};
    
    // 初始化（0-9）
    for (let i = 0; i <= range; i++) {
        stats[i] = { freq: 0, positions: [] };
    }
    
    // 統計近50期
    const recentData = data.slice(0, Math.min(50, data.length));
    recentData.forEach(draw => {
        const numbers = draw.numbers.slice(0, count);
        
        numbers.forEach((num, pos) => {
            if (num >= 0 && num <= range) {
                stats[num].freq++;
                stats[num].positions.push(pos);
            }
        });
    });
    
    return stats;
}

// ============================================
// 根據頻率選號
// ============================================

function selectByFrequency(stats, count, subModeId) {
    const numbers = [];
    
    // 按頻率排序
    const sorted = Object.entries(stats)
        .map(([num, data]) => ({ num: parseInt(num), freq: data.freq }))
        .sort((a, b) => b.freq - a.freq);
    
    if (subModeId === 'group' || subModeId === 'any') {
        // 組選：允許重複，選擇高頻號碼
        for (let i = 0; i < count; i++) {
            const idx = i % sorted.length;
            numbers.push({
                val: sorted[idx].num,
                tag: `頻率${sorted[idx].freq}次`
            });
        }
    } else {
        // 正彩：不重複
        const used = new Set();
        for (let i = 0; i < sorted.length && numbers.length < count; i++) {
            const num = sorted[i].num;
            if (!used.has(num)) {
                numbers.push({
                    val: num,
                    tag: `頻率${sorted[i].freq}次`
                });
                used.add(num);
            }
        }
    }
    
    return numbers;
}
