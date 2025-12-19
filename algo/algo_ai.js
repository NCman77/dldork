/**
 * algo_ai.js V7.0 - 平衡方案 B
 * AI 學派：時間序列動能分析
 * 
 * 核心演算法：
 * - 半衰期指數衰減權重（short / long 雙尺度）
 * - Log-Lift 動能計算
 * - Kish Neff 收縮
 * - Percentile Rank 轉趨勢分 0-100
 * - Deterministic TOP5 去重（overlap 階梯）
 * - Random 模式（動態溫度 + 動態 TopN + 軟性降權）
 * - 包牌支援（pack_1 / pack_2）
 */

// 引入 utils.js 的 AI 工具函式
import {
    ai_computeHalfLifeWeights,
    ai_computeWeightedStats,
    ai_computeLogLift,
    ai_computeKishShrinkage,
    ai_percentileRankTransform
} from '../utils.js';

// ==========================================
// [A] 配置區
// ==========================================
const AI_CONFIG = {
    DEBUG_MODE: false,
    
    // 超參數配置
    PARAMS: {
        lotto: {
            h_short: 8,
            h_long: 50,
            epsilon: 1,
            kPrior: 5,
            temperature: 0.7,           // 基準溫度
            tempRange: [0.8, 1.5],      // 動態溫度範圍
            topNRange: [10, 15, 20, 30, 50]  // 動態候選池大小
        },
        power_zone1: {
            h_short: 8,
            h_long: 50,
            epsilon: 1,
            kPrior: 5,
            temperature: 0.7,
            tempRange: [0.8, 1.5],
            topNRange: [10, 15, 20, 30, 50]
        },
        power_zone2: {
            h_short: 15,
            h_long: 80,
            epsilon: 2,
            kPrior: 10,
            temperature: 0.5,
            tempRange: [0.8, 1.3],
            topNRange: [4, 5, 6, 7, 8]
        },
        digit: {
            h_short: 10,
            h_long: 60,
            epsilon: 1,
            kPrior: 8,
            temperature: 0.6,
            tempRange: [0.8, 1.4],
            topNRange: [3, 5, 7, 10, 10]
        }
    },
    
    // strict 模式 overlap 階梯
    OVERLAP_THRESHOLDS: {
        lotto: [2, 2, 3, 3, 4],
        digit: [1, 1, 2, 2, 2]
    },
    
    // 包牌降權係數
    PACK_PENALTY: 0.5,  // 已選號碼分數衰減 50%
    
    // 重試與 fallback
    RANDOM_RETRY_LIMIT: 30,
    FALLBACK_TO_STRICT: true,
    
    // digit pack_2 配置
    DIGIT_PACK2_TOP_N: 4
};

// [B] 除錯工具
const log = (...args) => {
    if (AI_CONFIG.DEBUG_MODE) console.log('[AI V7.0]', ...args);
};

// ==========================================
// [C] 主入口函式
// ==========================================
export function algoAI({
    data,
    gameDef,
    subModeId,
    excludeNumbers = [],
    random = false,
    mode = 'strict',
    packMode = null,
    targetCount = 5,
    setIndex = 0
}) {
    log(`啟動 | 玩法: ${gameDef.type} | 模式: ${mode} | 包牌: ${packMode || '單注'} | setIndex: ${setIndex}`);
    
    // 1. 資料驗證
    if (!Array.isArray(data) || data.length === 0) {
        log('資料不足');
        return packMode ? [] : {
            numbers: [],
            groupReason: '❌ 資料不足',
            metadata: { version: '7.0', error: 'insufficient_data' }
        };
    }
    
    // 2. 包牌模式
    if (packMode) {
        return ai_handlePackMode({
            data,
            gameDef,
            packMode,
            targetCount,
            mode,
            random,
            subModeId
        });
    }
    
    // 3. 單注模式
    if (gameDef.type === 'power') {
        return ai_handlePowerSingle({
            data,
            gameDef,
            excludeNumbers,
            random,
            mode,
            setIndex
        });
    } else if (gameDef.type === 'digit') {
        return ai_handleDigitSingle({
            data,
            gameDef,
            subModeId,
            excludeNumbers,
            random,
            mode,
            setIndex
        });
    } else {
        // lotto / today
        return ai_handleComboSingle({
            data,
            gameDef,
            excludeNumbers,
            random,
            mode,
            setIndex
        });
    }
}

// ==========================================
// [D] 包牌邏輯
// ==========================================
function ai_handlePackMode({ data, gameDef, packMode, targetCount, mode, random, subModeId }) {
    log(`包牌模式: ${packMode} | 目標: ${targetCount}注`);
    
    if (gameDef.type === 'power') {
        return ai_packPower({ data, gameDef, packMode, targetCount, mode });
    } else if (gameDef.type === 'digit') {
        return ai_packDigit({ data, gameDef, packMode, targetCount, subModeId });
    } else {
        return ai_packCombo({ data, gameDef, packMode, targetCount, mode });
    }
}

function ai_packPower({ data, gameDef, packMode, targetCount, mode }) {
    const tickets = [];
    
    if (packMode === 'pack_1') {
        // Pack_1: 第1區用 AI Top1，第2區全包 1-8
        const zone1Scores = ai_buildCandidateScores({
            data,
            range: gameDef.range,
            count: 6,
            isZone2: false,
            params: AI_CONFIG.PARAMS.power_zone1
        });
        
        const zone1Combo = ai_pickTopNumbers(zone1Scores, 6, new Set());
        
        // 第2區全包
        for (let z2 = 1; z2 <= 8; z2++) {
            tickets.push({
                numbers: [
                    ...zone1Combo.map(n => ({ val: n, tag: `趨勢分${Math.round(zone1Scores[n])}` })),
                    { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
                ],
                groupReason: `威力彩包牌 ${z2}/8 - 第1區 AI Top1 鎖定`,
                metadata: { version: '7.0', packMode: 'pack_1', zone2: z2 }
            });
        }
    } else {
        // Pack_2: 第1區五種策略，第2區輪流
        const zone1Scores = ai_buildCandidateScores({
            data,
            range: gameDef.range,
            count: 6,
            isZone2: false,
            params: AI_CONFIG.PARAMS.power_zone1
        });
        
        const zone2Scores = ai_buildCandidateScores({
            data,
            range: gameDef.zone2,
            count: 1,
            isZone2: true,
            params: AI_CONFIG.PARAMS.power_zone2
        });
        
        const sortedZ1 = Object.keys(zone1Scores).map(Number).sort((a, b) => zone1Scores[b] - zone1Scores[a]);
        const sortedZ2 = Object.keys(zone2Scores).map(Number).sort((a, b) => zone2Scores[b] - zone2Scores[a]);
        
        // 五種第1區策略
        const strategies = [
            { name: '極準組', getCombo: () => sortedZ1.slice(0, 6) },
            { name: '次準組', getCombo: () => sortedZ1.slice(2, 8) },
            { name: '混合組', getCombo: () => [...sortedZ1.slice(0, 3), ...sortedZ1.slice(10, 13)] },
            { name: '跳躍組', getCombo: () => [sortedZ1[1], sortedZ1[3], sortedZ1[5], sortedZ1[7], sortedZ1[9], sortedZ1[11]] },
            { name: '實驗組', getCombo: () => {
                const candidates = sortedZ1.slice(0, 30).map(n => ({ num: n, score: zone1Scores[n] }));
                return ai_softmaxSample(candidates, 2.0, 6);
            }}
        ];
        
        for (let i = 0; i < Math.min(targetCount, 5); i++) {
            const strategy = strategies[i];
            const zone1Combo = strategy.getCombo().sort((a, b) => a - b);
            const z2Val = sortedZ2[i % sortedZ2.length];
            
            tickets.push({
                numbers: [
                    ...zone1Combo.map(n => ({ val: n, tag: `趨勢分${Math.round(zone1Scores[n])}` })),
                    { val: z2Val, tag: `趨勢分${Math.round(zone2Scores[z2Val])}` }
                ],
                groupReason: `威力彩彈性包牌 ${i + 1}/${targetCount} - ${strategy.name}`,
                metadata: { version: '7.0', packMode: 'pack_2', strategy: strategy.name }
            });
        }
    }
    
    log(`威力彩包牌完成: ${tickets.length}注`);
    return tickets;
}

function ai_packDigit({ data, gameDef, packMode, targetCount, subModeId }) {
    const tickets = [];
    const digitCount = subModeId || gameDef.count;
    
    if (packMode === 'pack_1') {
        // Pack_1: 每位 Top1 的全排列
        const posScores = [];
        for (let pos = 0; pos < digitCount; pos++) {
            const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
            const topNum = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a])[0];
            posScores.push({ pos, num: topNum, score: scores[topNum] });
        }
        
        const baseCombo = posScores.map(p => p.num);
        const perms = ai_uniquePermutations(baseCombo);
        
        perms.forEach((combo, idx) => {
            tickets.push({
                numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
                groupReason: `數字型強勢包牌 ${idx + 1}/${perms.length} - Top1全排列`,
                metadata: { version: '7.0', packMode: 'pack_1' }
            });
        });
    } else {
        // Pack_2: 每位 Top N 的笛卡兒積 + 位置差異控制
        const TOP_N = AI_CONFIG.DIGIT_PACK2_TOP_N;
        const posCandidates = [];
        
        for (let pos = 0; pos < digitCount; pos++) {
            const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
            const topNums = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]).slice(0, TOP_N);
            posCandidates.push(topNums.map(n => ({ num: n, score: scores[n] })));
        }
        
        // 笛卡兒積
        const allCombos = ai_cartesianProduct(posCandidates.map(pc => pc.map(c => c.num)));
        
        // 計算 ComboScore
        const rankedCombos = allCombos.map(combo => {
            let score = 0;
            combo.forEach((num, pos) => {
                const posScore = posCandidates[pos].find(c => c.num === num)?.score || 0;
                score += Math.log(posScore + 1);
            });
            return { combo, score };
        }).sort((a, b) => b.score - a.score);
        
        // 挑選分散的前 N 注（位置差異優先）
        const picked = [];
        const pickWithMinDiff = (minDiff) => {
            for (const item of rankedCombos) {
                if (picked.length >= targetCount) break;
                const combo = item.combo;
                
                if (minDiff > 0) {
                    const ok = picked.every(p => ai_posDiff(p, combo) >= minDiff);
                    if (!ok) continue;
                }
                
                picked.push(combo);
            }
        };
        
        pickWithMinDiff(digitCount);  // 優先全位不同
        if (picked.length < targetCount) pickWithMinDiff(Math.floor(digitCount * 0.75));
        if (picked.length < targetCount) pickWithMinDiff(Math.floor(digitCount * 0.5));
        if (picked.length < targetCount) pickWithMinDiff(1);
        if (picked.length < targetCount) pickWithMinDiff(0);
        
        picked.forEach((combo, idx) => {
            tickets.push({
                numbers: combo.map((num, pos) => {
                    const posScore = posCandidates[pos].find(c => c.num === num)?.score || 50;
                    return { val: num, tag: `趨勢分${Math.round(posScore)}` };
                }),
                groupReason: `數字型彈性包牌 ${idx + 1}/${picked.length} - Top${TOP_N}笛卡兒積`,
                metadata: { version: '7.0', packMode: 'pack_2' }
            });
        });
    }
    
    log(`數字型包牌完成: ${tickets.length}注`);
    return tickets;
}

function ai_packCombo({ data, gameDef, packMode, targetCount, mode }) {
    // 樂透型包牌（539 等）
    const tickets = [];
    const scores = ai_buildCandidateScores({
        data,
        range: gameDef.range,
        count: gameDef.count,
        isZone2: false,
        params: AI_CONFIG.PARAMS.lotto
    });
    
    const sortedNums = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]);
    
    if (packMode === 'pack_1') {
        // Pack_1: 使用軟性降權
        const currentScores = { ...scores };
        
        for (let i = 0; i < targetCount; i++) {
            const candidates = Object.keys(currentScores)
                .map(Number)
                .sort((a, b) => currentScores[b] - currentScores[a]);
            
            const combo = candidates.slice(0, gameDef.count);
            
            // 降權已選號碼
            combo.forEach(n => {
                currentScores[n] *= AI_CONFIG.PACK_PENALTY;
            });
            
            tickets.push({
                numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n])}` })),
                groupReason: `樂透包牌 ${i + 1}/${targetCount} - 軟性降權策略`,
                metadata: { version: '7.0', packMode: 'pack_1' }
            });
        }
    } else {
        // Pack_2: 動態溫度 + TopN 策略
        const strategies = AI_CONFIG.PARAMS.lotto.topNRange;
        
        for (let i = 0; i < targetCount; i++) {
            const topN = strategies[i % strategies.length];
            const tempRange = AI_CONFIG.PARAMS.lotto.tempRange;
            const temp = tempRange[0] + Math.random() * (tempRange[1] - tempRange[0]);
            
            const topCandidates = sortedNums.slice(0, Math.min(topN, sortedNums.length));
            const candidates = topCandidates.map(n => ({ num: n, score: scores[n] }));
            const combo = ai_softmaxSample(candidates, temp, gameDef.count);
            
            tickets.push({
                numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n])}` })),
                groupReason: `樂透彈性包牌 ${i + 1}/${targetCount} - Top${topN}動態抽樣`,
                metadata: { version: '7.0', packMode: 'pack_2', topN, temp: temp.toFixed(2) }
            });
        }
    }
    
    log(`樂透型包牌完成: ${tickets.length}注`);
    return tickets;
}

// ==========================================
// [E] 單注邏輯
// ==========================================
function ai_handleComboSingle({ data, gameDef, excludeNumbers, random, mode, setIndex }) {
    const scores = ai_buildCandidateScores({
        data,
        range: gameDef.range,
        count: gameDef.count,
        isZone2: false,
        params: AI_CONFIG.PARAMS.lotto
    });
    
    const { hardExclude } = ai_parseExcludeNumbers(excludeNumbers);
    
    const candidates = Object.keys(scores)
        .map(Number)
        .filter(n => !hardExclude.has(n))
        .sort((a, b) => scores[b] - scores[a]);
    
    let combo;
    if (random) {
        // 動態溫度 + 動態 TopN
        const params = AI_CONFIG.PARAMS.lotto;
        const topNOptions = params.topNRange;
        const topN = topNOptions[setIndex % topNOptions.length];
        const tempRange = params.tempRange;
        const temp = tempRange[0] + Math.random() * (tempRange[1] - tempRange[0]);
        
        const topCandidates = candidates.slice(0, Math.min(topN, candidates.length));
        combo = ai_softmaxSample(topCandidates.map(n => ({ num: n, score: scores[n] })), temp, gameDef.count);
        
        log(`隨機模式 | TopN: ${topN} | 溫度: ${temp.toFixed(2)}`);
    } else {
        combo = candidates.slice(0, gameDef.count);
    }
    
    return {
        numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n])}` })),
        groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
        metadata: { version: '7.0', mode, setIndex }
    };
}

function ai_handlePowerSingle({ data, gameDef, excludeNumbers, random, mode, setIndex }) {
    const zone1Scores = ai_buildCandidateScores({
        data,
        range: gameDef.range,
        count: 6,
        isZone2: false,
        params: AI_CONFIG.PARAMS.power_zone1
    });
    
    const zone2Scores = ai_buildCandidateScores({
        data,
        range: gameDef.zone2,
        count: 1,
        isZone2: true,
        params: AI_CONFIG.PARAMS.power_zone2
    });
    
    const { hardExclude } = ai_parseExcludeNumbers(excludeNumbers);
    
    const zone1Candidates = Object.keys(zone1Scores)
        .map(Number)
        .filter(n => !hardExclude.has(n))
        .sort((a, b) => zone1Scores[b] - zone1Scores[a]);
    
    const zone2Candidates = Object.keys(zone2Scores)
        .map(Number)
        .sort((a, b) => zone2Scores[b] - zone2Scores[a]);
    
    let zone1Combo, zone2Val;
    if (random) {
        // 第1區：動態溫度 + 動態 TopN
        const params1 = AI_CONFIG.PARAMS.power_zone1;
        const topN1 = params1.topNRange[setIndex % params1.topNRange.length];
        const temp1 = params1.tempRange[0] + Math.random() * (params1.tempRange[1] - params1.tempRange[0]);
        const topCandidates1 = zone1Candidates.slice(0, Math.min(topN1, zone1Candidates.length));
        zone1Combo = ai_softmaxSample(topCandidates1.map(n => ({ num: n, score: zone1Scores[n] })), temp1, 6);
        
        // 第2區：動態溫度 + 動態 TopN
        const params2 = AI_CONFIG.PARAMS.power_zone2;
        const topN2 = params2.topNRange[setIndex % params2.topNRange.length];
        const temp2 = params2.tempRange[0] + Math.random() * (params2.tempRange[1] - params2.tempRange[0]);
        const topCandidates2 = zone2Candidates.slice(0, Math.min(topN2, zone2Candidates.length));
        zone2Val = ai_softmaxSample(topCandidates2.map(n => ({ num: n, score: zone2Scores[n] })), temp2, 1)[0];
        
        log(`隨機模式 | Z1 TopN: ${topN1}, 溫度: ${temp1.toFixed(2)} | Z2 TopN: ${topN2}, 溫度: ${temp2.toFixed(2)}`);
    } else {
        zone1Combo = zone1Candidates.slice(0, 6);
        zone2Val = zone2Candidates[setIndex % zone2Candidates.length];
    }
    
    return {
        numbers: [
            ...zone1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(zone1Scores[n])}` })),
            { val: zone2Val, tag: `趨勢分${Math.round(zone2Scores[zone2Val])}` }
        ],
        groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
        metadata: { version: '7.0', mode, setIndex }
    };
}

function ai_handleDigitSingle({ data, gameDef, subModeId, excludeNumbers, random, mode, setIndex }) {
    const digitCount = subModeId || gameDef.count;
    const combo = [];
    
    // 輪流策略配置
    const strategies = [
        { name: 'Top3', topN: 3, tempRange: [0.8, 1.0] },
        { name: 'Top5', topN: 5, tempRange: [1.0, 1.2] },
        { name: 'Top7', topN: 7, tempRange: [1.1, 1.3] },
        { name: 'Top10', topN: 10, tempRange: [1.2, 1.4] },
        { name: '全隨機', topN: 10, tempRange: [1.5, 2.0] }
    ];
    
    for (let pos = 0; pos < digitCount; pos++) {
        const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
        const candidates = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]);
        
        let pick;
        if (random) {
            // 使用輪流策略
            const strategy = strategies[setIndex % strategies.length];
            const topN = Math.min(strategy.topN, candidates.length);
            const temp = strategy.tempRange[0] + Math.random() * (strategy.tempRange[1] - strategy.tempRange[0]);
            const topCandidates = candidates.slice(0, topN).map(n => ({ num: n, score: scores[n] }));
            pick = ai_softmaxSample(topCandidates, temp, 1)[0];
        } else {
            pick = candidates[setIndex % Math.min(5, candidates.length)];
        }
        
        combo.push({ val: pick, tag: `趨勢分${Math.round(scores[pick])}` });
    }
    
    return {
        numbers: combo,
        groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
        metadata: { version: '7.0', mode, setIndex }
    };
}

// ==========================================
// [F] 核心演算法 - 候選分數計算
// ==========================================
function ai_buildCandidateScores({ data, range, count, isZone2, params }) {
    const { h_short, h_long, epsilon, kPrior } = params;
    const minNum = (range === 9) ? 0 : 1;
    const maxNum = range;
    
    const numbersPerDraw = data.map(d => {
        if (isZone2) {
            return [d.zone2 || d.numbers[d.numbers.length - 1]];
        } else {
            return d.numbers.slice(0, count).filter(n => n >= minNum && n <= maxNum);
        }
    });
    
    const weights_short = ai_computeHalfLifeWeights(data.length, h_short);
    const weights_long = ai_computeHalfLifeWeights(data.length, h_long);
    
    const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, minNum, maxNum);
    const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, minNum, maxNum);
    
    const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, minNum, maxNum, epsilon);
    const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);
    
    const shrunkScores = {};
    for (let n = minNum; n <= maxNum; n++) {
        shrunkScores[n] = momentum[n] * shrinkage;
    }
    
    const trendScores = ai_percentileRankTransform(shrunkScores, 10, 98);
    
    log(`候選分數計算完成 | range: ${minNum}-${maxNum} | shrinkage: ${shrinkage.toFixed(3)}`);
    return trendScores;
}

function ai_buildDigitPosScores({ data, pos, params }) {
    const numbersPerDraw = data.map(d => {
        if (d.numbers && d.numbers.length > pos) {
            return [d.numbers[pos]];
        }
        return [];
    }).filter(arr => arr.length > 0);
    
    const { h_short, h_long, epsilon, kPrior } = params;
    
    const weights_short = ai_computeHalfLifeWeights(numbersPerDraw.length, h_short);
    const weights_long = ai_computeHalfLifeWeights(numbersPerDraw.length, h_long);
    
    const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, 0, 9);
    const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, 0, 9);
    
    const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, 0, 9, epsilon);
    const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);
    
    const shrunkScores = {};
    for (let n = 0; n <= 9; n++) {
        shrunkScores[n] = momentum[n] * shrinkage;
    }
    
    const trendScores = ai_percentileRankTransform(shrunkScores, 10, 98);
    return trendScores;
}

// ==========================================
// [G] 工具函式
// ==========================================
function ai_parseExcludeNumbers(excludeNumbers) {
    const hardExclude = new Set();
    const layerB = [];
    
    if (excludeNumbers instanceof Set) {
        excludeNumbers.forEach(n => hardExclude.add(n));
    } else if (Array.isArray(excludeNumbers)) {
        if (excludeNumbers.length > 0) {
            if (typeof excludeNumbers[0] === 'number') {
                excludeNumbers.forEach(n => hardExclude.add(n));
            } else if (Array.isArray(excludeNumbers[0])) {
                excludeNumbers.forEach(combo => layerB.push(combo));
            }
        }
    }
    
    return { hardExclude, layerB };
}

function ai_pickTopNumbers(scores, count, exclude) {
    const candidates = Object.keys(scores)
        .map(Number)
        .filter(n => !exclude.has(n))
        .sort((a, b) => scores[b] - scores[a]);
    
    return candidates.slice(0, count);
}

function ai_softmaxSample(candidates, temperature, count) {
    if (candidates.length === 0) return [];
    
    const maxScore = Math.max(...candidates.map(c => c.score));
    const expScores = candidates.map(c => Math.exp((c.score - maxScore) / temperature));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probs = expScores.map(e => e / sumExp);
    
    const picked = [];
    const remaining = [...candidates];
    const remainingProbs = [...probs];
    
    for (let i = 0; i < count && remaining.length > 0; i++) {
        const rand = Math.random();
        let cumProb = 0;
        let idx = 0;
        
        for (let j = 0; j < remainingProbs.length; j++) {
            cumProb += remainingProbs[j];
            if (rand <= cumProb) {
                idx = j;
                break;
            }
        }
        
        picked.push(remaining[idx].num);
        remaining.splice(idx, 1);
        remainingProbs.splice(idx, 1);
        
        const newSum = remainingProbs.reduce((a, b) => a + b, 0);
        if (newSum > 0) {
            for (let j = 0; j < remainingProbs.length; j++) {
                remainingProbs[j] /= newSum;
            }
        }
    }
    
    return picked;
}

function ai_uniquePermutations(nums) {
    const counts = new Map();
    nums.forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
    const uniqueVals = Array.from(counts.keys());
    const res = [];
    const path = [];
    
    const dfs = () => {
        if (path.length === nums.length) {
            res.push([...path]);
            return;
        }
        
        for (const v of uniqueVals) {
            const c = counts.get(v) || 0;
            if (c <= 0) continue;
            counts.set(v, c - 1);
            path.push(v);
            dfs();
            path.pop();
            counts.set(v, c);
        }
    };
    
    dfs();
    return res;
}

function ai_cartesianProduct(arrays) {
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0].map(x => [x]);
    
    const result = [];
    const helper = (current, remaining) => {
        if (remaining.length === 0) {
            result.push([...current]);
            return;
        }
        
        for (const item of remaining[0]) {
            helper([...current, item], remaining.slice(1));
        }
    };
    
    helper([], arrays);
    return result;
}

function ai_posDiff(combo1, combo2) {
    let diff = 0;
    for (let i = 0; i < combo1.length; i++) {
        if (combo1[i] !== combo2[i]) diff++;
    }
    return diff;
}

function ai_fisherYates(arr) {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
}

function ai_arrayToScoreMap(arr, scoreMap) {
    const result = {};
    arr.forEach(n => {
        result[n] = scoreMap[n] || 0;
    });
    return result;
}
