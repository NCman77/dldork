/**
 * game_config.js
 * 存放遊戲定義、規則文字、玩法選項等靜態資料
 * 包含：標準型(lotto)、雙區型(power)、數字型(digit) 的區分
 */

export const GAME_CONFIG = {
    // 遊戲定義
    GAMES: {
        '大樂透': {
            type: 'lotto', // 標準樂透型
            range: 49,
            count: 6,
            special: true, // 有特別號但邏輯上是從同一個池選
            desc: "在01~49中選取6個號碼，每週二、五開獎。",
            subModes: null
        },
        '威力彩': {
            type: 'power', // 雙區型 (最複雜)
            range: 38,     // 第一區 1-38
            count: 6,
            zone2: 8,      // 第二區 1-8
            desc: "第一區01~38選6個，第二區01~08選1個。",
            subModes: null
        },
        '今彩539': {
            type: 'lotto',
            range: 39,
            count: 5,
            special: false,
            desc: "01~39選5個，每週一至六開獎。",
            subModes: null
        },
        '3星彩': {
            type: 'digit', // 數字型
            range: 9,      // 0-9
            count: 3,
            desc: "從000~999中選號，分為正彩、組彩、對彩。",
            subModes: [
                { id: 'direct', name: '🔴 正彩', count: 3, rule: '需數字與位置完全對中' },
                { id: 'group', name: '🔵 組彩', count: 3, rule: '數字對中即可，不限位置' },
                { id: 'pair', name: '🟢 對彩', count: 2, rule: '僅需對中前兩碼或後兩碼' }
            ],
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">三星彩玩法規則</h5>
                    <div class="p-3 bg-white rounded border border-stone-200">
                        <strong class="block mb-1">1. 正彩 (Direct)</strong>
                        <p>數字與位置需完全相同。機率 1/1000。適合追求高賠率的玩家。</p>
                    </div>
                    <div class="p-3 bg-white rounded border border-stone-200">
                        <strong class="block mb-1">2. 組彩 (Group)</strong>
                        <p>三個數字相同即可，不限順序。例如開獎 123，買 321 也中獎。</p>
                    </div>
                    <div class="p-3 bg-white rounded border border-stone-200">
                        <strong class="block mb-1">3. 對彩 (Pair)</strong>
                        <p>只對前兩碼或後兩碼。機率 1/100。適合穩健型玩家。</p>
                    </div>
                    
                    <h5 class="font-bold text-stone-800 text-lg mt-4">💡 實戰攻略 (專家級)</h5>
                    <ul class="list-disc pl-5 space-y-2">
                        <li><strong>和值分析：</strong>最常見的和值為 13、14。建議鎖定 10~20 的「黃金和值區間」，涵蓋率約 70%。</li>
                        <li><strong>冷熱配比：</strong>不要全追熱號。建議 1 熱 + 2 溫 的組合最穩定。</li>
                        <li><strong>形態判斷：</strong>觀察近期是「對子 (AAB)」多還是「雜六 (ABC)」多，順勢操作。</li>
                    </ul>
                </div>
            `
        },
        '4星彩': {
            type: 'digit',
            range: 9,
            count: 4,
            desc: "從0000~9999中選號，分為正彩、組彩。",
            subModes: [
                { id: 'direct', name: '🔴 正彩', count: 4, rule: '需數字與位置完全對中' },
                { id: 'group', name: '🔵 組彩', count: 4, rule: '數字對中即可，不限位置' }
            ],
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">四星彩玩法規則</h5>
                    <p><strong>1. 正彩：</strong>四個數字與位置需完全相同。機率 1/10000。</p>
                    <p><strong>2. 組彩：</strong>四個數字相同即可，不限順序。含 24組彩(全異)、12組彩(一對)、6組彩(兩對)、4組彩(三同)。</p>
                </div>
            `
        }
    },
    ORDER: ['大樂透', '威力彩', '今彩539', '3星彩', '4星彩'],
    
    // 學派說明 (包含開合詳細資訊)
    SCHOOLS: {
        balance: { 
            color: "border-school-balance", 
            title: "結構平衡學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-balance block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">基於常態分佈理論。計算AC值(複雜度)與和值區間，排除全奇/全偶等極端組合，專攻機率最高的「黃金結構」。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-balance text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-balance">
                        <p>1. 試誤過濾法 (Trial & Error)：系統不直接選號，而是先隨機生成大量組合，再透過濾網篩選。</p>
                        <p>2. AC 值 (Arithmetic Complexity) 檢測：(針對樂透型) 計算號碼組中所有數字兩兩相減的「差值數」。程式碼設定門檻為 AC >= 4，確保選出的號碼結構夠複雜，避免簡單排列（如 01, 02, 03, 04, 05, 06）。</p>
                        <p>3. 黃金和值 (Golden Sum)：(針對 3星/4星 組彩) 計算數字總和，強制鎖定在 10 ~ 20 這個機率分佈最高的區間。</p>
                        <p>4. 屬性標記：分析每個號碼的數學屬性（大小、奇偶）。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">大號/奇數、小號/偶數：直接標示該號碼在平衡結構中的角色。<br>AC值 6 優化：(組合理由) 顯示該組牌的複雜度指標。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        stat: { 
            color: "border-school-stat", 
            title: "統計學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-stat block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">大數據慣性分析。加入「極限遺漏」回補機制，在熱號恆熱與冷號反彈間取得最佳期望值。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-stat text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-stat">
                        <p>1. 頻率累加演算法：遍歷歷史資料庫，計算每個號碼的出現次數。基礎權重 10，每出現一次 +10。</p>
                        <p>2. 遺漏值 (Missing Value) 追蹤：計算每個號碼距離上次開出已經過了多少期。</p>
                        <p>3. 卜瓦松檢定概念 (Poisson-inspired)：在程式碼中設定了具體的閥值（近30期出現 > 5 次判定為熱；遺漏 > 15 期判定為冷），模擬統計學上的顯著性檢定。</p>
                        <p>4. 極限回補機制 (Extreme Rebound)：(針對威力彩第二區) 強制給予隨機冷號極高權重 (500分)，模擬「賭冷門牌反彈」的策略。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">近30期8次：(熱號) 用具體數據證明其熱度。<br>遺漏24期：(冷號) 用具體數據證明其回補機率。<br>常態選號：(中性) 符合平均機率的號碼。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        pattern: { 
            color: "border-school-pattern", 
            title: "關聯學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-pattern block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">捕捉號碼間的隱形連結。分析上期獎號的「拖牌效應」與「尾數連動」，預測版路的下一個落點。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-pattern text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-pattern">
                        <p>1. 條件機率矩陣：鎖定「上一期 (Last Draw)」號碼作為種子。</p>
                        <p>2. 拖牌權重 (Drag Weight)：若某號碼是上一期的開獎號，權重 +20 (賭連莊)。</p>
                        <p>3. 鄰號效應 (Neighbor Effect)：若某號碼是上一期號碼的左右鄰居 (如上期開 05，則 04, 06 加分)，權重 +15。</p>
                        <p>4. 尾數群聚分析：分析號碼的個位數 (Mod 10)，判斷是否與上期尾數相同。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">連莊強勢：直指該號碼為上期重覆號。<br>05鄰號：明確指出是因為鄰近 05 而被選中。<br>3尾群聚：指出該號碼符合特定的尾數規律。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        ai: { 
            color: "border-school-ai", 
            title: "AI 學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-ai block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">時間序列加權運算。將開獎視為時間軸，距離現在越近的數據影響力越大。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-ai text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-ai">
                        <p>1. 時間衰減函數 (Time Decay)：只取近 10~20 期資料。權重公式為 20 - index (越近分數越高，越遠分數越低)，模擬神經網路對近期特徵的敏感度。</p>
                        <p>2. 歸一化評分 (Normalization)：將計算出的權重分數轉換為 0-100 的「動能/趨勢分」，讓使用者能直觀比較強弱。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">趨勢分98：直接量化該號碼在近期趨勢中的強度 (滿分100)。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        wuxing: {
            color: "border-school-wuxing",
            title: "五行生肖學派",
            desc: `
                <div>
                    <span class="font-bold text-school-wuxing block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">AI 命理轉譯引擎。不再使用通用公式，而是由 AI 擔任「雲端命理師」，解析您的紫微命盤與流年飛星，將玄學能量轉譯為數學權重。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-wuxing text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-wuxing">
                        <p>1. AI 命盤結構解析：系統讀取使用者 Profile 中的星曜分布，判斷命宮、財帛宮與田宅宮的先天強弱。</p>
                        <p>2. 流年飛星推演：自動抓取當下年份（如 2025 乙巳年），計算流年四化（祿、權、科、忌）對財位的引動。</p>
                        <p>3. 河圖洛書數值化：將「星曜屬性」（如武曲屬金、貪狼屬木）依據河圖洛書原理轉換為樂透選號。</p>
                        <p>4. 趨吉避凶權重：遇「化祿」給予極高權重，遇「化忌」則動態排除或視為「破財擋災」的特殊選號。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">武曲化祿：(正財星)<br>貪狼偏財：(機會財)<br>流年財星：(時間運)</p>
                        </div>
                    </div>
                </details>
            `
        }
    }
};
