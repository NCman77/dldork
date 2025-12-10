/**
 * algo_smartwheel.js
 * 聰明包牌模組 (Phase 6 最終版)
 * 核心邏輯：雙軌策略 (標準/強勢 vs 彈性/隨機)
 */

export function algoSmartWheel(data, gameDef, pool, packMode = 'pack_1') {
    let results = [];
    
    if (!Array.isArray(pool) || pool.length === 0) {
        return [];
    }

    // ==========================================
    // 1. 威力彩 (Power)
    // ==========================================
    if (gameDef.type === 'power') {
        // [策略 A] 二區包牌 (pack_1): 鎖定最強 6 碼
        if (packMode === 'pack_1') {
            const zone1 = pool.slice(0, 6).sort((a, b) => a - b);
            if (zone1.length < 6) return []; 

            for (let i = 1; i <= 8; i++) {
                results.push({
                    numbers: [...zone1, i],
                    groupReason: `二區包牌 (0${i}) - 第一區鎖定`
                });
            }
        } 
        // [策略 B] 彈性包牌 (pack_2): 區段輪轉 (Segment Rotation)
        // 避免滑動視窗造成的重疊，改用跳躍組合
        else {
            // 將 Pool 分為 4 個區段 (每段 3 碼，共 12 碼)
            // 如果 Pool 不足 12 碼，循環補足
            const extendedPool = [...pool, ...pool].slice(0, 12);
            const segA = extendedPool.slice(0, 3);
            const segB = extendedPool.slice(3, 6);
            const segC = extendedPool.slice(6, 9);
            const segD = extendedPool.slice(9, 12);

            // 產生 8 種不同的組合 (A+B, C+D, A+C...)
            const combos = [
                [...segA, ...segB], // 1
                [...segC, ...segD], // 2
                [...segA, ...segC], // 3
                [...segB, ...segD], // 4
                [...segA, ...segD], // 5
                [...segB, ...segC], // 6
                // 混合跳躍
                [segA[0], segB[1], segC[2], segD[0], segA[1], segB[2]], // 7
                [segC[0], segD[1], segA[2], segB[0], segC[1], segD[2]]  // 8
            ];

            for (let i = 0; i < 8; i++) {
                const set = combos[i % combos.length].sort((a,b)=>a-b);
                results.push({
                    numbers: [...set, i + 1],
                    groupReason: `彈性輪轉包牌 (0${i+1}) - 區段跳躍`
                });
            }
        }
    } 
    // ==========================================
    // 2. 數字型 (3星/4星)
    // ==========================================
    else if (gameDef.type === 'digit') {
        const count = gameDef.count;
        const bestNums = pool.slice(0, count); // 這裡的 pool 已經是位數最佳解 (5,8,3)
        
        if (bestNums.length < count) return []; 

        // [策略 A] 強勢包牌 (pack_1): 複式排列 (Permutation)
        // 鎖定最強的號碼，買光排列
        if (packMode === 'pack_1') {
            if (count === 3) {
                const perms = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
                perms.forEach(p => {
                    const set = [bestNums[p[0]], bestNums[p[1]], bestNums[p[2]]];
                    results.push({
                        numbers: set,
                        groupReason: `正彩複式 - 鎖定排列`
                    });
                });
            } else {
                // 4星彩循環移位
                for(let i=0; i<5; i++) {
                    const set = [...bestNums];
                    const shift = set.splice(0, i % 4);
                    set.push(...shift);
                    results.push({
                        numbers: set,
                        groupReason: `正彩複式 - 循環排列`
                    });
                }
            }
        }
        // [策略 B] 彈性包牌 (pack_2): 分組取號 (Chunking)
        // 每一注都拿完全不同的號碼，不重疊
        else {
            const targetCount = 5; 
            for (let i = 0; i < targetCount; i++) {
                const set = [];
                for (let k = 0; k < count; k++) {
                    // 直接從 Pool 中依序抓取，確保不重複
                    // Pool 來自 app.js 收集的 Set1, Set2, Set3...
                    const idx = (i * count + k) % pool.length;
                    set.push(pool[idx]);
                }
                // 數字型絕對不排序
                results.push({
                    numbers: set,
                    groupReason: `彈性分組 - 組合 ${i+1}`
                });
            }
        }
    } 
    // ==========================================
    // 3. 樂透型 (大樂透/539)
    // ==========================================
    else {
        const targetCount = 5; 
        for (let k = 0; k < targetCount; k++) {
            // Fisher-Yates 洗牌
            const shuffled = [...pool];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const set = shuffled.slice(0, gameDef.count).sort((a, b) => a - b);
            
            results.push({
                numbers: set,
                groupReason: `聰明包牌 - 優選組合`
            });
        }
    }

    return results;
}
