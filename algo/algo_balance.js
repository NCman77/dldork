/**
 * algo_balance.js
 * 平衡學派：基於 AC 值、黃金和值與結構平衡的選號邏輯
 */
// 修正引用路徑：utils.js 在上一層
import { calculateZone, getLotteryStats, calcAC } from '../utils.js';

export function algoBalance({ data, gameDef, subModeId }) {
    let bestSet = []; let bestReason = "";
    const stats = data.length > 0 ? getLotteryStats(data, gameDef.range, gameDef.count) : null;
    if (gameDef.type === 'digit' && subModeId === 'group') {
        while(true) {
            const set = calculateZone(data, 9, gameDef.count, true, 'balance_digit', [], {}, stats);
            const sum = set.reduce((a,b)=>a + b.val, 0);
            if (sum >= 10 && sum <= 20) { bestSet = set; bestReason = `⚖️ 結構分析：黃金和值 ${sum}。<br>數字總和落在機率最高的 10-20 區間，符合常態分佈曲線。`; break; }
        }
    } else {
        let maxAttempts = 100;
        while(maxAttempts-- > 0) {
            const set = calculateZone(data, gameDef.range, gameDef.count, false, 'balance', [], {}, stats);
            const vals = set.map(n=>n.val);
            const ac = calcAC(vals);
            const oddCount = vals.filter(n => n%2!==0).length;
            if (ac >= 4) { bestSet = set; bestReason = `⚖️ 結構分析：AC值 ${ac} | 奇偶比 ${oddCount}:${vals.length-oddCount}。<br>本組號碼複雜度高，結構平衡，有效規避無效的極端組合。`; break; }
        }
        if(bestSet.length === 0) bestSet = calculateZone(data, gameDef.range, gameDef.count, false, 'random', [], {}, stats);
        if (gameDef.type === 'power') { const z2 = calculateZone(data, gameDef.zone2, 1, true, 'random', [], {}, stats); bestSet = [...bestSet, ...z2]; }
    }
    return { numbers: bestSet, groupReason: bestReason || "結構平衡分析" };
}
