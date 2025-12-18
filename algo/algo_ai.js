// ==========================================
// AI 學派 V7.0 - 時間序列動能分析
// ==========================================

// [A] 配置區（參考 Pattern 風格）
const AI_CONFIG = {
    DEBUG_MODE: false,
    
    // 超參數配置（依玩法分組）
    PARAMS: {
        lotto: { h_short: 8, h_long: 50, epsilon: 1, kPrior: 5, temperature: 0.7 },
        power_zone1: { h_short: 8, h_long: 50, epsilon: 1, kPrior: 5, temperature: 0.7 },
        power_zone2: { h_short: 15, h_long: 80, epsilon: 2, kPrior: 10, temperature: 0.5 },
        digit: { h_short: 10, h_long: 60, epsilon: 1, kPrior: 8, temperature: 0.6 }
    },
    
    // strict 模式 overlap 階梯
    OVERLAP_THRESHOLDS: {
        lotto: [2, 2, 3, 3, 4],  // setIndex 0-4
        digit: [1, 1, 2, 2, 2]
    },
    
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

// [C] 主入口函式（參考 Pattern 簽名）
export function algoAI({
    data,
    gameDef,
    subModeId,
    excludeNumbers = [],  // 雙層語意：Set<number> 或 Array<number[]>
    random = false,
    mode = 'strict',
    packMode = null,
    targetCount = 5,
    setIndex = 0
}) {
    log(`啟動 | 玩法: ${gameDef.type} | 模式: ${mode} | 包牌: ${packMode || '單注'}`);
    
    // 1. 資料驗證
    // 2. 包牌模式
    // 3. 單注模式
}

// [D] 包牌邏輯
function ai_handlePackMode({ ... }) { ... }
function ai_packPower({ ... }) { ... }
function ai_packDigit({ ... }) { ... }
function ai_packCombo({ ... }) { ... }

// [E] 單注邏輯（strict / random）
function ai_handleComboSingle({ ... }) { ... }
function ai_handleDigitSingle({ ... }) { ... }

// [F] 核心演算法
function ai_buildCandidateScores({ ... }) {
    // 調用 utils.js:
    // - ai_computeHalfLifeWeights
    // - ai_computeWeightedStats
    // - ai_computeLogLift
    // - ai_computeKishShrinkage
    // - ai_percentileRankTransform
}

// [G] 組注邏輯（deterministic TOP5 + overlap 去重）
function ai_generateCombinations({ ... }) { ... }
function ai_pickTopCombinations({ ... }) { ... }

// [H] 內部工具函式
function ai_softmaxSample({ ... }) { ... }
function ai_computeOverlap(combo1, combo2) { ... }
function ai_uniquePermutations(nums) { ... }
function ai_cartesianProduct(arrays) { ... }
function ai_parseExcludeNumbers(excludeNumbers) {
    // 雙層語意解析：
    // - Layer A: Set<number> 或 number[] -> 硬排除
    // - Layer B: Array<number[]> -> 注級累積
}
