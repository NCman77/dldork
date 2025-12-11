/**
 * algo_smartwheel.js
 * 聰明包牌模組 (Phase 6 最終版 - 修正版)
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

            for (let i = 1; i <= gameDef.zone2; i++) {
                results.push({
                    numbers: [...zone1, i],
                    groupReason: `二區包牌 (0${i}) - 第一區鎖定`
                });
            }
        } 
        // [策略 B] 彈性包牌 (pack_2): 區段輪轉 (Segment Rotation)
        else {
            // [修正] 檢查 Pool 長度，不足時回退到 pack_1
            if (pool.length < 8) {
                console.warn(`⚠️ Pool 不足 8 個號碼，彈性包牌回退到二區包牌`);
                const zone1 = pool.slice(0, 6).sort((a, b) => a - b);
                if (zone1.length < 6) return [];
                
                for (let i = 1; i <= gameDef.zone2; i++) {
                    results.push({
                        numbers: [...zone1, i],
                        groupReason: `二區包牌 (0${i}) - 第一區鎖定 (自動回退)`
                    });
                }
                return results;
            }
            
            // 將 Pool 分為 4 個區段 (每段 3 碼，共 12 碼)
            // [修正] 只在 Pool 充足時使用循環補足
            const extendedPool = pool.length >= 12 
                ? pool.slice(0, 12) 
                : [...pool, ...pool].slice(0, 12);
                
            const segA = extendedPool.slice(0, 3);
            const segB = extendedPool.slice(3, 6);
            const segC = extendedPool.slice(6, 9);
            const segD = extendedPool.slice(9, 12);

            // 產生 8 種不同的組合
            const combos = [
                [...segA, ...segB],
                [...segC, ...segD],
                [...segA, ...segC],
                [...segB, ...segD],
                [...segA, ...segD],
                [...segB, ...segC],
                [segA[0], segB[1], segC[2], segD[0], segA[1], segB[2]],
                [segC[0], segD[1], segA[2], segB[0], segC[1], segD[2]]
            ];

            for (let i = 0; i < gameDef.zone2; i++) {
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
        const bestNums = pool.slice(0, count);
        
        if (bestNums.length < count) return []; 

        // [策略 A] 強勢包牌 (pack_1): 複式排列
        if (packMode === 'pack_1') {
            if (count === 3) {
                // 3星彩：全排列 6 注
                const perms = [
                    [0,1,2], [0,2,1],
                    [1,0,2], [1,2,0],
                    [2,0,1], [2,1,0]
                ];
                perms.forEach(p => {
                    const set = [bestNums[p[0]], bestNums[p[1]], bestNums[p[2]]];
                    results.push({
                        numbers: set,
                        groupReason: `立柱包牌 - 全排列`
                    });
                });
            } else {
                // 4星彩：循環移位改為只產生 4 注（移除重複）
                for (let i = 0; i < 4; i++) {
                    const set = [...bestNums];
                    const shift = set.splice(0, i);
                    set.push(...shift);
                    results.push({
                        numbers: set,
                        groupReason: `循環輪轉 - 位移 ${i+1}`
                    });
                }
            }
        }
        // [策略 B] 彈性包牌 (pack_2): 位數輪轉 (Phase 6)
        else {
            // [修正] 檢查 pool 是否為位數獨立格式
            // 正常情況：pool 長度應該是 count * 5
            if (pool.length < count * 5) {
                console.warn(
                    `⚠️ ${gameDef.count}星彈性包牌需要至少 ${count * 5} 個號碼，當前只有 ${pool.length} 個`
                );
                console.warn(
                    `⚠️ 建議使用「強勢包牌」或檢查 algo_pattern 是否正確產生位數獨立的號碼`
                );
                
                // 回退策略：使用現有號碼生成不重複組合
                const targetCount = Math.min(5, Math.floor(pool.length / count));
                for (let i = 0; i < targetCount; i++) {
                    const set = [];
                    for (let k = 0; k < count; k++) {
                        // 使用跳躍式索引避免全部集中同一區段
                        const idx = (i + k * targetCount) % pool.length;
                        set.push(pool[idx]);
                    }
                    results.push({
                        numbers: set,
                        groupReason: `彈性包牌 - 跳躍組合 ${i+1}`
                    });
                }
            } else {
                // [理想狀態] Pool 格式正確，使用分段邏輯
                // pool = [P1 前5名, P2 前5名, P3 前5名, (P4 前5名)]
                const targetCount = 5;
                for (let i = 0; i < targetCount; i++) {
                    const set = [];
                    for (let k = 0; k < count; k++) {
                        const positionOffset = k * targetCount; // 每個位數一段
                        const idx = (positionOffset + i) % pool.length;
                        set.push(pool[idx]);
                    }
                    results.push({
                        numbers: set,
                        groupReason: `彈性包牌 - 位數輪轉 ${i+1}`
                    });
                }
            }
        }
    } 
    // ==========================================
    // 3. 樂透型 (大樂透 / 539)
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
                groupReason: `聰明包牌 - 隨機組合 ${k+1}`
            });
        }
    }

    return results;
}
