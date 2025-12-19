/**
 * app.js
 * 核心邏輯層：負責資料處理、演算法運算、DOM 渲染與事件綁定
 * V26.1 Fix：修復關聯學派 V6.1 包牌崩潰問題，建立直通渲染邏輯
 */

import { GAME_CONFIG } from './game_config.js';
import { 
    getGanZhi, 
    monteCarloSim, 
    calculateZone, 
    fetchAndParseZip, 
    mergeLotteryData, 
    fetchLiveLotteryData, 
    saveToCache, 
    loadFromCache 
} from './utils.js';

// 學派演算法（統計 / 關聯 / 平衡 / AI）
import { algoStat } from './algo/algo_stat.js';
import { algoPattern } from './algo/algo_pattern.js';
import { algoBalance } from './algo/algo_balance.js';
import { algoAI } from './algo/algo_ai.js';
// [Fix] 重新命名 import 以避免與 App 方法名稱衝突


// 五行學派子系統（紫微 / 姓名 / 星盤 / 五行生肖）
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
        drawOrder: 'size' // 預設用大小順序顯示
    },

    init() {
        this.initFirebase();
        this.selectSchool('balance');
        this.populateYearSelect();
        this.populateMonthSelect();
        this.initFetch();
        this.bindEvents();
    },

    bindEvents() {
        const periodInput = document.getElementById('search-period');
        if (periodInput) {
            periodInput.addEventListener('input', (e) => {
                this.state.filterPeriod = e.target.value.trim();
                this.updateDashboard();
            });
        }
        document.getElementById('search-year')
            .addEventListener('change', (e) => {
                this.state.filterYear = e.target.value;
                this.updateDashboard();
            });
        document.getElementById('search-month')
            .addEventListener('change', (e) => {
                this.state.filterMonth = e.target.value;
                this.updateDashboard();
            });
    },

    // ================= Firebase / Profile / API Key 相關 =================
    async initFirebase() {
        if (typeof window.firebaseModules === 'undefined') {
            this.loadProfilesLocal();
            return;
        }
        const { initializeApp, getAuth, onAuthStateChanged, getFirestore, getDoc, doc } = window.firebaseModules;
        const firebaseConfig = {
            apiKey: "AIzaSyBatltfrvZ5AXixdZBcruClqYrA-9ihsI0",
            authDomain: "lottery-app-bd106.firebaseapp.com",
            projectId: "lottery-app-bd106",
            storageBucket: "lottery-app-bd106.firebasestorage.app",
            messagingSenderId: "13138331714",
            appId: "1:13138331714:web:194ac3ff9513d19d9845db"
        };

        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            this.state.db = getFirestore(app);

            onAuthStateChanged(auth, async (user) => {
                this.state.user = user;
                this.updateAuthUI(user);
                if (user) {
                    await this.loadProfilesCloud(user.uid);
                    const ref = doc(
                        this.state.db,
                        'artifacts', 'lottery-app',
                        'users', user.uid,
                        'settings', 'api'
                    );
                    try {
                        const snap = await getDoc(ref);
                        if (snap.exists()) {
                            this.state.apiKey = snap.data().key;
                            document.getElementById('gemini-api-key').value = this.state.apiKey;
                        }
                    } catch (e) {
                        console.warn("Firebase Read Error (Storage blocked?):", e);
                    }
                } else {
                    this.loadProfilesLocal();
                }
            });
        } catch (e) {
            console.error("Firebase Init Error:", e);
            this.loadProfilesLocal();
        }
    },

    updateAuthUI(user) {
        const loginBtn = document.getElementById('btn-login');
        const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name');
        const dot = document.getElementById('login-status-dot');
        if (user) {
            loginBtn.classList.add('hidden');
            userInfo.classList.remove('hidden');
            userName.innerText = `Hi, ${user.displayName}`;
            dot.classList.remove('bg-stone-300');
            dot.classList.add('bg-green-500');
        } else {
            loginBtn.classList.remove('hidden');
            userInfo.classList.add('hidden');
            dot.classList.remove('bg-green-500');
            dot.classList.add('bg-stone-300');
        }
    },

    async loginGoogle() {
        try {
            const { getAuth, signInWithPopup, GoogleAuthProvider } = window.firebaseModules;
            await signInWithPopup(getAuth(), new GoogleAuthProvider());
        } catch (e) {
            alert("登入失敗：可能是瀏覽器阻擋了第三方 Cookies");
            console.error(e);
        }
    },

    async logoutGoogle() {
        await window.firebaseModules.signOut(window.firebaseModules.getAuth());
        this.state.profiles = [];
        this.loadProfilesLocal();
    },

    async loadProfilesCloud(uid) {
        try {
            const { doc, getDoc } = window.firebaseModules;
            const ref = doc(this.state.db, 'artifacts', 'lottery-app', 'users', uid, 'profiles', 'main');
            const snap = await getDoc(ref);
            this.state.profiles = snap.exists() ? snap.data().list || [] : [];
            this.renderProfileSelect();
            this.renderProfileList();
        } catch (e) {
            console.warn("Load Cloud Profiles Failed:", e);
        }
    },

    async saveProfilesCloud() {
        try {
            const { doc, setDoc } = window.firebaseModules;
            const ref = doc(this.state.db, 'artifacts', 'lottery-app', 'users', this.state.user.uid, 'profiles', 'main');
            await setDoc(ref, { list: this.state.profiles });
        } catch (e) {
            console.warn("Save Cloud Profiles Failed:", e);
        }
    },

    loadProfilesLocal() {
        try {
            const stored = localStorage.getItem('lottery_profiles');
            if (stored) this.state.profiles = JSON.parse(stored);
        } catch (e) {
            console.warn("Local Storage Read Blocked");
        }
        this.renderProfileSelect();
        this.renderProfileList();
    },

    saveProfiles() {
        if (this.state.user) this.saveProfilesCloud();
        try {
            localStorage.setItem('lottery_profiles', JSON.stringify(this.state.profiles));
        } catch (e) {
            console.warn("Local Storage Write Blocked");
        }
        this.renderProfileSelect();
        this.renderProfileList();
    },

    async saveApiKey() {
        const key = document.getElementById('gemini-api-key').value.trim();
        if (!key) return alert("請輸入 Key");
        this.state.apiKey = key;
        if (this.state.user) {
            try {
                const { doc, setDoc } = window.firebaseModules;
                await setDoc(
                    doc(this.state.db, 'artifacts', 'lottery-app', 'users', this.state.user.uid, 'settings', 'api'),
                    { key }
                );
            } catch (e) {
                console.warn("Firebase save key failed", e);
            }
        } else {
            try {
                localStorage.setItem('gemini_key', key);
            } catch (e) {
                console.warn("Local storage save key failed");
            }
        }
        alert("已儲存");
    },

    addProfile() {
        const name = document.getElementById('new-name').value.trim();
        if (!name) return;
        this.state.profiles.push({
            id: Date.now(),
            name,
            realname: document.getElementById('new-realname').value,
            ziwei: document.getElementById('new-ziwei').value,
            astro: document.getElementById('new-astro').value
        });
        this.saveProfiles();
        this.toggleProfileModal();
    },

    deleteProfile(id) {
        if (confirm('刪除?')) {
            this.state.profiles = this.state.profiles.filter(p => p.id !== id);
            this.saveProfiles();
        }
    },

    toggleProfileModal() {
        const m = document.getElementById('profile-modal');
        const c = document.getElementById('profile-modal-content');
        if (m.classList.contains('hidden')) {
            m.classList.remove('hidden');
            setTimeout(() => c.classList.remove('scale-95', 'opacity-0'), 10);
        } else {
            c.classList.add('scale-95', 'opacity-0');
            setTimeout(() => m.classList.add('hidden'), 200);
        }
    },

    renderProfileList() {
        document.getElementById('profile-list').innerHTML = this.state.profiles
            .map(p => `
                <div class="flex justify-between p-2 bg-stone-50 border rounded">
                  <div class="font-bold text-stone-700 text-xs">${p.name}</div>
                  <button onclick="app.deleteProfile(${p.id})" class="text-red-400 text-xs">刪除</button>
                </div>
            `).join('');
    },

    renderProfileSelect() {
        document.getElementById('profile-select').innerHTML =
            '<option value="">請新增...</option>' +
            this.state.profiles.map(p =>
                `<option value="${p.id}">${p.name}</option>`
            ).join('');
    },

    deleteCurrentProfile() {
        const pid = document.getElementById('profile-select').value;
        if (pid && confirm('刪除?')) {
            this.deleteProfile(Number(pid));
            document.getElementById('profile-select').value = "";
            this.onProfileChange();
        }
    },

    // ================ AI Fortune（流年解讀） ================
    async generateAIFortune() {
        const pid = document.getElementById('profile-select').value;
        if (!pid || !this.state.apiKey) return alert("請選主角並設定Key");
        document.getElementById('ai-loading').classList.remove('hidden');
        document.getElementById('btn-calc-ai').disabled = true;
        const p = this.state.profiles.find(x => x.id == pid);
        const currentYear = new Date().getFullYear();
        const ganZhi = getGanZhi(currentYear);
        const useName = document.getElementById('check-name')
            ? document.getElementById('check-name').checked
            : false;

        let prompt = `你現在是資深的國學易經術數領域專家...`;
        if (useName) {
            prompt += `【姓名學特別指令】...`;
        }
        prompt += `請務必回傳純 JSON 格式...`;

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${this.state.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                }
            );
            const d = await res.json();
            p.fortune2025 = JSON.parse(
                d.candidates[0].content.parts[0].text
                    .replace(/``````/g, '')
                    .trim()
            );
            this.saveProfiles();
            this.onProfileChange();
        } catch (e) {
            alert("AI 分析失敗");
            console.error(e);
        } finally {
            document.getElementById('ai-loading').classList.add('hidden');
            document.getElementById('btn-calc-ai').disabled = false;
        }
    },

    onProfileChange() {
        const pid = document.getElementById('profile-select').value;
        const s = document.getElementById('ai-fortune-section');
        if (!pid) {
            s.classList.add('hidden');
            return;
        }
        s.classList.remove('hidden');
        const p = this.state.profiles.find(x => x.id == pid);
        const d = document.getElementById('ai-result-display');
        if (p && p.fortune2025) {
            d.classList.remove('hidden');
            let html = `<div class="font-bold mb-1">📅 流年運勢:</div><p>${p.fortune2025.year_analysis}</p>`;
            if (p.fortune2025.name_analysis) {
                html += `
                  <div class="mt-2 pt-2 border-t border-pink-100">
                    <div class="font-bold mb-1">✍️ 姓名靈動:</div>
                    <p class="text-[10px]">${p.fortune2025.name_analysis.rationale}</p>
                  </div>`;
            }
            d.innerHTML = html;
            document.getElementById('btn-calc-ai').innerText = "🔄 重新批算";
            document.getElementById('btn-clear-ai').classList.remove('hidden');
        } else {
            d.classList.add('hidden');
            document.getElementById('btn-calc-ai').innerText = "✨ 大師批流年";
            document.getElementById('btn-clear-ai').classList.add('hidden');
        }
    },

    clearFortune() {
        const pid = document.getElementById('profile-select').value;
        const p = this.state.profiles.find(x => x.id == pid);
        if (p) {
            delete p.fortune2025;
            this.saveProfiles();
            this.onProfileChange();
        }
    },

    // ================= 核心資料載入流程 =================
async initFetch() {
    this.setSystemStatus('loading');
    try {
        // ========== Phase 1：載入 JSON + ZIP + Local Cache ==========
        const jsonRes = await fetch(`${CONFIG.JSON_URL}?t=${new Date().getTime()}`);
        let baseData = {};
        if (jsonRes.ok) {
            const jsonData = await jsonRes.json();
            baseData = jsonData.games || jsonData;
            this.state.rawJackpots = jsonData.jackpots || {};
            if (jsonData.last_updated) {
                document.getElementById('last-update-time').innerText = jsonData.last_updated.split(' ')[0];
            }
        }

        const zipPromises = CONFIG.ZIP_URLS.map(async (url) => {
            try { return await fetchAndParseZip(url); }
            catch (e) { console.warn("ZIP 下載失敗:", url, e); return {}; }
        });
        const zipResults = await Promise.all(zipPromises);

        const localCache = loadFromCache()?.data;

        const initialData = mergeLotteryData({ games: baseData }, zipResults, localCache);
        this.processAndRender(initialData);

        // ========== Phase 2：呼叫 Live API + 更新彩金 ==========
        const liveData = await fetchLiveLotteryData();
        if (liveData && Object.keys(liveData).length > 0) {
            // Live Data 才有 jackpot，取最新一筆更新
            for (const game in liveData) {
                if (liveData[game].length > 0) {
                    const sorted = liveData[game].sort((a, b) => new Date(b.date) - new Date(a.date));
                    const latest = sorted[0];
                    if (latest.jackpot && latest.jackpot > 0) {
                        this.state.rawJackpots[game] = latest.jackpot;
                    }
                }
            }

            const finalData = mergeLotteryData({ games: baseData }, zipResults, liveData);
            this.processAndRender(finalData);
            if (this.state.currentGame) this.updateDashboard();

            // 存 local cache（加速二次載入 + 離線支援）
            try { saveToCache(liveData); } 
            catch (e) { console.warn("Local Cache 寫入失敗", e); }
        }

        this.checkSystemStatus();

    } catch (e) {
        console.error("Critical Data Error:", e);
        this.checkSystemStatus();
    }

    this.renderGameButtons();
},

    processAndRender(mergedData) {
        this.state.rawData = mergedData.games || {};
        for (let game in this.state.rawData) {
            this.state.rawData[game] = this.state.rawData[game]
                .map(item => {
                    const gameDef = GAME_CONFIG.GAMES[game];
                    // [Fix] 侵略性清洗 + 強制整形：解決資料長度不符導致的驗證失敗
// 1. 基礎清洗：轉型 Number 並剔除無效值（digit 允許 0，其餘玩法不允許 0）
                    const minValid = (gameDef && gameDef.type === 'digit') ? 0 : 1;
                    const clean = (arr) => Array.isArray(arr)
                        ? arr.map(n => Number(n)).filter(n => !isNaN(n) && n >= minValid)
                        : [];
                    
                    let nums = clean(item.numbers);
                    let numsSize = clean(item.numbers_size);

                    


                    // 2. 強制整形：針對 'today' (今彩539) 與 'digit' (星彩) 執行嚴格切割
                    // 這能確保即便原始資料有雜訊 (如6碼)，也會被強制修正為正確長度 (如5碼)
                    if (gameDef) {
                        if (gameDef.type === 'today') {
                            nums = nums.slice(0, 5); // 539 嚴格 5 碼
                            numsSize = numsSize.slice(0, 5);
                        } else if (gameDef.type === 'digit') {
                            nums = nums.slice(0, gameDef.count); // 星彩嚴格 N 碼
                            numsSize = numsSize.slice(0, gameDef.count);
                        }
                        // Lotto/Power 類型通常允許 6 或 7 碼 (含特別號)，故不強制切為 6
                    }

                    return {
                        ...item,
                        date: new Date(item.date),
                        numbers: nums,
                        numbers_size: numsSize
                    };
                });
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
        threeDaysAgo.setDate(today.getDate() - 3);

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

        const dataCount = Object.values(this.state.rawData)
            .reduce((acc, curr) => acc + curr.length, 0);
        const dateStr = latestDateObj ? latestDateObj.toLocaleDateString() : "無資料";

        if (dataCount === 0 || !hasLatestData) {
            this.setSystemStatus('error', dateStr);
        } else {
            this.setSystemStatus('success');
        }
    },

    // ================== UI：遊戲 & 歷史 & 學派 ==================
    renderGameButtons() {
        const container = document.getElementById('game-btn-container');
        container.innerHTML = '';
        GAME_CONFIG.ORDER.forEach(gameName => {
            const btn = document.createElement('div');
            btn.className = `game-tab-btn ${gameName === this.state.currentGame ? 'active' : ''}`;
            btn.innerText = gameName;
            btn.onclick = () => {
                this.state.currentGame = gameName;
                this.state.currentSubMode = null;
                this.resetFilter();
                document.querySelectorAll('.game-tab-btn')
                    .forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                this.updateDashboard();
            };
            container.appendChild(btn);
        });
        if (!this.state.currentGame && GAME_CONFIG.ORDER.length > 0) {
            this.state.currentGame = GAME_CONFIG.ORDER[0];
            container.querySelector('.game-tab-btn')?.classList.add('active');
            this.updateDashboard();
        }
    },

    updateDashboard() {
        const gameName = this.state.currentGame;
        const gameDef = GAME_CONFIG.GAMES[gameName];
        let data = this.state.rawData[gameName] || [];

        // [新增] 動態調整包牌按鈕文字與顯示狀態
        const pack1Text = document.getElementById('btn-pack-1-text');
        const pack2Text = document.getElementById('btn-pack-2-text');
        const pack2Container = document.getElementById('btn-pack-2-container');
        const pack2Input = document.querySelector('input[value="pack_2"]');

        if (pack1Text && pack2Text && pack2Container) {
            if (gameDef.type === 'power') {
                // 威力彩：二區包牌 / 彈性包牌
                pack1Text.innerText = "🔒 二區包牌";
                pack2Text.innerText = "🌀 彈性包牌";
                pack2Container.classList.remove('hidden');
            } else if (gameDef.type === 'digit') {
                // 3星/4星：強勢包牌 / 彈性包牌
                pack1Text.innerText = "🔥 強勢包牌";
                pack2Text.innerText = "🌀 彈性包牌";
                pack2Container.classList.remove('hidden');
            } else {
                // 大樂透/539：標準包牌 (隱藏彈性包牌)
                pack1Text.innerText = "🔒 標準包牌";
                pack2Container.classList.add('hidden');
                // 防呆：如果當前選中已隱藏的按鈕，自動切回嚴選
                if (pack2Input && pack2Input.checked) {
                    document.querySelector('input[value="strict"]').checked = true;
                }
            }
        }

        if (this.state.filterPeriod) {
            data = data.filter(item => String(item.period).includes(this.state.filterPeriod));
        }
        if (this.state.filterYear) {
            data = data.filter(item => item.date.getFullYear() === parseInt(this.state.filterYear));
        }
        if (this.state.filterMonth) {
            data = data.filter(item => (item.date.getMonth() + 1) === parseInt(this.state.filterMonth));
        }

        document.getElementById('current-game-title').innerText = gameName;
        document.getElementById('total-count').innerText = data.length;
        document.getElementById('latest-period').innerText =
            data.length > 0 ? `${data[0].period}期` : "--期";

        const jackpotContainer = document.getElementById('jackpot-container');
        if (jackpotContainer) jackpotContainer.classList.add('hidden');

        this.renderSubModeUI(gameDef);
        this.renderHotStats('stat-year', data);
        this.renderHotStats('stat-month', data.slice(0, 30));
        this.renderHotStats('stat-recent', data.slice(0, 10));
        document.getElementById('no-result-msg')
            .classList.toggle('hidden', data.length > 0);

        this.renderDrawOrderControls();
        this.renderHistoryList(data.slice(0, 5));
    },

    getNextDrawDate(drawDays) {
        if (!drawDays || drawDays.length === 0) return "--";
        const today = new Date();
        const currentDay = today.getDay(); // 0(週日) - 6(週六)
        
        // 尋找本週是否還有開獎日
        let nextDay = drawDays.find(d => d > currentDay);
        let daysToAdd = 0;

        if (nextDay !== undefined) {
            daysToAdd = nextDay - currentDay;
        } else {
            // 本週已過，找下週的第一個開獎日
            nextDay = drawDays[0];
            daysToAdd = (7 - currentDay) + nextDay;
        }

        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + daysToAdd);

        const y = nextDate.getFullYear();
        const m = String(nextDate.getMonth() + 1).padStart(2, '0');
        const d = String(nextDate.getDate()).padStart(2, '0');
        const weekMap = ['日', '一', '二', '三', '四', '五', '六'];
        
        return `${y}/${m}/${d} (${weekMap[nextDate.getDay()]})`;
    },

    renderDrawOrderControls() {
        const container = document.getElementById('draw-order-controls');
        if (!container) return;
        container.classList.remove('hidden');
        container.innerHTML = `
            <button onclick="app.setDrawOrder('size')" class="order-btn ${this.state.drawOrder === 'size' ? 'active' : ''}">大小順序</button>
            <button onclick="app.setDrawOrder('appear')" class="order-btn ${this.state.drawOrder === 'appear' ? 'active' : ''}">開出順序</button>
        `;
        if (!document.getElementById('order-btn-style')) {
            document.head.insertAdjacentHTML('beforeend', `
                <style id="order-btn-style">
                    .order-btn {
                        padding: 2px 8px;
                        font-size: 15px;
                        border-radius: 9999px;
                        border: 1px solid #d6d3d1;
                        color: #57534e;
                        transition: all 150ms;
                    }
                    .order-btn.active {
                        background-color: #10b981;
                        border-color: #10b981;
                        color: white;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    }
                </style>
            `);
        }
    },

    setDrawOrder(order) {
        if (this.state.drawOrder === order) return;
        this.state.drawOrder = order;
        this.renderDrawOrderControls();
        this.updateDashboard();
    },

    renderSubModeUI(gameDef) {
        const area = document.getElementById('submode-area');
        const container = document.getElementById('submode-tabs');
        const rulesContent = document.getElementById('game-rules-content');
        const gameName = this.state.currentGame;

        // 總是顯示區域
        area.classList.remove('hidden');
        rulesContent.classList.add('hidden'); // 預設隱藏規則內容
        container.innerHTML = ''; // 清空容器

        // 1. 強制過濾：即使 Config 有定義，針對 3星/4星 也強制不渲染 Tab，只保留規則
        if (gameDef.subModes && !['3星彩', '4星彩'].includes(gameName)) {
            if (!this.state.currentSubMode) {
                this.state.currentSubMode = gameDef.subModes[0].id;
            }
            gameDef.subModes.forEach(mode => {
                const tab = document.createElement('div');
                tab.className = `submode-tab ${this.state.currentSubMode === mode.id ? 'active' : ''}`;
                tab.innerText = mode.name;
                tab.onclick = () => {
                    this.state.currentSubMode = mode.id;
                    document.querySelectorAll('.submode-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                };
                container.appendChild(tab);
            });
        }
        // 2. 如果沒有 subModes 或被強制過濾 (如 3星彩, 4星彩, 大樂透, 威力彩)，渲染資訊卡片 (獎金 + 日期)
        else {
            this.state.currentSubMode = null;
            
            // 抓取累積獎金 (若無資料顯示累計中)
            let jackpotText = "累計中";
            if (this.state.rawJackpots && this.state.rawJackpots[gameName]) {
                // 簡單格式化數字加逗號
                jackpotText = `$${Number(this.state.rawJackpots[gameName]).toLocaleString()}`;
            }

            // 計算下期開獎
            const nextDate = this.getNextDrawDate(gameDef.drawDays);

            // 只有大樂透和威力彩顯示獎金，其他顯示一般資訊
            if (['lotto', 'power', 'digit'].includes(gameDef.type)) {
                container.innerHTML = `
                    <div class="flex items-center gap-3 text-xs md:text-sm">
                        ${['大樂透', '威力彩'].includes(gameName) ? `
                        <div class="px-3 py-1 bg-yellow-50 text-yellow-700 rounded-lg border border-yellow-200 font-bold flex items-center gap-1 shadow-sm">
                            <span>💰</span> 累積: ${jackpotText}
                        </div>
                        ` : ''}
                        <div class="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 font-bold flex items-center gap-1 shadow-sm">
                            <span>📅</span> 下期: ${nextDate}
                        </div>
                    </div>
                `;
            }
        }
        
        rulesContent.innerHTML = gameDef.article || "暫無說明";
    },

    toggleRules() {
        document.getElementById('game-rules-content')
            .classList.toggle('hidden');
    },

    renderHistoryList(data) {
        const list = document.getElementById('history-list');
        list.innerHTML = '';
        data.forEach(item => {
            let numsHtml = "";
            const gameDef = GAME_CONFIG.GAMES[this.state.currentGame];

            const sourceNumbers =
                this.state.drawOrder === 'size' &&
                item.numbers_size && item.numbers_size.length > 0
                    ? item.numbers_size
                    : item.numbers || [];

            const numbers = sourceNumbers.filter(n => typeof n === 'number');

            if (gameDef.type === 'digit') {
                numsHtml = numbers
                    .map(n => `<span class="ball-sm">${n}</span>`)
                    .join('');
            } else {
                const len = numbers.length;
                let normal = [], special = null;
                if ((gameDef.type === 'power' || gameDef.special) && len > gameDef.count) {
                    special = numbers[len - 1];
                    normal = numbers.slice(0, len - 1);
                } else {
                    normal = numbers;
                }
                numsHtml = normal
                    .filter(n => typeof n === 'number')
                    .map(n => `<span class="ball-sm">${n}</span>`)
                    .join('');
                if (special !== null && typeof special === 'number') {
                    numsHtml += `<span class="ball-sm ball-special ml-2 font-black border-none">${special}</span>`;
                }
            }

            list.innerHTML += `
              <tr class="table-row">
                <td class="px-5 py-3 border-b border-stone-100">
                  <div class="font-bold text-stone-700">No. ${item.period}</div>
                  <div class="text-[10px] text-stone-400">${item.date.toLocaleDateString()}</div>
                </td>
                <td class="px-5 py-3 border-b border-stone-100 flex flex-wrap gap-1">
                  ${numsHtml}
                </td>
              </tr>`;
        });
    },

    renderHotStats(elId, dataset) {
        const el = document.getElementById(elId);
        if (!dataset || dataset.length === 0) {
            el.innerHTML = '<span class="text-stone-300 text-[10px]">無數據</span>';
            return;
        }
        const freq = {};
        dataset.forEach(d =>
            d.numbers.forEach(n => {
                freq[n] = (freq[n] || 0) + 1;
            })
        );
        const sorted = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        el.innerHTML = sorted.map(([n, c]) => `
            <div class="flex flex-col items-center">
              <div class="ball ball-hot mb-1 scale-75">${n}</div>
              <div class="text-sm text-stone-600 font-black">${c}</div>
            </div>
        `).join('');
    },

    selectSchool(school) {
        this.state.currentSchool = school;
        const info = GAME_CONFIG.SCHOOLS[school];
        document.querySelectorAll('.school-card').forEach(el => {
            el.classList.remove('active');
            Object.values(GAME_CONFIG.SCHOOLS).forEach(s => {
                if (s.color) el.classList.remove(s.color);
            });
        });
        const activeCard = document.querySelector(`.school-${school}`);
        if (activeCard) {
            activeCard.classList.add('active');
            activeCard.classList.add(info.color);
        }
        const container = document.getElementById('school-description');
        container.className =
            `text-sm leading-relaxed text-stone-600 bg-stone-50 p-5 rounded-xl border-l-4 ${info.color}`;
        container.innerHTML =
            `<h4 class="base font-bold mb-3 text-stone-800">${info.title}</h4>${info.desc}`;
        document.getElementById('wuxing-options')
            .classList.toggle('hidden', school !== 'wuxing');
    },

    // ================= 學派入口：runPrediction (Fix: V6.1 Pattern Support) =================
    runPrediction() {
        const gameName = this.state.currentGame;
        const gameDef  = GAME_CONFIG.GAMES[gameName];
        let data       = this.state.rawData[gameName] || [];
        if (!gameDef) return;

        const modeInput = document.querySelector('input[name="count"]:checked');
        const mode = modeInput ? modeInput.value : 'strict'; // strict, random, pack_1, pack_2

        const container = document.getElementById('prediction-output');
        container.innerHTML = '';
        document.getElementById('result-area').classList.remove('hidden');

        // 設定參數
        const isRandom = (mode === 'random');
        const isPack   = (mode.startsWith('pack')); // pack_1 或 pack_2 都是包牌
        const school   = this.state.currentSchool;

        // [Fix] 針對關聯學派(Pattern) V6.1 的直通車邏輯
        if (school === 'pattern' && isPack) {
            const params = {
                data,
                gameDef,
                subModeId: this.state.currentSubMode,
                excludeNumbers: new Set(),
                mode: 'strict', // Pattern學派內部邏輯使用
                packMode: mode, // 'pack_1' 或 'pack_2'
                targetCount: 5  // 目標注數
            };
            
            // 直接呼叫 Pattern V6.1，它會回傳陣列
            const results = algoPattern(params);
            
            // 直接渲染陣列結果，不進入 SmartWheel
            if (Array.isArray(results)) {
                results.forEach((res, idx) => {
                    this.renderRow(res, idx + 1, `<span class="text-purple-600 font-bold">🎯 關聯包牌 ${idx + 1}</span>`);
                });
            } else {
                // 防呆：如果回傳單注（發生錯誤時）
                this.renderRow(results, 1);
            }
            return; // 結束執行
        }
        // [Fix] AI 學派 V7.0 的直通車邏輯
        if (school === 'ai' && isPack) {
            const params = {
                data,
                gameDef,
                subModeId: this.state.currentSubMode,
                excludeNumbers: [],
                random: isRandom,
                mode: isRandom ? 'random' : 'strict',
                packMode: mode,
                targetCount: (gameDef.type === 'power' && mode === 'pack_1') ? 8 : 5
            };
            
            const results = algoAI(params);
            
            if (Array.isArray(results)) {
                results.forEach((res, idx) => {
                    this.renderRow(res, idx + 1, `<span class="text-amber-600 font-bold">🤖 AI包牌 ${idx + 1}</span>`);
                });
            } else {
                this.renderRow(results, 1);
            }
            return; // 不進 SmartWheel
        }
        // --- 以下為其他學派或非包牌模式的舊邏輯 (Loop + SmartWheel) ---
        
        const count = isPack ? 3 : 5; // 包牌先跑3輪湊池，一般跑5注
        const excludeSet = new Set();
        const packPool = [];

        for (let i = 0; i < count; i++) {
            const params = { 
                data, 
                gameDef, 
                subModeId: this.state.currentSubMode, 
                excludeNumbers: excludeSet,
                random: isRandom, // 相容舊參數
                mode: isRandom ? 'random' : 'strict', // 相容新參數
                setIndex: i 
            };
            
            let result = null;

            switch (school) {
                case 'balance': result = algoBalance(params); break;
                case 'stat':    result = algoStat(params); break;
                case 'pattern': result = algoPattern(params); break;
                case 'ai':      result = algoAI(params); break;
                case 'wuxing':  result = this.algoWuxing(params); break;
            }

            if (result && result.numbers) {
                if (!monteCarloSim(result.numbers, gameDef)) { /* fallback */ }

                // 更新排除名單
                result.numbers.forEach(n => {
                    excludeSet.add(n.val);
                    if (isPack) packPool.push(n.val); 
                });

                // 如果不是包牌模式，直接渲染結果
                if (!isPack) {
                    let rankLabel = `SET ${i + 1}`;
                    if (isRandom) {
                        rankLabel = `<span class="text-amber-600">🎲 隨機推薦 ${i+1}</span>`;
                    } else {
                        if (i === 0) rankLabel = `<span class="text-yellow-600">👑 系統首選</span>`;
                        else if (i === 1) rankLabel = `<span class="text-stone-500">🥈 次佳組合</span>`;
                        else if (i === 2) rankLabel = `<span class="text-amber-700">🥉 潛力組合</span>`;
                        else rankLabel = `<span class="text-stone-400">🛡️ 補位組合</span>`;
                    }
                    this.renderRow(result, i + 1, rankLabel);
                }
                
                // 包牌模式：若池子夠了就提早結束 (12個夠用了)
                if (isPack && packPool.length >= 12) break;
            }
        }

                // 包牌模式的後續處理（已廢除 SmartWheel，所有學派都應該自己處理包牌）
        if (isPack) {
            // 如果執行到這裡，表示該學派尚未實作包牌直通車
            const container = document.getElementById('prediction-output');
            container.innerHTML = '<div class="p-4 text-center text-stone-400">此學派尚未支援包牌策略</div>';
        }
    },


    // 五行學派：統籌紫微 / 星盤 / 姓名 / 生肖 的權重疊加
    algoWuxing({ gameDef }) {
        const wuxingWeights = {};
        const wuxingTagMap  = {};
        const min = (gameDef.type === 'digit' ? 0 : 1);

        for (let k = min; k <= gameDef.range; k++) {
            wuxingWeights[k] = 10;
            wuxingTagMap[k]  = "基礎運數";
        }

        const pid     = document.getElementById('profile-select').value;
        const profile = this.state.profiles.find(p => p.id == pid);

        const useZiwei  = document.getElementById('check-purple')?.checked;
        const useAstro  = document.getElementById('check-astro')?.checked;
        const useName   = document.getElementById('check-name')?.checked;
        const useZodiac = document.getElementById('check-zodiac')?.checked;

        if (useZiwei)  applyZiweiLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useAstro)  applyStarsignLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useName)   applyNameLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useZodiac) applyWuxingLogic(wuxingWeights, wuxingTagMap, gameDef, profile);

        const wuxingContext = { tagMap: wuxingTagMap };

        const pickZone1 = calculateZone(
            [], gameDef.range, gameDef.count,
            false, 'wuxing',
            [], wuxingWeights, null, wuxingContext
        );

        let pickZone2 = [];
        if (gameDef.type === 'power') {
            pickZone2 = calculateZone(
                [], gameDef.zone2, 1,
                true, 'wuxing',
                [], wuxingWeights, null, wuxingContext
            );
        }

        const tags     = [...pickZone1, ...pickZone2].map(o => o.tag);
        const dominant = tags.sort((a, b) =>
            tags.filter(v => v === a).length - tags.filter(v => v === b).length
        ).pop();

        return {
            numbers: [...pickZone1, ...pickZone2],
            groupReason: `💡 流年格局：[${dominant}] 主導。`
        };
    },



    renderRow(resultObj, index, label = null) {
        const container = document.getElementById('prediction-output');
        const colors = {
            stat: 'bg-stone-200 text-stone-700',
            pattern: 'bg-purple-100 text-purple-700',
            balance: 'bg-emerald-100 text-emerald-800',
            ai: 'bg-amber-100 text-amber-800',
            wuxing: 'bg-pink-100 text-pink-800'
        };
        const colorClass = colors[this.state.currentSchool] || 'bg-stone-200';

        const displayLabel = label ? label : `SET ${index}`;

        // ===== 只改 UI 顯示：Pos1/Pos2/... 轉成「位數」名稱（不動演算法輸出）=====
        const posNameMapByGame = {
            '3星彩': ['佰位', '拾位', '個位'],
            '4星彩': ['仟位', '佰位', '拾位', '個位']
        };
        const posNames = posNameMapByGame[this.state.currentGame] || null;

        let html = `
          <div class="flex flex-col gap-2 p-4 bg-white rounded-xl border border-stone-200 shadow-sm animate-fade-in hover:shadow-md transition">
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-black text-stone-300 tracking-widest uppercase">${displayLabel}</span>
              <div class="flex flex-wrap gap-2">
        `;

        resultObj.numbers.forEach(item => {
            let displayTag = item.tag;

            // 只在 3/4 星彩把 PosX 轉成位數名稱
            if (posNames && typeof displayTag === 'string') {
                const m = displayTag.match(/^Pos(\d+)$/);
                if (m) {
                    const idx = parseInt(m[1], 10) - 1;
                    if (idx >= 0 && idx < posNames.length) {
                        displayTag = posNames[idx];
                    }
                }
            }

            html += `
              <div class="flex flex-col items-center">
                <div class="ball-sm ${colorClass}" style="box-shadow: none;">${item.val}</div>
                ${displayTag ? `<div class="reason-tag">${displayTag}</div>` : ''}
              </div>
            `;
        });

        html += `
              </div>
            </div>
        `;

        if (resultObj.groupReason) {
            html += `
              <div class="text-[10px] text-stone-500 font-medium bg-stone-50 px-2 py-1.5 rounded border border-stone-100 flex items-center gap-1">
                <span class="text-sm">💡</span> ${resultObj.groupReason}
              </div>
            `;
        }

        html += `</div>`;
        container.innerHTML += html;
    },


    populateYearSelect() {
        const yearSelect = document.getElementById('search-year');
        const cy = new Date().getFullYear();
        for (let y = 2021; y <= cy; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.innerText = `${y}`;
            yearSelect.appendChild(opt);
        }
    },

    populateMonthSelect() {
        const monthSelect = document.getElementById('search-month');
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = `${m} 月`;
            monthSelect.appendChild(opt);
        }
    },

    resetFilter() {
        this.state.filterPeriod = "";
        this.state.filterYear = "";
        this.state.filterMonth = "";
        const pInput = document.getElementById('search-period');
        if (pInput) pInput.value = "";
        document.getElementById('search-year').value = "";
        document.getElementById('search-month').value = "";
        this.updateDashboard();
    },

    toggleHistory() {
        const c = document.getElementById('history-container');
        const a = document.getElementById('history-arrow');
        const t = document.getElementById('history-toggle-text');
        if (c.classList.contains('max-h-0')) {
            c.classList.remove('max-h-0');
            c.classList.add('max-h-[1000px]');
            a.classList.add('rotate-180');
            t.innerText = "隱藏近 5 期";
        } else {
            c.classList.add('max-h-0');
            c.classList.remove('max-h-[1000px]');
            a.classList.remove('rotate-180');
            t.innerText = "顯示近 5 期";
        }
    }
};

window.app = App;
window.onload = () => App.init();



