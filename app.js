/**
 * app.js
 * 核心邏輯層：負責資料處理、演算法運算、DOM 渲染與事件綁定
 * V25.16: [FIX] 調整執行順序：優先更新畫面 (Render First)，後執行儲存，確保顯示無誤
 */
import { GAME_CONFIG } from './game_config.js';
// [Scheme B] 現在 utils.js 提供所有功能，直接匯入
import { 
    getGanZhi, monteCarloSim, calculateZone, 
    fetchAndParseZip, mergeLotteryData, fetchLiveLotteryData, 
    saveToCache, saveToFirestore, loadFromFirestore, loadFromCache 
} from './utils.js';

import { algoStat } from './algo/algo_stat.js';
import { algoPattern } from './algo/algo_pattern.js';
import { algoBalance } from './algo/algo_balance.js';
import { algoAI } from './algo/algo_ai.js';
import { algoSmartWheel } from './algo/algo_smartwheel.js';

import { applyZiweiLogic } from './algo/algo_Ziwei.js';
import { applyNameLogic } from './algo/algo_name.js';
import { applyStarsignLogic } from './algo/algo_starsign.js';
import { applyWuxingLogic } from './algo/algo_wuxing.js';

// 動態產生 ZIP URL (只到當下年份)
const currentYear = new Date().getFullYear();
const zipUrls = [];
for (let y = 2021; y <= currentYear; y++) {
    zipUrls.push(`data/${y}.zip`);
}

const CONFIG = {
    JSON_URL: 'data/lottery-data.json',
    ZIP_URLS: zipUrls
};

const App = {
    state: {
        rawData: {}, rawJackpots: {}, 
        currentGame: "", currentSubMode: null,
        currentSchool: "balance",
        filterPeriod: "", filterYear: "", filterMonth: "",
        profiles: [], user: null, db: null, apiKey: "",
        drawOrder: 'appear' // 'appear' (開出順序) 或 'size' (大小順序)
    },

    init() {
        this.initFirebase();
        this.selectSchool('balance');
        this.populateYearSelect();
        this.populateMonthSelect();
        
        // 啟動資料載入
        this.initFetch();
        this.bindEvents();
    },

    bindEvents() {
        const periodInput = document.getElementById('search-period');
        if (periodInput) {
            periodInput.addEventListener('input', (e) => { this.state.filterPeriod = e.target.value.trim(); this.updateDashboard(); });
        }
        document.getElementById('search-year').addEventListener('change', (e) => { this.state.filterYear = e.target.value; this.updateDashboard(); });
        document.getElementById('search-month').addEventListener('change', (e) => { this.state.filterMonth = e.target.value; this.updateDashboard(); });
    },

    // --- Firebase Logic ---
    async initFirebase() {
        if (typeof window.firebaseModules === 'undefined') { this.loadProfilesLocal(); return; }
        const { initializeApp, getAuth, onAuthStateChanged, getFirestore, getDoc, doc } = window.firebaseModules;
        const firebaseConfig = { apiKey: "AIzaSyBatltfrvZ5AXixdZBcruClqYrA-9ihsI0", authDomain: "lottery-app-bd106.firebaseapp.com", projectId: "lottery-app-bd106", storageBucket: "lottery-app-bd106.firebasestorage.app", messagingSenderId: "13138331714", appId: "1:13138331714:web:194ac3ff9513d19d9845db" };
        
        try { 
            const app = initializeApp(firebaseConfig); 
            const auth = getAuth(app); 
            this.state.db = getFirestore(app); 
            
            onAuthStateChanged(auth, async (user) => { 
                this.state.user = user; 
                this.updateAuthUI(user); 
                if (user) { 
                    await this.loadProfilesCloud(user.uid); 
                    // 讀取 API Key
                    const ref = doc(this.state.db, 'artifacts', 'lottery-app', 'users', user.uid, 'settings', 'api'); 
                    try {
                        const snap = await getDoc(ref); 
                        if(snap.exists()) { this.state.apiKey = snap.data().key; document.getElementById('gemini-api-key').value = this.state.apiKey; } 
                    } catch (e) { console.warn("Firebase Read Error (Storage blocked?):", e); }
                } else { 
                    this.loadProfilesLocal(); 
                } 
            }); 
        } catch(e) { console.error("Firebase Init Error:", e); this.loadProfilesLocal(); }
    },
    updateAuthUI(user) {
        const loginBtn = document.getElementById('btn-login'); const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name'); const dot = document.getElementById('login-status-dot');
        if (user) {
            loginBtn.classList.add('hidden'); userInfo.classList.remove('hidden');
            userName.innerText = `Hi, ${user.displayName}`;
            dot.classList.remove('bg-stone-300'); dot.classList.add('bg-green-500');
        } else {
            loginBtn.classList.remove('hidden'); userInfo.classList.add('hidden');
            dot.classList.remove('bg-green-500'); dot.classList.add('bg-stone-300');
        }
    },
    async loginGoogle() { 
        try {
            const { getAuth, signInWithPopup, GoogleAuthProvider } = window.firebaseModules; 
            await signInWithPopup(getAuth(), new GoogleAuthProvider()); 
        } catch (e) { alert("登入失敗：可能是瀏覽器阻擋了第三方 Cookies"); console.error(e); }
    },
    async logoutGoogle() { await window.firebaseModules.signOut(window.firebaseModules.getAuth()); this.state.profiles = []; this.loadProfilesLocal(); },
    async loadProfilesCloud(uid) { 
        try {
            const { doc, getDoc } = window.firebaseModules; 
            const ref = doc(this.state.db, 'artifacts', 'lottery-app', 'users', uid, 'profiles', 'main'); 
            const snap = await getDoc(ref); 
            this.state.profiles = snap.exists() ? snap.data().list || [] : []; 
            this.renderProfileSelect(); this.renderProfileList(); 
        } catch(e) { console.warn("Load Cloud Profiles Failed:", e); }
    },
    async saveProfilesCloud() { 
        try {
            const { doc, setDoc } = window.firebaseModules; 
            const ref = doc(this.state.db, 'artifacts', 'lottery-app', 'users', this.state.user.uid, 'profiles', 'main'); 
            await setDoc(ref, { list: this.state.profiles }); 
        } catch(e) { console.warn("Save Cloud Profiles Failed:", e); }
    },
    loadProfilesLocal() { 
        try {
            const stored = localStorage.getItem('lottery_profiles'); 
            if (stored) this.state.profiles = JSON.parse(stored); 
        } catch (e) { console.warn("Local Storage Read Blocked"); }
        this.renderProfileSelect(); this.renderProfileList(); 
    },
    saveProfiles() { 
        if (this.state.user) this.saveProfilesCloud(); 
        try {
            localStorage.setItem('lottery_profiles', JSON.stringify(this.state.profiles)); 
        } catch (e) { console.warn("Local Storage Write Blocked"); }
        this.renderProfileSelect(); this.renderProfileList(); 
    },
    async saveApiKey() { 
        const key = document.getElementById('gemini-api-key').value.trim(); 
        if(!key) return alert("請輸入 Key"); 
        this.state.apiKey = key; 
        if(this.state.user){ 
            try {
                const { doc, setDoc } = window.firebaseModules; 
                await setDoc(doc(this.state.db, 'artifacts', 'lottery-app', 'users', this.state.user.uid, 'settings', 'api'), {key}); 
            } catch(e) { console.warn("Firebase save key failed", e); }
        } else { 
            try { localStorage.setItem('gemini_key', key); } catch(e){ console.warn("Local storage save key failed"); } 
        } 
        alert("已儲存"); 
    },
    addProfile() { const name = document.getElementById('new-name').value.trim(); if(!name) return; this.state.profiles.push({ id: Date.now(), name, realname: document.getElementById('new-realname').value, ziwei: document.getElementById('new-ziwei').value, astro: document.getElementById('new-astro').value }); this.saveProfiles(); this.toggleProfileModal(); },
    deleteProfile(id) { if(confirm('刪除?')) { this.state.profiles = this.state.profiles.filter(p => p.id !== id); this.saveProfiles(); } },
    toggleProfileModal() { const m = document.getElementById('profile-modal'); const c = document.getElementById('profile-modal-content'); if(m.classList.contains('hidden')){ m.classList.remove('hidden'); setTimeout(()=>c.classList.remove('scale-95','opacity-0'),10); }else{ c.classList.add('scale-95','opacity-0'); setTimeout(()=>m.classList.add('hidden'),200); } },
    renderProfileList() { document.getElementById('profile-list').innerHTML = this.state.profiles.map(p=>`<div class="flex justify-between p-2 bg-stone-50 border rounded"><div class="font-bold text-stone-700 text-xs">${p.name}</div><button onclick="app.deleteProfile(${p.id})" class="text-red-400 text-xs">刪除</button></div>`).join(''); },
    renderProfileSelect() { document.getElementById('profile-select').innerHTML = '<option value="">請新增...</option>'+this.state.profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join(''); },
    deleteCurrentProfile() { const pid = document.getElementById('profile-select').value; if(pid && confirm('刪除?')) { this.deleteProfile(Number(pid)); document.getElementById('profile-select').value=""; this.onProfileChange(); } },
    
    // --- AI Fortune Logic ---
    async generateAIFortune() { 
        const pid = document.getElementById('profile-select').value; 
        if(!pid||!this.state.apiKey) return alert("請選主角並設定Key"); 
        document.getElementById('ai-loading').classList.remove('hidden'); 
        document.getElementById('btn-calc-ai').disabled=true; 
        const p = this.state.profiles.find(x=>x.id==pid); 
        const currentYear = new Date().getFullYear();
        const ganZhi = getGanZhi(currentYear);
        const useName = document.getElementById('check-name') ? document.getElementById('check-name').checked : false;

        let prompt = `你現在是資深的國學易經術數領域專家...`; 
        if (useName) { prompt += `【姓名學特別指令】...`; }
        prompt += `請務必回傳純 JSON 格式...`; 

        try{ 
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${this.state.apiKey}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})}); 
            const d=await res.json(); 
            p.fortune2025=JSON.parse(d.candidates[0].content.parts[0].text.replace(/```json|```/g,'').trim()); 
            this.saveProfiles(); 
            this.onProfileChange(); 
        }catch(e){alert("AI 分析失敗"); console.error(e);}finally{document.getElementById('ai-loading').classList.add('hidden');document.getElementById('btn-calc-ai').disabled=false;} 
    },
    onProfileChange() { 
        const pid = document.getElementById('profile-select').value; 
        const s = document.getElementById('ai-fortune-section'); 
        if(!pid){s.classList.add('hidden');return;} 
        s.classList.remove('hidden'); 
        const p=this.state.profiles.find(x=>x.id==pid); 
        const d=document.getElementById('ai-result-display'); 
        if(p&&p.fortune2025){ 
            d.classList.remove('hidden'); 
            let html = `<div class="font-bold mb-1">📅 流年運勢:</div><p>${p.fortune2025.year_analysis}</p>`;
            if(p.fortune2025.name_analysis) html += `<div class="mt-2 pt-2 border-t border-pink-100"><div class="font-bold mb-1">✍️ 姓名靈動:</div><p class="text-[10px]">${p.fortune2025.name_analysis.rationale}</p></div>`;
            d.innerHTML = html;
            document.getElementById('btn-calc-ai').innerText="🔄 重新批算"; 
            document.getElementById('btn-clear-ai').classList.remove('hidden'); 
        }else{ 
            d.classList.add('hidden'); 
            document.getElementById('btn-calc-ai').innerText="✨ 大師批流年"; 
            document.getElementById('btn-clear-ai').classList.add('hidden'); 
        } 
    },
    clearFortune() { const pid=document.getElementById('profile-select').value; const p=this.state.profiles.find(x=>x.id==pid); if(p){delete p.fortune2025; this.saveProfiles(); this.onProfileChange();} },

    // --- Core Data Logic (Progressive Rendering + Sync) ---
    async initFetch() {
        // [FIX] 設定初始狀態：黃燈 (連線更新中)
        this.setSystemStatus('loading');

        try {
            // [Phase 1] 秒開：讀取靜態資源 & Firestore
            const jsonRes = await fetch(`${CONFIG.JSON_URL}?t=${new Date().getTime()}`);
            let baseData = {};
            if (jsonRes.ok) {
                const jsonData = await jsonRes.json();
                baseData = jsonData.games || jsonData;
                this.state.rawJackpots = jsonData.jackpots || {};
                if(jsonData.last_updated) document.getElementById('last-update-time').innerText = jsonData.last_updated.split(' ')[0];
            }

            const zipPromises = CONFIG.ZIP_URLS.map(url => fetchAndParseZip(url));
            const zipResults = await Promise.all(zipPromises);

            // 讀取 LocalStorage 與 Firestore
            const localCache = loadFromCache()?.data || {};
            let firestoreData = {};
            if (this.state.db) { firestoreData = await loadFromFirestore(this.state.db); }

            // 第一次合併與渲染
            const initialData = mergeLotteryData({ games: baseData }, zipResults, localCache, firestoreData);
            this.processAndRender(initialData);

            // [Phase 2] 背景執行：抓取 Live Data (不阻塞畫面)
            console.log("🚀 [System] 背景啟動 Live API 抓取...");
            
            const liveData = await fetchLiveLotteryData();

            // [Phase 3] 熱更新
            if (liveData && Object.keys(liveData).length > 0) {
                console.log("🚀 [System] Live Data 抓取成功，更新介面...");
                
                // [FIX V25.16] 關鍵修正：優先執行 UI 渲染 (UI First)
                // 先將畫面更新，確保使用者看到號碼
                const finalData = mergeLotteryData({ games: baseData }, zipResults, liveData, firestoreData);
                this.processAndRender(finalData);

                // [FIX V25.16] 後執行儲存 (Fire-and-forget)
                // 這樣即使權限錯誤崩潰，也不會影響已經更新的畫面
                try {
                    saveToCache(liveData); 
                } catch (e) {
                    console.warn("⚠️ Local Cache 寫入失敗 (隱私模式或權限受限):", e);
                }
                
                if (this.state.db) { 
                    try {
                        await saveToFirestore(this.state.db, liveData); 
                    } catch (e) {
                        console.warn("⚠️ Firestore 寫入失敗 (權限受限):", e);
                    }
                }
            }

            // [Phase 4] 最終狀態檢查 (嚴格紅綠燈)
            this.checkSystemStatus();

        } catch(e) { 
            console.error("Critical Data Error:", e);
            // 發生錯誤也強制檢查狀態 (會變成紅燈)
            this.checkSystemStatus(); 
            this.renderGameButtons(); 
        } 
    },

    processAndRender(mergedData) {
        this.state.rawData = mergedData.games || {};
        // 確保日期是 Date 物件
        for (let game in this.state.rawData) { 
            this.state.rawData[game] = this.state.rawData[game].map(item => ({...item, date: new Date(item.date)})); 
        }
        this.renderGameButtons();
    },

    setSystemStatus(status, dateStr = "") {
        const text = document.getElementById('system-status-text');
        const icon = document.getElementById('system-status-icon');
        if (status === 'loading') {
            text.innerText = "連線更新中...";
            text.className = "text-yellow-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-yellow-500 animate-pulse";
        } else if (status === 'success') {
            text.innerText = "系統連線正常";
            text.className = "text-green-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-green-500";
        } else {
            text.innerText = `資料過期 ${dateStr ? `(${dateStr})` : ""}`;
            text.className = "text-red-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-red-500";
        }
    },

    checkSystemStatus() {
        let hasLatestData = false;
        let latestDateObj = null;
        const today = new Date();
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(today.getDate() - 3); // 定義過期標準：3天
        
        // 檢查任意遊戲是否有近三天的資料
        for (let game in this.state.rawData) {
            if (this.state.rawData[game].length > 0) {
                const lastDate = this.state.rawData[game][0].date;
                if (!latestDateObj || lastDate > latestDateObj) {
                    latestDateObj = lastDate;
                }
                if (lastDate >= threeDaysAgo) {
                    hasLatestData = true;
                }
            }
        }

        const dataCount = Object.values(this.state.rawData).reduce((acc, curr) => acc + curr.length, 0);
        const dateStr = latestDateObj ? latestDateObj.toLocaleDateString() : "無資料";

        // [FIX] 嚴格判斷：如果資料過期，強制顯示紅燈
        if (dataCount === 0 || !hasLatestData) {
            this.setSystemStatus('error', dateStr);
        } else {
            this.setSystemStatus('success');
        }
    },

    renderGameButtons() { const container = document.getElementById('game-btn-container'); container.innerHTML = ''; GAME_CONFIG.ORDER.forEach(gameName => { const btn = document.createElement('div'); btn.className = `game-tab-btn ${gameName === this.state.currentGame ? 'active' : ''}`; btn.innerText = gameName; btn.onclick = () => { this.state.currentGame = gameName; this.state.currentSubMode = null; this.resetFilter(); document.querySelectorAll('.game-tab-btn').forEach(el => el.classList.remove('active')); btn.classList.add('active'); this.updateDashboard(); }; container.appendChild(btn); }); if (!this.state.currentGame && GAME_CONFIG.ORDER.length > 0) { this.state.currentGame = GAME_CONFIG.ORDER[0]; container.querySelector('.game-tab-btn')?.classList.add('active'); this.updateDashboard(); } },
    updateDashboard() { const gameName = this.state.currentGame; const gameDef = GAME_CONFIG.GAMES[gameName]; let data = this.state.rawData[gameName] || []; if (this.state.filterPeriod) data = data.filter(item => String(item.period).includes(this.state.filterPeriod)); if (this.state.filterYear) data = data.filter(item => item.date.getFullYear() === parseInt(this.state.filterYear)); if (this.state.filterMonth) data = data.filter(item => (item.date.getMonth() + 1) === parseInt(this.state.filterMonth)); document.getElementById('current-game-title').innerText = gameName; document.getElementById('total-count').innerText = data.length; document.getElementById('latest-period').innerText = data.length > 0 ? `${data[0].period}期` : "--期"; const jackpotContainer = document.getElementById('jackpot-container'); if (this.state.rawJackpots[gameName] && !this.state.filterPeriod) { jackpotContainer.classList.remove('hidden'); document.getElementById('jackpot-amount').innerText = `$${this.state.rawJackpots[gameName]}`; } else { jackpotContainer.classList.add('hidden'); } this.renderSubModeUI(gameDef); this.renderHotStats('stat-year', data); this.renderHotStats('stat-month', data.slice(0, 30)); this.renderHotStats('stat-recent', data.slice(0, 10)); document.getElementById('no-result-msg').classList.toggle('hidden', data.length > 0); 
    
        // [NEW] 渲染順序切換按鈕
        this.renderDrawOrderControls(); 

        this.renderHistoryList(data.slice(0, 5)); 
    },

    // [NEW] 渲染大小順序/開出順序的控制按鈕
    renderDrawOrderControls() {
        const container = document.getElementById('draw-order-controls');
        if (!container) return;
        
        container.classList.remove('hidden'); // 預設顯示

        container.innerHTML = `
            <span class="text-[10px] text-stone-400 font-bold mr-2">顯示順序:</span>
            <button onclick="app.setDrawOrder('appear')" class="order-btn ${this.state.drawOrder === 'appear' ? 'active' : ''}">開出順序</button>
            <button onclick="app.setDrawOrder('size')" class="order-btn ${this.state.drawOrder === 'size' ? 'active' : ''}">大小順序</button>
        `;
        // 確保 CSS 樣式存在 (這裡使用 Tailwind 類別模擬)
        if (!document.getElementById('order-btn-style')) {
             document.head.insertAdjacentHTML('beforeend', `
            <style id="order-btn-style">
                .order-btn {
                    padding: 2px 8px; font-size: 10px; border-radius: 9999px; border: 1px solid #d6d3d1; color: #57534e; transition: all 150ms;
                }
                .order-btn.active {
                    background-color: #10b981; border-color: #10b981; color: white; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }
            </style>
        `);
        }
    },

    // [NEW] 設定顯示順序
    setDrawOrder(order) {
        if (this.state.drawOrder === order) return;
        this.state.drawOrder = order;
        this.renderDrawOrderControls(); // 刷新按鈕狀態
        this.updateDashboard(); // 刷新歷史列表
    },

    renderSubModeUI(gameDef) { const area = document.getElementById('submode-area'); const container = document.getElementById('submode-tabs'); const rulesContent = document.getElementById('game-rules-content'); rulesContent.classList.add('hidden'); if (gameDef.subModes) { area.classList.remove('hidden'); container.innerHTML = ''; if (!this.state.currentSubMode) this.state.currentSubMode = gameDef.subModes[0].id; gameDef.subModes.forEach(mode => { const tab = document.createElement('div'); tab.className = `submode-tab ${this.state.currentSubMode === mode.id ? 'active' : ''}`; tab.innerText = mode.name; tab.onclick = () => { this.state.currentSubMode = mode.id; document.querySelectorAll('.submode-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); }; container.appendChild(tab); }); rulesContent.innerHTML = gameDef.article || "暫無說明"; } else { area.classList.add('hidden'); this.state.currentSubMode = null; } },
    toggleRules() { document.getElementById('game-rules-content').classList.toggle('hidden'); },
    renderHistoryList(data) { 
        const list = document.getElementById('history-list'); 
        list.innerHTML = ''; 
        data.forEach(item => { 
            let numsHtml = ""; 
            const gameDef = GAME_CONFIG.GAMES[this.state.currentGame]; 
            
            // [FIXED] 根據 drawOrder 選擇要顯示的號碼列表
            const sourceNumbers = this.state.drawOrder === 'size' && item.numbers_size && item.numbers_size.length > 0
                                ? item.numbers_size // 大小順序
                                : item.numbers || []; // 開出順序 (numbers 預設為開出順序)

            const numbers = sourceNumbers.filter(n => typeof n === 'number');
            
            if (gameDef.type === 'digit') { 
                numsHtml = numbers.map(n => `<span class="ball-sm">${n}</span>`).join(''); 
            } else { 
                const len = numbers.length; 
                let normal = [], special = null; 
                
                // 修正大樂透/威力彩的特別號分離邏輯
                if ((gameDef.type === 'power' || gameDef.special) && len > gameDef.count) { 
                    special = numbers[len-1]; 
                    normal = numbers.slice(0, len-1); 
                } else { 
                    normal = numbers; 
                } 
                
                numsHtml = normal.filter(n => typeof n === 'number').map(n => `<span class="ball-sm">${n}</span>`).join(''); 
                if (special !== null && typeof special === 'number') {
                    numsHtml += `<span class="ball-sm ball-special ml-2 font-black border-none">${special}</span>`;
                }
            } 
            list.innerHTML += `<tr class="table-row"><td class="px-5 py-3 border-b border-stone-100"><div class="font-bold text-stone-700">No. ${item.period}</div><div class="text-[10px] text-stone-400">${item.date.toLocaleDateString()}</div></td><td class="px-5 py-3 border-b border-stone-100 flex flex-wrap gap-1">${numsHtml}</td></tr>`; 
        }); 
    },
    renderHotStats(elId, dataset) { const el = document.getElementById(elId); if (!dataset || dataset.length === 0) { el.innerHTML = '<span class="text-stone-300 text-[10px]">無數據</span>'; return; } const freq = {}; dataset.forEach(d => d.numbers.forEach(n => freq[n] = (freq[n]||0)+1)); const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, 5); el.innerHTML = sorted.map(([n, c]) => `<div class="flex flex-col items-center"><div class="ball ball-hot mb-1 scale-75">${n}</div><div class="text-sm text-stone-600 font-black">${c}</div></div>`).join(''); },
    selectSchool(school) { this.state.currentSchool = school; const info = GAME_CONFIG.SCHOOLS[school]; document.querySelectorAll('.school-card').forEach(el => { el.classList.remove('active'); Object.values(GAME_CONFIG.SCHOOLS).forEach(s => { if(s.color) el.classList.remove(s.color); }); }); const activeCard = document.querySelector(`.school-${school}`); if(activeCard) { activeCard.classList.add('active'); activeCard.classList.add(info.color); } const container = document.getElementById('school-description'); container.className = `text-sm leading-relaxed text-stone-600 bg-stone-50 p-5 rounded-xl border-l-4 ${info.color}`; container.innerHTML = `<h4 class="base font-bold mb-3 text-stone-800">${info.title}</h4>${info.desc}`; document.getElementById('wuxing-options').classList.toggle('hidden', school !== 'wuxing'); },

    // 呼叫專家級演算法 (委託給 utils)
    runPrediction() {
        const gameName = this.state.currentGame;
        const gameDef = GAME_CONFIG.GAMES[gameName];
        let data = this.state.rawData[gameName] || [];
        if(!gameDef) return;
        
        const countVal = document.querySelector('input[name="count"]:checked').value;
        const container = document.getElementById('prediction-output');
        container.innerHTML = '';
        document.getElementById('result-area').classList.remove('hidden');

        if (countVal === 'pack') { this.algoSmartWheel(data, gameDef); return; }

        const count = parseInt(countVal);
        const params = { data, gameDef, subModeId: this.state.currentSubMode };

        for(let i=0; i<count; i++) {
            let result = null;
            switch(this.state.currentSchool) {
                case 'stat': result = algoStat(params); break;
                case 'pattern': result = algoPattern(params); break;
                case 'balance': result = algoBalance(params); break;
                case 'ai': result = algoAI(params); break;
                case 'wuxing': result = this.algoWuxing(params); break; 
            }
            if (result) {
                if(!monteCarloSim(result.numbers, gameDef)) {
                   result = algoStat(params);
                }
                this.renderRow(result, i+1);
            }
        }
    },
    
    // 將五行邏輯整合回 runPrediction 
    algoWuxing({ gameDef }) {
        const wuxingWeights = {};
        const wuxingTagMap = {};
        for(let k=(gameDef.type==='digit'?0:1); k<=gameDef.range; k++) {
            wuxingWeights[k] = 10;
        }
        for(let k=(gameDef.type==='digit'?0:1); k<=gameDef.range; k++) {
             wuxingWeights[k] = 10;
             wuxingTagMap[k] = "基礎運數"; 
        }
        const pid = document.getElementById('profile-select').value;
        const profile = this.state.profiles.find(p => p.id == pid);
        applyZiweiLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        applyNameLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        applyStarsignLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        applyWuxingLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        const wuxingContext = { tagMap: wuxingTagMap };
        const pickZone1 = calculateZone([], gameDef.range, gameDef.count, false, 'wuxing', [], wuxingWeights, null, wuxingContext);
        let pickZone2 = [];
        if (gameDef.type === 'power') pickZone2 = calculateZone([], gameDef.zone2, 1, true, 'wuxing', [], wuxingWeights, null, wuxingContext);
        const tags = [...pickZone1, ...pickZone2].map(o => o.tag);
        const dominant = tags.sort((a,b) => tags.filter(v => v===a).length - tags.filter(v => v===b).length).pop();
        return { 
            numbers: [...pickZone1, ...pickZone2], 
            groupReason: `💡 流年格局：[${dominant}] 主導。`
        };
    },

    algoSmartWheel(data, gameDef) {
        const results = algoSmartWheel(data, gameDef);
        results.forEach((res, idx) => this.renderRow({numbers: res.numbers.map(n=>({val:n, tag:'包牌'})), groupReason: res.groupReason}, idx+1));
    },

    renderRow(resultObj, index) { const container = document.getElementById('prediction-output'); const colors = { stat: 'bg-stone-200 text-stone-700', pattern: 'bg-purple-100 text-purple-700', balance: 'bg-emerald-100 text-emerald-800', ai: 'bg-amber-100 text-amber-800', wuxing: 'bg-pink-100 text-pink-800' }; const colorClass = colors[this.state.currentSchool] || 'bg-stone-200'; let html = `<div class="flex flex-col gap-2 p-4 bg-white rounded-xl border border-stone-200 shadow-sm animate-fade-in hover:shadow-md transition"><div class="flex items-center gap-3"><span class="text-[10px] font-black text-stone-300 tracking-widest">SET ${index}</span><div class="flex flex-wrap gap-2">`; resultObj.numbers.forEach(item => { html += `<div class="flex flex-col items-center"><div class="ball-sm ${colorClass}" style="box-shadow: none;">${item.val}</div>${item.tag ? `<div class="reason-tag">${item.tag}</div>` : ''}</div>`; }); html += `</div></div>`; if (resultObj.groupReason) { html += `<div class="text-[10px] text-stone-500 font-medium bg-stone-50 px-2 py-1.5 rounded border border-stone-100 flex items-center gap-1"><span class="text-sm">💡</span> ${resultObj.groupReason}</div>`; } html += `</div>`; container.innerHTML += html; },
    populateYearSelect() { const yearSelect = document.getElementById('search-year'); const cy = new Date().getFullYear(); for (let y = 2021; y <= cy; y++) { const opt = document.createElement('option'); opt.value = y; opt.innerText = `${y}`; yearSelect.appendChild(opt); } },
    populateMonthSelect() { const monthSelect = document.getElementById('search-month'); for (let m = 1; m <= 12; m++) { const opt = document.createElement('option'); opt.value = m; opt.innerText = `${m} 月`; monthSelect.appendChild(opt); } },
    resetFilter() { this.state.filterPeriod = ""; this.state.filterYear = ""; this.state.filterMonth = ""; const pInput = document.getElementById('search-period'); if(pInput) pInput.value = ""; document.getElementById('search-year').value = ""; document.getElementById('search-month').value = ""; this.updateDashboard(); },
    toggleHistory() { const c = document.getElementById('history-container'); const a = document.getElementById('history-arrow'); const t = document.getElementById('history-toggle-text'); if (c.classList.contains('max-h-0')) { c.classList.remove('max-h-0'); c.classList.add('max-h-[1000px]'); a.classList.add('rotate-180'); t.innerText = "隱藏近 5 期"; } else { c.classList.add('max-h-0'); c.classList.remove('max-h-[1000px]'); a.classList.remove('rotate-180'); t.innerText = "顯示近 5 期"; } },
};

window.app = App;
window.onload = () => App.init();
