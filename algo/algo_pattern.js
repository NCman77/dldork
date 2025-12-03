/**
 * algo_pattern.js
 * 關聯學派：捕捉號碼間的拖牌效應、鄰號與尾數群聚
 */
// 修正引用路徑：utils.js 在上一層
import { calculateZone, getLotteryStats } from '../utils.js';
// 修正引用路徑：同層引用
import { algoStat } from './algo_stat.js';

export function algoPattern({ data, gameDef }) {
    if(data.length < 2) return algoStat({data, gameDef});
    const lastDraw = data[0].numbers;
    const stats = data.length > 0 ? getLotteryStats(data, gameDef.range, gameDef.count) : null;
    const pickZone1 = calculateZone(data, gameDef.range, gameDef.count, false, 'pattern', lastDraw, {}, stats);
    let pickZone2 = [];
    if (gameDef.type === 'power') pickZone2 = calculateZone(data, gameDef.zone2, 1, true, 'random');
    const nums = [...pickZone1, ...pickZone2];
    const dragCount = nums.filter(n => n.tag.includes('拖') || n.tag.includes('鄰') || n.tag.includes('連莊')).length;
    return { 
        numbers: nums, 
        groupReason: `🔗 版路分析：強烈連動局 (${dragCount}顆相關)。<br>高度符合上期 [${lastDraw.slice(0,3).join(',')}...] 之拖牌慣性，建議關注鄰號效應。` 
    };
}
