/**
 * algo_smartwheel.js
 * 聰明包牌模組 (Bridge Mode)
 * 核心邏輯：接收外部傳入的「強號池 (Pool)」，執行對應玩法的包牌拆解。
 * 不再自行計算號碼，實現「學派包牌」的靈活性。
 */

export function algoSmartWheel(data, gameDef, pool) {
    let results = [];
    
    // 防呆：確保 pool 存在且為陣列
    if (!Array.isArray(pool) || pool.length === 0) {
        return [];
    }

    // 1. 威力彩 (Power)
    // 策略：拿 Pool 的前 6 碼當第一區，第二區全包 (1~8)
    if (gameDef.type === 'power') {
        // 確保第一區有 6 個號碼
        const zone1 = pool.slice(0, 6).sort((a, b) => a - b);
        
        // 產生 8 注 (第二區 01~08)
        for (let i = 1; i <= 8; i++) {
            results.push({
                numbers: [...zone1, i],
                groupReason: `💡 第二區全包保底 (0${i}) - 搭配前${zone1.length}強號`
            });
        }
    } 
    // 2. 數字型 (3星/4星)
    // 策略：複式排列 (拿 Pool 的前 3 或 4 碼進行所有排列組合)
    else if (gameDef.type === 'digit') {
        const count = gameDef.count;
        const bestNums = pool.slice(0, count);
        
        if (bestNums.length < count) return []; // 號碼不夠

        // 簡單排列 (Permutation) - 這裡示範 3星彩常用的 6 組排列
        // 如果是 4 星彩，全排列會有 24 組，這裡簡化處理：只做隨機排列或基本排列
        // 為了避免過多注數，我們產生 3~6 組具代表性的
        
        if (count === 3) {
            const perms = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
            perms.forEach(p => {
                const set = [bestNums[p[0]], bestNums[p[1]], bestNums[p[2]]];
                results.push({
                    numbers: set,
                    groupReason: `💡 正彩複式 - 強號 ${bestNums.join(',')} 排列`
                });
            });
        } else {
            // 4星彩簡單做 5 組循環移位
            for(let i=0; i<5; i++) {
                // 簡單的循環移位邏輯
                const set = [...bestNums];
                const shift = set.splice(0, i % 4);
                set.push(...shift);
                results.push({
                    numbers: set,
                    groupReason: `💡 正彩複式 - 循環排列組合`
                });
            }
        }
    } 
    // 3. 樂透型 (大樂透/539)
    // 策略：旋轉矩陣 / 隨機組合 (從 10 碼 Pool 中取 C10取N)
    else {
        // 我們的目標是產生約 3~5 注精選
        // 這裡採用「隨機選取」策略，但範圍限定在 Pool (10碼) 內
        // 這比完全隨機準確，因為 Pool 已經是學派篩選過的精華
        
        const targetCount = 5; // 預設產出 5 注包牌結果
        for (let k = 0; k < targetCount; k++) {
            // 從 Pool 中隨機抓取 count 個號碼
            const shuffled = [...pool].sort(() => 0.5 - Math.random());
            const set = shuffled.slice(0, gameDef.count).sort((a, b) => a - b);
            
            results.push({
                numbers: set,
                groupReason: `💡 聰明包牌 - 從 ${pool.length} 碼強號池中優選`
            });
        }
    }

    return results;
}
