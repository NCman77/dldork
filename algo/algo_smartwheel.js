/**
 * algo_smartwheel.js
 * 聰明包牌模組 (Bridge Mode) - Phase 5 最終版
 * 核心邏輯：接收外部傳入的「強號池 (Pool)」與「模式 (packMode)」，執行雙軌策略。
 * * 支援模式：
 * 1. pack_1 (標準/二區/強勢)：鎖定強號，強調保底與排列。
 * 2. pack_2 (彈性/隨機)：滑動視窗或循環輪轉，強調覆蓋率與變化性。
 */

export function algoSmartWheel(data, gameDef, pool, packMode = 'pack_1') {
    let results = [];
    
    // 防呆：確保 pool 存在且為陣列
    if (!Array.isArray(pool) || pool.length === 0) {
        return [];
    }

    // ==========================================
    // 1. 威力彩 (Power) - 雙軌策略
    // ==========================================
    if (gameDef.type === 'power') {
        // [策略 A] 二區包牌 (pack_1): 鎖定最強 6 碼，第二區全包
        if (packMode === 'pack_1') {
            // 取前 6 碼固定
            const zone1 = pool.slice(0, 6).sort((a, b) => a - b);
            if (zone1.length < 6) return []; // 號碼不足

            for (let i = 1; i <= 8; i++) {
                results.push({
                    numbers: [...zone1, i],
                    groupReason: `二區全包保底 (0${i}) - 第一區鎖定強號`
                });
            }
        } 
        // [策略 B] 彈性包牌 (pack_2): 滑動視窗，第二區全包
        else {
            // 使用滑動視窗，產生 8 注不同的第一區
            // Pool 建議至少 10~12 碼，若不足則循環使用
            for (let i = 1; i <= 8; i++) {
                const set = [];
                for (let k = 0; k < 6; k++) {
                    // 滑動邏輯：(i + k) 位移
                    const idx = (i - 1 + k) % pool.length;
                    set.push(pool[idx]);
                }
                set.sort((a, b) => a - b);

                results.push({
                    numbers: [...set, i],
                    groupReason: `彈性滑動包牌 (0${i}) - 第一區動態組合`
                });
            }
        }
    } 
    // ==========================================
    // 2. 數字型 (3星/4星) - 雙軌策略
    // ==========================================
    else if (gameDef.type === 'digit') {
        const count = gameDef.count;
        const bestNums = pool.slice(0, count);
        
        if (bestNums.length < count) return []; 

        // [策略 A] 強勢包牌 (pack_1): 複式排列 (Permutation)
        // 鎖定最強的幾個號碼，買光它們的排列組合
        if (packMode === 'pack_1') {
            if (count === 3) {
                // 3星彩：6 組全排列
                const perms = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
                perms.forEach(p => {
                    const set = [bestNums[p[0]], bestNums[p[1]], bestNums[p[2]]];
                    results.push({
                        numbers: set,
                        groupReason: `正彩複式 - 強號 ${bestNums.join(',')} 鎖定排列`
                    });
                });
            } else {
                // 4星彩：5 組循環移位 (全排列 24 組太多，取精選)
                for(let i=0; i<5; i++) {
                    const set = [...bestNums];
                    const shift = set.splice(0, i % 4);
                    set.push(...shift);
                    results.push({
                        numbers: set,
                        groupReason: `正彩複式 - 強號循環排列`
                    });
                }
            }
        }
        // [策略 B] 彈性包牌 (pack_2): 循環輪轉 (Rotation)
        // 從 Pool 中輪流抓號碼，每一注的號碼組成都不一樣
        else {
            const targetCount = 5; // 產生 5 注
            for (let i = 0; i < targetCount; i++) {
                const set = [];
                for (let k = 0; k < count; k++) {
                    // 偏移取號
                    const idx = (i + k) % pool.length;
                    set.push(pool[idx]);
                }
                // 數字型不排序，保留位置特性
                results.push({
                    numbers: set,
                    groupReason: `強號池輪轉 - 組合 ${i+1}`
                });
            }
        }
    } 
    // ==========================================
    // 3. 樂透型 (大樂透/539) - 標準策略
    // ==========================================
    else {
        // 單一模式：從 Pool 中隨機優選 (因為大樂透沒有分區，標準包牌即為聰明組合)
        const targetCount = 5; 
        for (let k = 0; k < targetCount; k++) {
            // 使用 Fisher-Yates 洗牌從 Pool 中抓取
            const shuffled = [...pool];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const set = shuffled.slice(0, gameDef.count).sort((a, b) => a - b);
            
            results.push({
                numbers: set,
                groupReason: `聰明包牌 - 從 ${pool.length} 碼強號池中優選`
            });
        }
    }

    return results;
}
