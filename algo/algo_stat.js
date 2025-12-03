/**
 * algo_stat.js
 * 統計學派：基於大數據慣性分析與極限遺漏回補機制
 */
// 修正引用路徑：utils.js 在上一層
import { calculateZone, getLotteryStats } from '../utils.js';

export function algoStat({ data, gameDef }) {
    const stats = data.length > 0 ? getLotteryStats(data, gameDef.range, gameDef.count) : null;
    const pickZone1 = calculateZone(data, gameDef.range, gameDef.count, false, 'stat', [], {}, stats);
    let pickZone2 = [];
    if (gameDef.type === 'power') pickZone2 = calculateZone(data, gameDef.zone2, 1, true, 'stat_missing', [], {}, stats);
    const nums = [...pickZone1, ...pickZone2];
    const hotCount = nums.filter(n => n.tag.includes('近')).length;
    const coldCount = nums.filter(n => n.tag.includes('遺漏') || n.tag.includes('回補')).length;
    return { 
        numbers: nums, 
        groupReason: `🔥 熱力分析：熱號 ${hotCount} : 冷號 ${coldCount}。<br>本組採「順勢而為」策略，鎖定近期高頻區，搭配 ${coldCount} 顆極限冷號回補。`
    };
}
