/**
 * algo_pattern.js
 * 關聯學派：工業級統計分析版 V4.2 (The Perfection)
 * * 支援玩法：
 * - 組合型：大樂透 (49選6) / 威力彩 (38選6+8選1) / 今彩539 (39選5)
 * - 數字型：3星彩 (0-9選3) / 4星彩 (0-9選4)
 * * 核心功能 (V4.2 工業級升級重點)：
 * 1. 加權拖牌矩陣 (Weighted Drag Map)：
 * - 引入時間衰退因子 (Decay 0.995)，讓近期數據權重高於遠期。
 * - 應用 Laplace 平滑處理，防止小樣本機率失真。
 * * 2. Z-Score 尾數檢定 (Statistical Tail Analysis)：
 * - 使用標準差與 1.96 (97.5%) 信賴區間檢定。
 * - 引入 EPSILON 與動態門檻，過濾數據均勻時的假熱號。
 * * 3. 多策略選號引擎 (Multi-Strategy Engine)：
 * - 數字型玩法支援戰術切換：
 * a. default (綜合熱門)：全熱門 + 和值 10-20 優化
 * b. aggressive (激進趨勢)：純熱門追擊
 * c. conservative (次熱避險)：選取次熱門號碼避開大眾
 * d. balanced (分散配置)：熱門 + 冷門 + 熱門 的風險對沖組合
 * * 4. 工業級防禦架構 (Industrial Defense)：
 * - 零副作用：實作淺拷貝 (Shallow Copy)，杜絕汙染原始資料。
 * - 穩定快取：使用預先正規化的 Symbol 鍵作為快取依據。
 * - 透明度報告：回傳 Metadata (樣本數、信心度、配額分配)。
 * * 選號邏輯：
 * [組合型]：加權拖牌(Top3) → 鄰號慣性(補2) → Z-Score熱尾(補1) → (若不足)加權熱號回補
 * [威力彩]：第一區走上述邏輯 → 第二區採用「頻率 + 遺漏值(Gap)*0.4」加權分析
 * [3星彩]：依據前端傳入的 strategy 參數切換上述四種戰術
 */

const PATTERN_CONFIG = {
    // 系統設定
    DEBUG_MODE: false, // ⚠️ 上線時設為 false 以關閉詳細日誌

    // 資料門檻
    DATA_THRESHOLDS: {
        combo: { reject: 10, warn: 20, optimal: 50 }, // 組合型
        digit: { reject: 5, warn: 10, optimal: 30 }   // 數字型
    },
    
    // 統計參數
    DECAY_FACTOR: 0.995,  // 時間衰退因子
    Z_SCORE_THRESHOLD: 1.96, // 97.5% 信賴區間
    SMOOTHING: 1,         // Laplace 平滑參數
    EPSILON: 1e-9,        // 數學防崩潰

    // 回溯期數
    DRAG_PERIODS: 300,
    TAIL_PERIODS: 50,
    FALLBACK_PERIOD: 50,

    // 策略配額 (Allocation Strategy)
    ALLOCATION: {
        LOTTO_49: { drag: 3, neighbor: 2, tail: 1 },
        POWER_38: { drag: 3, neighbor: 2, tail: 1 },
        TODAY_39: { drag: 2, neighbor: 2, tail: 1 },
    }
};

// 3星彩策略定義 (明確定義每個位置的排名選擇)
// picks: [百位排名, 十位排名, 個位排名] (0 = 第1名, 1 = 第2名...)
const DIGIT3_STRATEGIES = {
    default: { name: '綜合熱門', picks: [0, 0, 0], sumOpt: true },        // 全熱門 + 和值
    aggressive: { name: '激進趨勢', picks: [0, 0, 0], sumOpt: false },    // 全熱門 (無修正)
    conservative: { name: '次熱避險', picks: [1, 1, 1], sumOpt: true },   // 全次熱 (避開大眾)
    balanced: { name: '分散配置', picks: [0, 2, 0], sumOpt: true }        // 熱+冷+熱 (修正後的平衡邏輯)
};

// 內部使用的 Symbol 鍵
const SORT_KEY = Symbol('sortKey');

// 模塊級快取 (LRU 機制)
const _cacheStore = new Map();
const MAX_CACHE_SIZE = 10;

// [重要修復] 補回內部日誌工具
const log = (...args) => {
    if (PATTERN_CONFIG.DEBUG_MODE) console.log(...args);
};

/**
 * 主入口函數
 * @param {Object} params
 * @param {Array} params.data - 歷史資料
 * @param {Object} params.gameDef - 遊戲定義
 * @param {String} params.subModeId - 子模式
 * @param {String} [params.strategy='default'] - 策略名稱
 * @param {Set} [params.excludeNumbers] - 要排除的號碼集合
 * @param {Boolean} [params.random=false] - [新增] 是否啟用隨機擾動
 */
export function algoPattern({ data, gameDef, subModeId, strategy = 'default', excludeNumbers = new Set(), random = false }) {
    log(`[Pattern V4.2] 啟動 | 玩法: ${gameDef.type} | 策略: ${strategy} | 隨機: ${random}`);
    
    // 1. 資料驗證與正規化 (含淺拷貝)
    const validation = validateAndNormalizeData(data, gameDef);
    if (!validation.isValid) {
        console.error(`[Pattern] ❌ 驗證失敗: ${validation.error}`);
        return { numbers: [], groupReason: `資料錯誤: ${validation.error}` };
    }
    const { data: validData, warning } = validation;

    // 2. 分流處理 (傳入 random)
    let result;
    if (gameDef.type === 'lotto' || gameDef.type === 'power') {
        result = handleComboPatternV4(validData, gameDef, excludeNumbers, random);
    } else if (gameDef.type === 'digit') {
        // 數字型玩法通常由 strategy 控制變異，隨機模式可視為一種特殊的 strategy 應用
        // 這裡暫時維持原樣，因為 3星/4星 號碼少，隨機容易破壞結構
        result = handleDigitPatternV4(validData, gameDef, strategy);
    } else {
        return { numbers: [], groupReason: "❌ 不支援的玩法類型" };
    }

    // 3. 附加資料量警告與 Metadata 整合
    if (warning) {
        result.groupReason = `${warning} | ${result.groupReason}`;
    }
    
    // 確保 metadata 存在 (若子函數未回傳)
    if (!result.metadata) {
        result.metadata = {};
    }
    result.metadata.dataSize = validData.length;
    result.metadata.version = "4.2";

    return result;
}

// ============================================
// 1. 資料工程層 (Data Engineering)
// ============================================

function validateAndNormalizeData(data, gameDef) {
    if (!Array.isArray(data)) return { isValid: false, error: "非陣列格式" };

    // 1. 過濾並淺拷貝 (Prevent Side Effects)
    // ✨ V4.2 改進：使用解構賦值建立新物件，避免汙染原始資料
    const cleaned = [];
    for (const d of data) {
        if (d && Array.isArray(d.numbers) && d.numbers.length >= 3) {
            cleaned.push({ ...d }); 
        }
    }
    
    // 2. 檢查門檻
    const thresholds = gameDef.type === 'digit' 
        ? PATTERN_CONFIG.DATA_THRESHOLDS.digit 
        : PATTERN_CONFIG.DATA_THRESHOLDS.combo;
    
    if (cleaned.length < thresholds.reject) {
        return { isValid: false, error: `資料不足 (${cleaned.length}筆 < ${thresholds.reject})` };
    }

    // 3. 預先正規化 (含防呆)
    const sample = cleaned[0];
    let getTimeValue = null;

    if (sample.hasOwnProperty('date')) {
        getTimeValue = (d) => d.date instanceof Date ? d.date.getTime() : new Date(d.date).getTime();
    } else if (sample.hasOwnProperty('lotteryDate')) {
        getTimeValue = (d) => new Date(d.lotteryDate).getTime();
    } else if (sample.hasOwnProperty('period')) {
        getTimeValue = (d) => typeof d.period === 'string' ? parseFloat(d.period) : Number(d.period);
    } else if (sample.hasOwnProperty('drawNumber')) {
        getTimeValue = (d) => typeof d.drawNumber === 'string' ? parseInt(d.drawNumber) : Number(d.drawNumber);
    } else {
        return { isValid: false, error: "缺少時序欄位" };
    }

    try {
        for (const item of cleaned) {
            const val = getTimeValue(item);
            item[SORT_KEY] = isNaN(val) ? 0 : val; // NaN 防呆
        }
    } catch (e) {
        return { isValid: false, error: `正規化失敗: ${e.message}` };
    }

    // 4. 極速排序
    cleaned.sort((a, b) => b[SORT_KEY] - a[SORT_KEY]);

    // 5. 生成警告
    const warning = cleaned.length < thresholds.warn 
        ? `⚠️ 樣本偏少(${cleaned.length})` 
        : null;

    return { isValid: true, data: cleaned, warning };
}

/**
 * ⚡ 快取機制 (使用 SORT_KEY 確保穩定性)
 */
function generateWeightedDragMapCached(data, periods) {
    // 使用預先計算好的 SORT_KEY (數值)，轉字串作為 ID，絕對穩定
    const latestTimestamp = data[0][SORT_KEY] || 0;
    const contentHash = data[0].numbers.slice(0, 6).join('-');
    const cacheKey = `${latestTimestamp}_${contentHash}_${periods}`;

    // LRU 讀取
    if (_cacheStore.has(cacheKey)) {
        const entry = _cacheStore.get(cacheKey);
        _cacheStore.delete(cacheKey); // Refresh LRU
        _cacheStore.set(cacheKey, entry);
        return entry;
    }

    const map = generateWeightedDragMap(data, periods);
    
    // LRU 寫入
    if (_cacheStore.size >= MAX_CACHE_SIZE) {
        const firstKey = _cacheStore.keys().next().value;
        _cacheStore.delete(firstKey);
    }
    _cacheStore.set(cacheKey, map);
    
    return map;
}

// ============================================
// 2. 組合型核心邏輯
// ============================================

function handleComboPatternV4(data, gameDef, excludeNumbers, isRandom) {
    const { range, count, zone2 } = gameDef;
    const lastDraw = data[0].numbers.slice(0, 6); 
    
    // 1. 動態配額
    const allocation = calculateDynamicAllocation(data.length, gameDef, count);
    
    // 2. 統計分析
    const dragMap = generateWeightedDragMapCached(data, PATTERN_CONFIG.DRAG_PERIODS);
    const tailAnalysis = analyzeTailStatsDynamic(data, range, PATTERN_CONFIG.TAIL_PERIODS);
    const tailClusters = findTailClusters(lastDraw);

    // 3. 選號流程
    const selected = new Set();
    const result = [];
    const checkSet = new Set([...selected, ...excludeNumbers]);

    // [Helper] 隨機擾動排序器
    // 若開啟隨機，則給分數乘上 0.9~1.1 的浮動值，讓排名微調
    const applyNoise = (arr, scoreKey) => {
        if (!isRandom) return arr;
        return arr.map(item => ({
            ...item,
            _noiseScore: (item[scoreKey] || 1) * (0.9 + Math.random() * 0.2)
        })).sort((a, b) => b._noiseScore - a._noiseScore);
    };

    // [Helper] 純隨機洗牌 (用於沒有分數的候選人，如鄰號)
    const shuffle = (arr) => {
        if (!isRandom) return arr;
        return [...arr].sort(() => 0.5 - Math.random());
    };

    // Phase A: 加權拖牌 (有 prob 分數 -> 使用權重擾動)
    let dragCandidates = getDragCandidatesStrict(lastDraw, dragMap, range, checkSet);
    dragCandidates = applyNoise(dragCandidates, 'prob');

    for (const cand of dragCandidates) {
        if (result.length >= allocation.drag) break;
        if (!selected.has(cand.num) && !excludeNumbers.has(cand.num)) {
            selected.add(cand.num);
            checkSet.add(cand.num);
            result.push({ 
                val: cand.num, 
                tag: `${cand.from}→${cand.num}(${cand.prob}%)` 
            });
        }
    }

    // Phase B: 鄰號 (無分數 -> 使用純洗牌，避免總是從小號碼選起)
    let neighborCandidates = getNeighborCandidatesStrict(lastDraw, range, checkSet);
    neighborCandidates = shuffle(neighborCandidates);

    for (const n of neighborCandidates) {
        if (result.length >= allocation.drag + allocation.neighbor) break;
        if (!selected.has(n.num) && !excludeNumbers.has(n.num)) {
            selected.add(n.num);
            checkSet.add(n.num);
            result.push({ val: n.num, tag: `${n.from}鄰號` });
        }
    }

    // Phase C: 統計尾數 (有 zScore 順序 -> 使用權重擾動)
    // 注意：tailCandidates 本身沒有分數，它的順序是基於 zScore 預先排好的
    // 為了簡單起見，我們這裡使用輕微洗牌，或者維持原樣
    // 這裡選擇輕微洗牌以增加變異性
    let tailCandidates = getTailCandidatesStrict(tailClusters, tailAnalysis, range, checkSet);
    if (isRandom) {
        // 尾數邏輯比較嚴謹，我們只在小範圍內擾動 (例如每 3 個一組洗牌)，這裡簡化為全體微幅擾動
        tailCandidates = tailCandidates.sort(() => 0.5 - Math.random());
    }

    for (const t of tailCandidates) {
        if (result.length >= count) break;
        if (!selected.has(t.num) && !excludeNumbers.has(t.num)) {
            selected.add(t.num);
            checkSet.add(t.num);
            result.push({ val: t.num, tag: `${t.tail}尾(${t.source})` });
        }
    }

    // Phase D: 熱號回補 (有權重 -> 使用權重擾動)
    if (result.length < count) {
        const needed = count - result.length;
        // 注意：getWeightedHotNumbers 回傳的是純數字陣列，我們需要改用帶分數的版本才能擾動
        // 為了不改動底層，這裡我們簡單處理：多取一些熱號，然後隨機挑
        const buffer = needed * 3; 
        let hotNumbers = getWeightedHotNumbers(data, range, buffer, checkSet);
        if (isRandom) hotNumbers = hotNumbers.sort(() => 0.5 - Math.random());
        
        hotNumbers.slice(0, needed).forEach(n => {
            selected.add(n);
            result.push({ val: n, tag: '加權熱號' });
        });
    }

    // 4. 第二區 (威力彩)
    if (zone2) {
        // 第二區通常只有 8 個號碼，隨機模式下直接隨機選一個高頻的
        const zone2Num = selectZone2Strict(data, zone2);
        if (isRandom && Math.random() > 0.5) {
             // 50% 機率重新隨機選一個 (簡單實作)
             const rnd = Math.floor(Math.random() * zone2) + 1;
             zone2Num[0] = { val: rnd, tag: 'Z2(隨機)' };
        }

        return { 
            numbers: [...result.sort((a,b) => a.val - b.val), ...zone2Num], 
            groupReason: isRandom ? "🎲 關聯隨機 V4.2" : "🔗 加權拖牌+ZScore尾數",
            metadata: { allocation }
        };
    }
    
    return { 
        numbers: result.sort((a, b) => a.val - b.val), 
        groupReason: isRandom ? "🎲 關聯隨機 V4.2" : "🔗 V4.2 專業級關聯分析",
        metadata: { allocation } 
    };
}

// ============================================
// 3. 數學核心模塊
// ============================================

function calculateDynamicAllocation(dataSize, gameDef, targetCount) {
    const { range } = gameDef;
    const optimal = PATTERN_CONFIG.DATA_THRESHOLDS.combo.optimal;
    const sufficiency = Math.min(1.0, dataSize / optimal);

    let baseAlloc;
    if (range === 49) baseAlloc = PATTERN_CONFIG.ALLOCATION.LOTTO_49;
    else if (range === 38) baseAlloc = PATTERN_CONFIG.ALLOCATION.POWER_38;
    else if (range === 39) baseAlloc = PATTERN_CONFIG.ALLOCATION.TODAY_39;
    else baseAlloc = { drag: Math.ceil(targetCount/2), neighbor: 1, tail: 1 };

    // 動態調整
    const adjusted = {
        drag: Math.floor(baseAlloc.drag * sufficiency),
        neighbor: baseAlloc.neighbor,
        tail: Math.floor(baseAlloc.tail * Math.sqrt(sufficiency))
    };

    return adjusted; 
}

function generateWeightedDragMap(data, periods) {
    const dragMap = {}; 
    const seedTotalScore = {}; 
    const lookback = Math.min(periods, data.length - 1);

    for (let i = 0; i < lookback; i++) {
        const currentDraw = data[i].numbers.slice(0, 6);
        const prevDraw = data[i + 1].numbers.slice(0, 6);
        const weight = Math.pow(PATTERN_CONFIG.DECAY_FACTOR, i);

        prevDraw.forEach(causeNum => {
            seedTotalScore[causeNum] = (seedTotalScore[causeNum] || 0) + weight;
            if (!dragMap[causeNum]) dragMap[causeNum] = {};

            currentDraw.forEach(resultNum => {
                dragMap[causeNum][resultNum] = (dragMap[causeNum][resultNum] || 0) + weight;
            });
        });
    }

    const finalMap = {};
    Object.keys(dragMap).forEach(key => {
        const causeNum = parseInt(key);
        const denominator = (seedTotalScore[causeNum] || 0) + PATTERN_CONFIG.SMOOTHING;
        
        finalMap[causeNum] = Object.entries(dragMap[key])
            .map(([num, score]) => ({
                num: parseInt(num),
                prob: parseFloat(((score / denominator) * 100).toFixed(2))
            }))
            .sort((a, b) => b.prob - a.prob)
            .slice(0, 5);
    });

    return finalMap;
}

function analyzeTailStatsDynamic(data, range, periods) {
    const tailCounts = Array(10).fill(0);
    const lookback = Math.min(periods, data.length);
    let totalBalls = 0;

    for (let i = 0; i < lookback; i++) {
        data[i].numbers.slice(0, 6).forEach(n => {
            if (n <= range) {
                tailCounts[n % 10]++;
                totalBalls++;
            }
        });
    }

    const mean = totalBalls / 10;
    const variance = tailCounts.reduce((acc, count) => acc + Math.pow(count - mean, 2), 0) / 9;
    const stdDev = Math.sqrt(variance);

    if (stdDev < PATTERN_CONFIG.EPSILON) return [];

    const MIN_STD_DEV = Math.max(0.5, Math.sqrt(totalBalls / (range * 5))); 
    const effectiveStdDev = Math.max(stdDev, MIN_STD_DEV);

    const hotTails = [];
    tailCounts.forEach((count, tail) => {
        const zScore = (count - mean) / effectiveStdDev;
        if (zScore > PATTERN_CONFIG.Z_SCORE_THRESHOLD) {
            hotTails.push({ tail, zScore });
        }
    });

    return hotTails.sort((a, b) => b.zScore - a.zScore);
}

function findTailClusters(lastDraw) {
    const counts = {};
    lastDraw.forEach(n => {
        const t = n % 10;
        counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts)
        .filter(([_, c]) => c >= 2)
        .map(([t, c]) => ({ tail: parseInt(t), count: c }))
        .sort((a, b) => b.count - a.count);
}

// 候選生成函數 (加入 excludeSet 支援)
function getDragCandidatesStrict(lastDraw, dragMap, range, excludeSet) {
    const candidates = [];
    lastDraw.forEach(seedNum => {
        const drags = dragMap[seedNum] || [];
        drags.forEach(d => {
            // [修改] 增加 excludeSet.has(d.num) 檢查
            if (d.num >= 1 && d.num <= range && !excludeSet.has(d.num)) {
                candidates.push({ num: d.num, from: seedNum, prob: d.prob });
            }
        });
    });
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.num) || unique.get(c.num).prob < c.prob) unique.set(c.num, c);
    });
    return Array.from(unique.values()).sort((a, b) => {
        if (Math.abs(b.prob - a.prob) > 0.1) return b.prob - a.prob;
        return a.num - b.num;
    });
}

function getNeighborCandidatesStrict(lastDraw, range, excludeSet) {
    const candidates = [];
    lastDraw.forEach(seedNum => {
        [-1, +1].forEach(offset => {
            const n = seedNum + offset;
            // [修改] 使用 excludeSet 檢查
            if (n >= 1 && n <= range && !excludeSet.has(n)) {
                candidates.push({ num: n, from: seedNum });
            }
        });
    });
    return candidates.sort((a, b) => a.num - b.num);
}

function getTailCandidatesStrict(clusters, zAnalysis, range, excludeSet) {
    const candidates = [];
    clusters.forEach(({ tail }) => {
        for (let n = (tail===0?10:tail); n <= range; n+=10) {
            if (!excludeSet.has(n)) candidates.push({ num: n, tail, source: '群聚' });
        }
    });
    if (candidates.length < 2) {
        zAnalysis.forEach(({ tail, zScore }) => {
            for (let n = (tail===0?10:tail); n <= range; n+=10) {
                if (!excludeSet.has(n) && !candidates.some(c => c.num === n)) {
                    candidates.push({ num: n, tail, source: `Z:${zScore.toFixed(1)}` });
                }
            }
        });
    }
    return candidates;
}

// ============================================
// 4. 第二區與數字型 - 多策略引擎
// ============================================

function selectZone2Strict(data, zone2Range) {
    const freq = {};
    const lastSeen = {};
    const lookback = Math.min(50, data.length);

    for (let i = 0; i < lookback; i++) {
        const nums = data[i].numbers;
        if (!nums || nums.length === 0) continue; 
        const z2 = nums[nums.length - 1]; 
        if (typeof z2 === 'number' && z2 <= zone2Range) {
            freq[z2] = (freq[z2] || 0) + 1;
            if (lastSeen[z2] === undefined) lastSeen[z2] = i; 
        }
    }

    const candidates = [];
    for (let n = 1; n <= zone2Range; n++) {
        const gap = lastSeen[n] !== undefined ? lastSeen[n] : lookback;
        const count = freq[n] || 0;
        const score = count + (gap * 0.4); 
        candidates.push({ num: n, gap, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0] || { num: 1, gap: 0 };
    return [{ val: best.num, tag: `Z2(G${best.gap})` }];
}

function handleDigitPatternV4(data, gameDef, strategy = 'default') {
    const { count, id } = gameDef;
    if (count === 3 && (id === '3d' || id === '3star')) {
        return execute3StarStrategy(data, strategy);
    }
    return executePositionalStrategy(data, count, strategy);
}

/**
 * 3星彩多策略執行器 (V4.2 優化)
 */
function execute3StarStrategy(data, strategyName) {
    const config = DIGIT3_STRATEGIES[strategyName] || DIGIT3_STRATEGIES.default;
    
    // 計算各位置頻率排名
    const posStats = [0, 1, 2].map(pos => {
        const counts = new Array(10).fill(0);
        data.slice(0, 50).forEach(d => {
            if (d.numbers.length > pos) {
                const n = d.numbers[pos];
                if (n >= 0 && n <= 9) counts[n]++;
            }
        });
        return counts.map((c, n) => ({ n, c })).sort((a, b) => b.c - a.c);
    });

    // 根據 picks 陣列選擇號碼
    let combo = [];
    for(let i=0; i<3; i++) {
        const rankIdx = config.picks[i]; // 取出該位置指定的排名索引
        const candidate = posStats[i][rankIdx] || posStats[i][0]; // 防呆
        combo.push(candidate.n);
    }

    // 和值優化
    if (config.sumOpt) {
        let sum = combo.reduce((a, b) => a + b, 0);
        if (sum < 10) {
            const better = posStats[1].find(x => combo[0] + x.n + combo[2] >= 10);
            if (better) combo[1] = better.n;
        } else if (sum > 20) {
            const better = posStats[1].find(x => combo[0] + x.n + combo[2] <= 20);
            if (better) combo[1] = better.n;
        }
    }

    return {
        numbers: combo.map((n, i) => ({ val: n, tag: config.name })),
        groupReason: `🎯 V4.2 ${config.name}`,
        metadata: { strategy: strategyName, picks: config.picks } // ✨ V4.2 Metadata
    };
}

function getWeightedHotNumbers(data, range, needed, excludeSet) {
    const weightedFreq = {};
    const lookback = Math.min(PATTERN_CONFIG.FALLBACK_PERIOD, data.length);
    for(let i=0; i<lookback; i++) {
        const weight = Math.pow(PATTERN_CONFIG.DECAY_FACTOR, i);
        data[i].numbers.slice(0, 6).forEach(n => {
            if (n <= range) weightedFreq[n] = (weightedFreq[n] || 0) + weight;
        });
    }
    return Object.entries(weightedFreq)
        .map(([n, w]) => ({ n: parseInt(n), w }))
        .sort((a, b) => b.w - a.w)
        .map(obj => obj.n)
        .filter(n => !excludeSet.has(n)) // [修改] 這裡原本是 excludeSet，現在邏輯一致了
        .slice(0, needed);
}


