/**
 * algo_pattern.js V6.0 (The Perfect Edition)
 * 關聯學派：玩法規則完全對齊版
 * 
 * ====================================
 * 版本歷史
 * ====================================
 * V4.2 - 原始工業級版本
 * V5.0 - 整合包牌（失敗，pool太小）
 * V6.0 - 完全重構（本版）
 * 
 * ====================================
 * V6.0 重大改進（解決所有顧問1提出的問題）
 * ====================================
 * 
 * 🔴 致命問題修正：
 * 1. 資料驗證系統：依玩法規則客製化驗證
 *    - 威力彩：檢查兩區範圍與位置
 *    - 大樂透：分離特別號
 *    - 3/4星：檢查位置與可重複性
 * 
 * 2. 候選池系統：擴充到 15-24 個候選
 *    - 不再用單注結果當 pool
 *    - 多來源合併：拖牌+鄰號+尾數+熱號
 *    - 每個候選帶 score + source
 * 
 * 3. 威力彩包牌：兩區完全分離
 *    - zone1Pool 和 zone2Pool 獨立建構
 *    - pack_1: 第一區鎖定 + 第二區全包（保留優點）
 *    - pack_2: 第一區分散 + 第二區彈性分配
 * 
 * 4. 數字型包牌：改用笛卡兒積
 *    - 每個位置獨立取 Top-N
 *    - 不跨位置排列
 *    - 完全符合位置制獎項條件
 * 
 * 🟡 品質問題修正：
 * 5. 統一計分系統：單一權威 score
 * 6. targetCount 全域生效
 * 7. 大樂透特別號分離處理
 * 8. 動態配額防呆機制
 * 9. metadata 完整輸出
 * 
 * ====================================
 * API 使用範例
 * ====================================
 * // 單注模式
 * const single = algoPattern({ data, gameDef, mode: 'strict', setIndex: 0 });
 * 
 * // 威力彩標準包牌（第二區全包）
 * const powerPack1 = algoPattern({ data, gameDef, packMode: 'pack_1' });
 * 
 * // 威力彩彈性包牌（分散第一區）
 * const powerPack2 = algoPattern({ data, gameDef, packMode: 'pack_2', targetCount: 5 });
 * 
 * // 3星彩笛卡兒積包牌
 * const digitPack = algoPattern({ data, gameDef, packMode: 'pack_1', targetCount: 6 });
 */

// ==========================================
// 配置區
// ==========================================
const PATTERN_CONFIG = {
  DEBUG_MODE: false,

  // 資料門檻
  DATA_THRESHOLDS: {
    combo: { reject: 10, warn: 20, optimal: 50 },
    digit: { reject: 5, warn: 10, optimal: 30 }
  },

  // 統計參數
  DECAY_FACTOR: 0.995,
  Z_SCORE_THRESHOLD: 1.96,
  SMOOTHING: 1,
  EPSILON: 1e-9,

  // 回溯期數
  DRAG_PERIODS: 300,
  TAIL_PERIODS: 50,
  FALLBACK_PERIOD: 50,

  // 動態配額
  ALLOCATION: {
    LOTTO_49: { drag: 3, neighbor: 2, tail: 1 },
    POWER_38: { drag: 3, neighbor: 2, tail: 1 },
    TODAY_39: { drag: 2, neighbor: 2, tail: 1 }
  },

  // V6.0 新增：候選池配置
  CANDIDATE_POOL: {
    combo: {
      dragTop: 8,      // 拖牌 Top 8
      neighborTop: 6,  // 鄰號 Top 6
      tailTop: 4,      // 尾數 Top 4
      hotTop: 6        // 熱號 Top 6
    },
    digit: {
      positionTop: 7   // 每個位置 Top 7
    }
  },

  // 包牌配置
  PACK_CONFIG: {
    MAX_CONSECUTIVE: 3,
    MIN_POOL_SIZE: 15  // 最小候選池大小
  }
};

const DIGIT_STRATEGIES = {
  default: { name: '綜合熱門' },
  aggressive: { name: '激進趨勢' },
  conservative: { name: '次熱避險' },
  balanced: { name: '分散配置' }
};

const SORT_KEY = Symbol('sortKey');
const _cacheStore = new Map();
const MAX_CACHE_SIZE = 10;

const log = (...args) => {
  if (PATTERN_CONFIG.DEBUG_MODE) console.log('[Pattern V6.0]', ...args);
};

// ==========================================
// 主入口函數
// ==========================================

/**
 * 關聯學派主入口 V6.0
 * @param {Object} params
 * @param {Array} params.data - 歷史資料
 * @param {Object} params.gameDef - 遊戲定義
 * @param {string} params.subModeId - 子模式ID
 * @param {string} params.strategy - 數字型策略
 * @param {Set} params.excludeNumbers - 排除號碼
 * @param {string} params.mode - 模式（'strict'/'balanced'/'random'）
 * @param {number} params.setIndex - 組數索引
 * @param {string} params.packMode - 包牌模式（null=單注, 'pack_1'=標準, 'pack_2'=彈性）
 * @param {number} params.targetCount - 目標注數（預設5注）
 * @returns {Object|Array} 單注或多注
 */
export function algoPattern({ 
  data, 
  gameDef, 
  subModeId, 
  strategy = 'default', 
  excludeNumbers = new Set(), 
  mode = 'strict',         // V6.0: 改用 mode 取代 random boolean
  setIndex = 0,
  packMode = null,
  targetCount = 5
}) {
  log(`啟動 | 玩法: ${gameDef.type} | 模式: ${mode} | 包牌: ${packMode || '單注'} | 目標: ${targetCount}注`);

  // 1. 資料驗證（V6.0: 玩法完整性檢查）
  const validation = pattern_validateByGameDef(data, gameDef);
  if (!validation.isValid) {
    return packMode ? [] : { 
      numbers: [], 
      groupReason: `❌ 資料驗證失敗: ${validation.error}`,
      metadata: { version: '6.0', error: validation.error }
    };
  }

  const { data: validData, warning, stats: dataStats } = validation;

  // 2. 包牌模式（V6.0: 完全重構）
  if (packMode) {
    return pattern_handlePackMode({
      data: validData,
      gameDef,
      packMode,
      targetCount,
      mode,
      warning,
      dataStats
    });
  }

  // 3. 單注模式
  let singleResult;
  if (gameDef.type === 'lotto' || gameDef.type === 'power') {
    singleResult = pattern_handleComboSingle(validData, gameDef, excludeNumbers, mode, setIndex);
  } else if (gameDef.type === 'digit') {
    singleResult = pattern_handleDigitSingle(validData, gameDef, strategy, mode, setIndex);
  } else {
    return { 
      numbers: [], 
      groupReason: "❌ 不支援的玩法類型",
      metadata: { version: '6.0' }
    };
  }

  // 4. 加上警告和元數據
  if (warning) {
    singleResult.groupReason = `${warning} | ${singleResult.groupReason}`;
  }
  singleResult.metadata = {
    ...singleResult.metadata,
    version: '6.0',
    mode,
    dataSize: validData.length,
    dataQuality: dataStats
  };

  return singleResult;
}

// ==========================================
// V6.0 核心：資料驗證系統（玩法規則對齊）
// ==========================================

/**
 * V6.0: 依玩法規則驗證資料
 */
function pattern_validateByGameDef(data, gameDef) {
  if (!Array.isArray(data)) {
    return { isValid: false, error: "非陣列格式" };
  }

  // 玩法驗證器映射
  const validators = {
    'power': pattern_validatePower,
    'lotto': pattern_validateLotto,
    'today': pattern_validateToday,
    'digit': pattern_validateDigit
  };

  const validator = validators[gameDef.type];
  if (!validator) {
    return { isValid: false, error: `未知玩法類型: ${gameDef.type}` };
  }

  return validator(data, gameDef);
}

/**
 * 威力彩驗證：7碼（6+1）、兩區範圍檢查
 */
function pattern_validatePower(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    // 檢查長度（必須是7碼：6+1）
    if (d.numbers.length !== 7) {
      rejected++;
      continue;
    }

    const zone1 = d.numbers.slice(0, 6);
    const zone2 = d.numbers[6];

    // 檢查第一區範圍（1-38）
    const hasInvalidZone1 = zone1.some(n => typeof n !== 'number' || n < 1 || n > 38);
    if (hasInvalidZone1) {
      rejected++;
      continue;
    }

    // 檢查第一區不重複
    if (new Set(zone1).size !== 6) {
      rejected++;
      continue;
    }

    // 檢查第二區範圍（1-8）
    if (typeof zone2 !== 'number' || zone2 < 1 || zone2 > 8) {
      rejected++;
      continue;
    }

    // 淺拷貝並標記兩區
    cleaned.push({ 
      ...d, 
      zone1: zone1,
      zone2: zone2
    });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

/**
 * 大樂透驗證：6碼或7碼（含特別號）、分離特別號
 */
function pattern_validateLotto(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    // 檢查長度（6或7碼）
    if (d.numbers.length < 6 || d.numbers.length > 7) {
      rejected++;
      continue;
    }

    const mainNumbers = d.numbers.slice(0, 6);
    const specialNumber = d.numbers.length === 7 ? d.numbers[6] : null;

    // 檢查範圍（1-49）
    const hasInvalidNum = mainNumbers.some(n => typeof n !== 'number' || n < 1 || n > 49);
    if (hasInvalidNum) {
      rejected++;
      continue;
    }

    // 檢查不重複
    if (new Set(mainNumbers).size !== 6) {
      rejected++;
      continue;
    }

    // 檢查特別號範圍
    if (specialNumber !== null) {
      if (typeof specialNumber !== 'number' || specialNumber < 1 || specialNumber > 49) {
        rejected++;
        continue;
      }
    }

    // V6.0: 分離特別號，統計只用前6個
    cleaned.push({ 
      ...d, 
      numbers: mainNumbers,           // 統計用前6個
      mainNumbers: mainNumbers,       // 明確標記主獎號
      specialNumber: specialNumber    // 明確標記特別號
    });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

/**
 * 今彩539驗證：5碼、範圍檢查
 */
function pattern_validateToday(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    // 檢查長度（必須是5碼）
    if (d.numbers.length !== 5) {
      rejected++;
      continue;
    }

    // 檢查範圍（1-39）
    const hasInvalidNum = d.numbers.some(n => typeof n !== 'number' || n < 1 || n > 39);
    if (hasInvalidNum) {
      rejected++;
      continue;
    }

    // 檢查不重複
    if (new Set(d.numbers).size !== 5) {
      rejected++;
      continue;
    }

    cleaned.push({ ...d });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

/**
 * 3/4星彩驗證：位數正確、0-9範圍、可重複
 */
function pattern_validateDigit(data, gameDef) {
  const cleaned = [];
  let rejected = 0;
  const expectedLength = gameDef.count;  // 3或4

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    // 檢查長度
    if (d.numbers.length !== expectedLength) {
      rejected++;
      continue;
    }

    // 檢查範圍（0-9）
    const hasInvalidNum = d.numbers.some(n => typeof n !== 'number' || n < 0 || n > 9);
    if (hasInvalidNum) {
      rejected++;
      continue;
    }

    // 注意：數字型可以重複（111合法），不需要檢查重複

    cleaned.push({ ...d });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

/**
 * 驗證結果統一處理
 */
function pattern_finalizeValidation(cleaned, rejected, gameDef, originalSize) {
  // 排序（由新到舊）
  pattern_sortData(cleaned);

  // 檢查門檻
  const thresholds = gameDef.type === 'digit'
    ? PATTERN_CONFIG.DATA_THRESHOLDS.digit
    : PATTERN_CONFIG.DATA_THRESHOLDS.combo;

  if (cleaned.length < thresholds.reject) {
    return { 
      isValid: false, 
      error: `有效資料不足 (${cleaned.length}筆 < ${thresholds.reject}筆，原始${originalSize}筆，排除${rejected}筆)` 
    };
  }

  // 生成警告
  let warning = null;
  if (rejected > originalSize * 0.1) {
    warning = `⚠️ 資料品質警告：排除了${rejected}筆 (${(rejected/originalSize*100).toFixed(1)}%)`;
  } else if (cleaned.length < thresholds.warn) {
    warning = `⚠️ 樣本偏少 (${cleaned.length}筆)`;
  }

  return { 
    isValid: true, 
    data: cleaned, 
    warning,
    stats: {
      original: originalSize,
      cleaned: cleaned.length,
      rejected: rejected,
      rejectRate: (rejected / originalSize * 100).toFixed(1) + '%'
    }
  };
}

/**
 * 資料排序（智能判斷時序欄位）
 */
function pattern_sortData(data) {
  if (data.length === 0) return;

  const sample = data[0];
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
    // 無時序欄位，使用索引
    getTimeValue = () => 0;
  }

  try {
    for (const item of data) {
      const val = getTimeValue(item);
      item[SORT_KEY] = isNaN(val) ? 0 : val;
    }
  } catch (e) {
    // 排序失敗，使用索引
    data.forEach((item, idx) => item[SORT_KEY] = -idx);
  }

  data.sort((a, b) => b[SORT_KEY] - a[SORT_KEY]);
}

// ==========================================
// V6.0 核心：候選池系統（統一計分）
// ==========================================

/**
 * V6.0: 建構候選池（組合型玩法）
 * @returns Array<{num, score, source, tags}>
 */
function pattern_buildCandidatePoolCombo(data, gameDef, config, excludeNumbers = new Set()) {
  const { range } = gameDef;
  const { dragTop, neighborTop, tailTop, hotTop } = config;
  const lastDraw = data[0].numbers.slice(0, 6);

  const candidates = new Map();  // num -> {num, score, source, tags}

  // 1. 拖牌候選
  const dragMap = pattern_generateWeightedDragMapCached(data, PATTERN_CONFIG.DRAG_PERIODS);
  lastDraw.forEach(seedNum => {
    const drags = dragMap[seedNum] || [];
    drags.slice(0, dragTop).forEach(d => {
      if (d.num >= 1 && d.num <= range && !excludeNumbers.has(d.num)) {
        pattern_addOrUpdateCandidate(candidates, d.num, d.prob, `${seedNum}拖`, ['拖牌']);
      }
    });
  });

  // 2. 鄰號候選
  lastDraw.forEach(seedNum => {
    [-1, +1].forEach(offset => {
      const n = seedNum + offset;
      if (n >= 1 && n <= range && !excludeNumbers.has(n)) {
        pattern_addOrUpdateCandidate(candidates, n, 10.0, `${seedNum}鄰`, ['鄰號']);
      }
    });
  });

  // 3. 尾數候選
  const tailAnalysis = pattern_analyzeTailStatsDynamic(data, range, PATTERN_CONFIG.TAIL_PERIODS);
  const tailClusters = pattern_findTailClusters(lastDraw);
  
  tailClusters.forEach(({ tail }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!excludeNumbers.has(n)) {
        pattern_addOrUpdateCandidate(candidates, n, 8.0, `${tail}尾群`, ['尾數', '群聚']);
      }
    }
  });

  tailAnalysis.slice(0, tailTop).forEach(({ tail, zScore }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!excludeNumbers.has(n)) {
        pattern_addOrUpdateCandidate(candidates, n, zScore * 5, `Z-${tail}尾`, ['尾數', 'Z-Score']);
      }
    }
  });

  // 4. 熱號候選
  const hotFreq = pattern_getWeightedHotFrequency(data, range, PATTERN_CONFIG.FALLBACK_PERIOD);
  Object.entries(hotFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, hotTop)
    .forEach(([num, weight]) => {
      const n = parseInt(num);
      if (!excludeNumbers.has(n)) {
        pattern_addOrUpdateCandidate(candidates, n, weight, '熱號', ['頻率']);
      }
    });

  // 5. 合併排序
  const pool = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score);

  log(`候選池建構完成: ${pool.length}個候選`);
  return pool;
}

/**
 * 新增或更新候選（取最高分）
 */
function pattern_addOrUpdateCandidate(candidates, num, score, source, tags) {
  if (!candidates.has(num)) {
    candidates.set(num, { num, score, source, tags });
  } else {
    const existing = candidates.get(num);
    if (score > existing.score) {
      existing.score = score;
      existing.source = source;
    }
    // 合併 tags
    tags.forEach(tag => {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
    });
  }
}

/**
 * V6.0: 建構候選池（數字型玩法）
 * @returns Array<Array<{num, score}>> - 每個位置的候選池
 */
function pattern_buildCandidatePoolDigit(data, gameDef, topN) {
  const { count } = gameDef;
  const positionPools = [];

  // 位數獨立統計
  const posStats = Array.from({ length: count }, () => new Array(10).fill(0));
  data.slice(0, 50).forEach(d => {
    if (d.numbers.length >= count) {
      for (let i = 0; i < count; i++) {
        const n = d.numbers[i];
        if (n >= 0 && n <= 9) posStats[i][n]++;
      }
    }
  });

  // 每個位置排序並取 Top-N
  posStats.forEach((counts, posIdx) => {
    const sorted = counts
      .map((c, n) => ({ num: n, score: c }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
    positionPools.push(sorted);
  });

  log(`數字型候選池: 每位置 Top ${topN}`);
  return positionPools;
}

/**
 * 加權熱號頻率（統一用於候選池）
 */
function pattern_getWeightedHotFrequency(data, range, lookback) {
  const weightedFreq = {};
  const limit = Math.min(lookback, data.length);

  for (let i = 0; i < limit; i++) {
    const weight = Math.pow(PATTERN_CONFIG.DECAY_FACTOR, i);
    data[i].numbers.slice(0, 6).forEach(n => {
      if (n <= range) weightedFreq[n] = (weightedFreq[n] || 0) + weight;
    });
  }

  return weightedFreq;
}

// ==========================================
// V6.0 核心：包牌邏輯（玩法分流）
// ==========================================

/**
 * V6.0: 包牌模式處理
 */
function pattern_handlePackMode({ data, gameDef, packMode, targetCount, mode, warning, dataStats }) {
  let tickets = [];

  if (gameDef.type === 'power') {
    // 威力彩：兩區分離
    tickets = pattern_packPower(data, gameDef, packMode, targetCount, mode);
  } else if (gameDef.type === 'digit') {
    // 數字型：笛卡兒積
    tickets = pattern_packDigit(data, gameDef, packMode, targetCount, mode);
  } else {
    // 樂透型：組合演算法
    tickets = pattern_packCombo(data, gameDef, packMode, targetCount, mode);
  }

  // 加上警告和元數據
  if (warning) {
    tickets.forEach(ticket => {
      ticket.groupReason = `${warning} | ${ticket.groupReason}`;
    });
  }

  tickets.forEach((ticket, idx) => {
    ticket.metadata = {
      version: '6.0',
      mode,
      packMode,
      ticketIndex: idx + 1,
      totalTickets: tickets.length,
      dataSize: data.length,
      dataQuality: dataStats
    };
  });

  return tickets;
}

/**
 * V6.0: 威力彩包牌（兩區分離）
 */
function pattern_packPower(data, gameDef, packMode, targetCount, mode) {
  const config = PATTERN_CONFIG.CANDIDATE_POOL.combo;
  const tickets = [];

  // 建構兩區候選池（完全分離）
  const zone1Pool = pattern_buildCandidatePoolCombo(data, gameDef, config, new Set());
  const zone2Pool = pattern_buildZone2Pool(data, gameDef.zone2);

  if (packMode === 'pack_1') {
    // 標準包牌：第一區鎖定 + 第二區全包
    const zone1Best = pattern_pickSetGreedy(zone1Pool.map(c => c.num), 6);

    for (let z2 = 1; z2 <= 8; z2++) {
      tickets.push({
        numbers: [
          ...zone1Best.map(n => ({ val: n, tag: '鎖定' })),
          { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
        ],
        groupReason: `標準包牌 - 第二區 ${String(z2).padStart(2, '0')} (第二區全包策略)`
      });
    }
  } else {
    // 彈性包牌：第一區分散 + 第二區彈性
    const actualCount = Math.min(targetCount, 12);  // 最多12注（避免過度組合）
    const step = Math.max(1, Math.floor(zone1Pool.length / actualCount));

    for (let k = 0; k < actualCount; k++) {
      const offset = k * step;
      const rotated = [...zone1Pool.slice(offset), ...zone1Pool.slice(0, offset)];
      const zone1Set = pattern_pickSetGreedy(rotated.map(c => c.num), 6);
      const zone2Num = zone2Pool[k % zone2Pool.length].num;

      tickets.push({
        numbers: [
          ...zone1Set.map(n => ({ val: n, tag: '分散' })),
          { val: zone2Num, tag: `Z2(G${zone2Pool[k % zone2Pool.length].gap})` }
        ],
        groupReason: `彈性包牌 ${k + 1}/${actualCount} - 第一區分散策略`
      });
    }
  }

  log(`威力彩包牌完成: ${tickets.length}注`);
  return tickets;
}

/**
 * 建構第二區候選池（頻率+Gap）
 */
function pattern_buildZone2Pool(data, zone2Range) {
  const freq = {};
  const lastSeen = {};
  const lookback = Math.min(50, data.length);

  for (let i = 0; i < lookback; i++) {
    const zone2 = data[i].zone2 || data[i].numbers[data[i].numbers.length - 1];
    if (typeof zone2 === 'number' && zone2 >= 1 && zone2 <= zone2Range) {
      freq[zone2] = (freq[zone2] || 0) + 1;
      if (lastSeen[zone2] === undefined) lastSeen[zone2] = i;
    }
  }

  const pool = [];
  for (let n = 1; n <= zone2Range; n++) {
    const gap = lastSeen[n] !== undefined ? lastSeen[n] : lookback;
    const count = freq[n] || 0;
    const score = count + (gap * 0.4);
    pool.push({ num: n, gap, score });
  }

  pool.sort((a, b) => b.score - a.score);
  return pool;
}

/**
 * V6.0: 數字型包牌（笛卡兒積）
 */
function pattern_packDigit(data, gameDef, packMode, targetCount, mode) {
  const { count } = gameDef;
  const tickets = [];

  if (packMode === 'pack_1') {
    // 標準包牌：笛卡兒積
    // 反推每個位置需要幾個候選
    const K = Math.max(2, Math.ceil(Math.pow(targetCount, 1 / count)));
    const positionPools = pattern_buildCandidatePoolDigit(data, gameDef, K);

    // 笛卡兒積
    const combinations = pattern_cartesianProduct(positionPools.map(p => p.map(c => c.num)));
    
    combinations.slice(0, targetCount).forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `標準包牌 ${idx + 1}/${Math.min(targetCount, combinations.length)} - 笛卡兒積組合`
      });
    });

  } else {
    // 彈性包牌：每個位置取更多候選，隨機組合
    const positionPools = pattern_buildCandidatePoolDigit(data, gameDef, 7);

    for (let k = 0; k < targetCount; k++) {
      const combo = positionPools.map((pool, pos) => {
        const idx = (k + pos) % pool.length;
        return pool[idx].num;
      });

      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `彈性包牌 ${k + 1}/${targetCount} - 位置輪轉組合`
      });
    }
  }

  log(`數字型包牌完成: ${tickets.length}注`);
  return tickets;
}

/**
 * 笛卡兒積
 */
function pattern_cartesianProduct(arrays) {
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

/**
 * V6.0: 樂透型包牌（大樂透/539）
 */
function pattern_packCombo(data, gameDef, packMode, targetCount, mode) {
  const config = PATTERN_CONFIG.CANDIDATE_POOL.combo;
  const tickets = [];

  const pool = pattern_buildCandidatePoolCombo(data, gameDef, config, new Set());

  if (pool.length < PATTERN_CONFIG.PACK_CONFIG.MIN_POOL_SIZE) {
    log(`候選池過小 (${pool.length} < ${PATTERN_CONFIG.PACK_CONFIG.MIN_POOL_SIZE})，包牌失敗`);
    return [];
  }

  const poolNums = pool.map(c => c.num);

  if (packMode === 'pack_1') {
    // 標準包牌：deterministic 輪轉
    const step = Math.max(1, Math.floor(poolNums.length / targetCount));

    for (let k = 0; k < targetCount; k++) {
      const offset = k * step;
      const rotated = [...poolNums.slice(offset), ...poolNums.slice(0, offset)];
      const set = pattern_pickSetGreedy(rotated, gameDef.count);

      tickets.push({
        numbers: set.map(n => ({ val: n, tag: '優選' })),
        groupReason: `標準包牌 ${k + 1}/${targetCount} - 輪轉組合`
      });
    }

  } else {
    // 彈性包牌：隨機但保留連號限制
    for (let k = 0; k < targetCount; k++) {
      let set = [];
      let tries = 0;

      while (tries < 12 && set.length < gameDef.count) {
        const shuffled = pattern_fisherYates([...poolNums]);
        const candidate = [...new Set(shuffled)].slice(0, gameDef.count);
        
        if (candidate.length === gameDef.count && pattern_isConsecutiveOk(candidate)) {
          set = candidate.sort((a, b) => a - b);
          break;
        }
        tries++;
      }

      if (set.length < gameDef.count) {
        // fallback
        set = pattern_pickSetGreedy(poolNums, gameDef.count);
      }

      tickets.push({
        numbers: set.map(n => ({ val: n, tag: '彈性' })),
        groupReason: `彈性包牌 ${k + 1}/${targetCount} - 隨機組合`
      });
    }
  }

  log(`樂透型包牌完成: ${tickets.length}注`);
  return tickets;
}

// ==========================================
// 單注邏輯（保留 V4.2 核心，微調）
// ==========================================

/**
 * 組合型單注
 */
function pattern_handleComboSingle(data, gameDef, excludeNumbers, mode, setIndex) {
  const { range, count, zone2 } = gameDef;
  const lastDraw = data[0].numbers.slice(0, 6);
  const isRandom = mode === 'random';

  // 動態配額（V6.0: 加防呆）
  const allocation = pattern_calculateDynamicAllocationSafe(data.length, gameDef, count);

  // 拖牌矩陣
  const dragMap = pattern_generateWeightedDragMapCached(data, PATTERN_CONFIG.DRAG_PERIODS);
  const tailAnalysis = pattern_analyzeTailStatsDynamic(data, range, PATTERN_CONFIG.TAIL_PERIODS);
  const tailClusters = pattern_findTailClusters(lastDraw);

  const selected = new Set();
  const result = [];
  const checkSet = new Set(excludeNumbers);
  const stats = { drag: 0, neighbor: 0, tail: 0, hot: 0 };

  const isConsecutiveSafe = (currentList, newNum) => {
    const nums = [...currentList.map(x => x.val), newNum].sort((a, b) => a - b);
    let maxCons = 1, currentCons = 1;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1] + 1) currentCons++;
      else currentCons = 1;
      maxCons = Math.max(maxCons, currentCons);
    }
    return maxCons <= 3;
  };

  const applyNoise = (arr, scoreKey) => {
    if (!isRandom) return arr;
    return arr.map(item => ({
      ...item,
      _noiseScore: (item[scoreKey] || 1) * (0.9 + Math.random() * 0.2)
    })).sort((a, b) => b._noiseScore - a._noiseScore);
  };

  const shuffle = (arr) => pattern_fisherYates(arr);

  // Phase A: 拖牌
  let dragCandidates = pattern_getDragCandidatesStrict(lastDraw, dragMap, range, checkSet);
  dragCandidates = applyNoise(dragCandidates, 'prob');
  for (const cand of dragCandidates) {
    if (result.length >= allocation.drag) break;
    if (!selected.has(cand.num) && isConsecutiveSafe(result, cand.num)) {
      selected.add(cand.num);
      checkSet.add(cand.num);
      result.push({ val: cand.num, tag: `${cand.from}拖` });
      stats.drag++;
    }
  }

  // Phase B: 鄰號
  let neighborCandidates = pattern_getNeighborCandidatesStrict(lastDraw, range, checkSet);
  if (isRandom) neighborCandidates = shuffle(neighborCandidates);
  for (const n of neighborCandidates) {
    if (result.length >= allocation.drag + allocation.neighbor) break;
    if (!selected.has(n.num) && isConsecutiveSafe(result, n.num)) {
      selected.add(n.num);
      checkSet.add(n.num);
      result.push({ val: n.num, tag: `${n.from}鄰` });
      stats.neighbor++;
    }
  }

  // Phase C: 尾數
  let tailCandidates = pattern_getTailCandidatesStrict(tailClusters, tailAnalysis, range, checkSet);
  if (isRandom) tailCandidates = shuffle(tailCandidates);
  for (const t of tailCandidates) {
    if (result.length >= count) break;
    if (!selected.has(t.num) && isConsecutiveSafe(result, t.num)) {
      selected.add(t.num);
      checkSet.add(t.num);
      result.push({ val: t.num, tag: `${t.tail}尾` });
      stats.tail++;
    }
  }

  // Phase D: 熱號回補
  if (result.length < count) {
    const needed = count - result.length;
    const hotFreq = pattern_getWeightedHotFrequency(data, range, PATTERN_CONFIG.FALLBACK_PERIOD);
    let hotNumbers = Object.entries(hotFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([n, w]) => parseInt(n))
      .filter(n => !checkSet.has(n))
      .slice(0, needed * 5);

    const isLowEntropy = hotNumbers.slice(0, 5).every((n, i) => n === hotNumbers[0] + i);
    if (isLowEntropy || isRandom) hotNumbers = shuffle(hotNumbers);

    for (const n of hotNumbers) {
      if (stats.hot >= needed) break;
      if (isConsecutiveSafe(result, n)) {
        selected.add(n);
        result.push({ val: n, tag: '熱號' });
        stats.hot++;
      }
    }
  }

  const structStr = [];
  if (stats.drag) structStr.push(`${stats.drag}拖`);
  if (stats.neighbor) structStr.push(`${stats.neighbor}鄰`);
  if (stats.tail) structStr.push(`${stats.tail}尾`);
  if (stats.hot) structStr.push(`${stats.hot}熱`);
  const reasonPrefix = isRandom ? "隨機結構" : "嚴選結構";
  const groupReason = `${reasonPrefix}：${structStr.join('/')}`;

  // 第二區
  if (zone2) {
    const z2Pool = pattern_buildZone2Pool(data, zone2);
    let z2Pick;
    if (isRandom && z2Pool.length >= 3) {
      const top3 = z2Pool.slice(0, 3);
      const rndIdx = Math.floor(Math.random() * top3.length);
      z2Pick = { val: top3[rndIdx].num, tag: `Z2(隨機)` };
    } else {
      const pickIdx = setIndex % Math.min(5, z2Pool.length);
      z2Pick = { val: z2Pool[pickIdx].num, tag: `Z2(G${z2Pool[pickIdx].gap})` };
    }

    return {
      numbers: [...result.sort((a, b) => a.val - b.val), z2Pick],
      groupReason,
      metadata: { allocation, composition: stats }
    };
  }

  return {
    numbers: result.sort((a, b) => a.val - b.val),
    groupReason,
    metadata: { allocation, composition: stats }
  };
}

/**
 * 數字型單注
 */
function pattern_handleDigitSingle(data, gameDef, strategy, mode, setIndex) {
  const { count } = gameDef;
  const isRandom = mode === 'random';

  // 位數統計
  const posStats = Array.from({ length: count }, () => new Array(10).fill(0));
  data.slice(0, 50).forEach(d => {
    if (d.numbers.length >= count) {
      for (let i = 0; i < count; i++) {
        const n = d.numbers[i];
        if (n >= 0 && n <= 9) posStats[i][n]++;
      }
    }
  });

  // 排序
  const rankedPos = posStats.map(counts => {
    let sorted = counts.map((c, n) => ({ n, c })).sort((a, b) => b.c - a.c);
    if (isRandom) {
      const top5 = sorted.slice(0, 5);
      const shuffled = top5.map(item => ({
        ...item,
        _noise: item.c * (0.8 + Math.random() * 0.4)
      })).sort((a, b) => b._noise - a._noise);
      sorted = [...shuffled, ...sorted.slice(5)];
    }
    return sorted;
  });

  const result = [];
  const pickIndex = strategy === 'conservative' ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const actualIdx = isRandom ? pickIndex : ((pickIndex + (setIndex % 5)) % 5);
    const pick = rankedPos[i][actualIdx] || rankedPos[i][0];
    result.push({ val: pick.n, tag: `Pos${i + 1}` });
  }

  const reasonPrefix = isRandom ? '隨機數字' : '嚴選數字';
  return {
    numbers: result,
    groupReason: `${reasonPrefix} (${DIGIT_STRATEGIES[strategy]?.name || strategy})`,
    metadata: { setIndex, strategy }
  };
}

// ==========================================
// 數學核心模塊（保留 V4.2）
// ==========================================

/**
 * V6.0: 動態配額（加防呆）
 */
function pattern_calculateDynamicAllocationSafe(dataSize, gameDef, targetCount) {
  const { range } = gameDef;
  const optimal = PATTERN_CONFIG.DATA_THRESHOLDS.combo.optimal;
  const sufficiency = Math.min(1.0, dataSize / optimal);

  let baseAlloc;
  if (range === 49) baseAlloc = PATTERN_CONFIG.ALLOCATION.LOTTO_49;
  else if (range === 38) baseAlloc = PATTERN_CONFIG.ALLOCATION.POWER_38;
  else if (range === 39) baseAlloc = PATTERN_CONFIG.ALLOCATION.TODAY_39;
  else baseAlloc = { drag: Math.ceil(targetCount / 2), neighbor: 1, tail: 1 };

  // V6.0: 防呆機制（避免變成0）
  const adjusted = {
    drag: Math.max(1, Math.floor(baseAlloc.drag * sufficiency)),
    neighbor: Math.max(1, baseAlloc.neighbor),
    tail: Math.max(1, Math.floor(baseAlloc.tail * Math.sqrt(sufficiency)))
  };

  return adjusted;
}

function pattern_generateWeightedDragMapCached(data, periods) {
  const latestTimestamp = data[0][SORT_KEY] || 0;
  const contentHash = data[0].numbers.slice(0, 6).join('-');
  const cacheKey = `${latestTimestamp}_${contentHash}_${periods}`;

  if (_cacheStore.has(cacheKey)) {
    const entry = _cacheStore.get(cacheKey);
    _cacheStore.delete(cacheKey);
    _cacheStore.set(cacheKey, entry);
    return entry;
  }

  const map = pattern_generateWeightedDragMap(data, periods);

  if (_cacheStore.size >= MAX_CACHE_SIZE) {
    const firstKey = _cacheStore.keys().next().value;
    _cacheStore.delete(firstKey);
  }

  _cacheStore.set(cacheKey, map);
  return map;
}

function pattern_generateWeightedDragMap(data, periods) {
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

function pattern_analyzeTailStatsDynamic(data, range, periods) {
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

function pattern_findTailClusters(lastDraw) {
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

function pattern_getDragCandidatesStrict(lastDraw, dragMap, range, checkSet) {
  const candidates = [];
  lastDraw.forEach(seedNum => {
    const drags = dragMap[seedNum] || [];
    drags.forEach(d => {
      if (d.num >= 1 && d.num <= range && !checkSet.has(d.num)) {
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

function pattern_getNeighborCandidatesStrict(lastDraw, range, checkSet) {
  const candidates = [];
  lastDraw.forEach(seedNum => {
    [-1, +1].forEach(offset => {
      const n = seedNum + offset;
      if (n >= 1 && n <= range && !checkSet.has(n)) {
        candidates.push({ num: n, from: seedNum });
      }
    });
  });
  return candidates.sort((a, b) => a.num - b.num);
}

function pattern_getTailCandidatesStrict(clusters, zAnalysis, range, checkSet) {
  const candidates = [];
  clusters.forEach(({ tail }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!checkSet.has(n)) candidates.push({ num: n, tail, source: '群聚' });
    }
  });

  if (candidates.length < 2) {
    zAnalysis.forEach(({ tail, zScore }) => {
      for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
        if (!checkSet.has(n) && !candidates.some(c => c.num === n)) {
          candidates.push({ num: n, tail, source: `Z:${zScore.toFixed(1)}` });
        }
      }
    });
  }

  return candidates;
}

// ==========================================
// 工具函數
// ==========================================

function pattern_pickSetGreedy(pool, need) {
  const set = [];
  for (const n of pool) {
    if (set.includes(n)) continue;
    const next = [...set, n];
    if (pattern_isConsecutiveOk(next)) set.push(n);
    if (set.length >= need) break;
  }
  return set;
}

function pattern_isConsecutiveOk(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let maxCons = 1, currentCons = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) currentCons++;
    else currentCons = 1;
    if (currentCons > maxCons) maxCons = currentCons;
  }
  return maxCons <= PATTERN_CONFIG.PACK_CONFIG.MAX_CONSECUTIVE;
}

function pattern_fisherYates(arr) {
  const res = [...arr];
  for (let i = res.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}
