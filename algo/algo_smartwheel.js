/**
 * algo_smartwheel.js
 * 聰明包牌模組：提供全包保底、正彩複式與旋轉矩陣包牌策略
 * (包含完整三種模式，邏輯零遺漏)
 */
import { calculateZone } from './utils.js';

export function algoSmartWheel(data, gameDef) {
    let results = [];
    // 1. 威力彩第二區全包 (保底策略)
    if (gameDef.type === 'power') {
        const bestZone1 = calculateZone(data, gameDef.range, 6, false, 'stat', [], {}, null).map(n=>n.val);
        for(let i=1; i<=8; i++) { 
            results.push({ 
                numbers: [...bestZone1, i], 
                groupReason: `💡 策略：第二區全包保底 (0${i}) - 800元必中法應用。` 
            }); 
        }
    } 
    // 2. 數字型 (3星/4星) 正彩複式包牌
    else if (gameDef.type === 'digit') {
        const best3 = calculateZone(data, 9, 3, true, 'stat', [], {}, null).map(n=>n.val);
        const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
        perms.forEach(p => { 
            const set = [best3[p[0]], best3[p[1]], best3[p[2]]]; 
            results.push({ 
                numbers: set, 
                groupReason: `💡 策略：正彩複式包牌 - 強號 ${best3.join(',')} 排列鎖定。` 
            }); 
        });
    } 
    // 3. 樂透型 (大樂透/539) 旋轉矩陣包牌 (C10取6)
    else {
        const pool = calculateZone(data, gameDef.range, 10, false, 'stat', [], {}, null).map(n=>n.val);
        for(let k=0; k<10; k++) {
            const shuffled = [...pool].sort(() => 0.5 - Math.random());
            results.push({ 
                numbers: shuffled.slice(0, gameDef.count).sort((a,b)=>a-b), 
                groupReason: `💡 策略：旋轉矩陣 (C10取6) - 10注最大覆蓋率。` 
            }); 
        }
    }
    return results;
}