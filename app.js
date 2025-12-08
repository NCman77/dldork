/**
 * app.js
 * 核心邏輯層：負責資料處理、演算法運算、DOM 渲染與事件綁定
 * V27.4：修正累積獎金讀取來源，並調整顯示順序 (獎金在左，日期在右)
 */

import { GAME_CONFIG } from './game_config.js';
import {
    getGanZhi, monteCarloSim, calculateZone,
    fetchAndParseZip, mergeLotteryData, fetchLiveLotteryData,
    saveToCache, saveToFirestore, loadFromFirestore, loadFromCache
} from './utils.js';

// 學派演算法
import { algoStat } from './algo/algo_stat.js';
import { algoPattern } from './algo/algo_pattern.js';
import { algoBalance } from './algo/algo_balance.js';
import { algoAI } from './algo/algo_ai.js';
import { algoSmartWheel } from './algo/algo_smartwheel.js';

// 五行學派子系統
import { applyZiweiLogic } from './algo/algo_Ziwei.js';
import { applyNameLogic } from './algo/algo_name.js';
import { applyStarsignLogic } from './algo/algo_starsign.js';
import { applyWuxingLogic } from './algo/algo_wuxing.js';

// 動態產生 ZIP URL
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
        currentPatternStrategy: "default", 
        filterPeriod: "", filterYear: "", filterMonth: "",
        profiles: [], user: null, db: null, apiKey: "",
        drawOrder: 'size' 
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

    // ================= Firebase / Profile / API Key 相關 (維持不變) =================
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

    // ================ AI Fortune ================
    async generateAIFortune() {
        const pid = document.getElementById('profile-select').value;
        if (!pid || !this.state.apiKey) return alert("請選主角並設定Key");
        document.getElementById('ai-loading').classList.remove('hidden');
        document.getElementById('btn-calc-ai').disabled = true;
        const p = this.state.profiles.find(x => x.id == pid);
        const useName = document.getElementById('check-name')?.checked;

        let prompt = `你現在是資深的國學易經術數領域專家...`;
        if (useName) prompt += `【姓名學特別指令】...`;
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
                d.candidates[0].content.parts[0].text.replace(/``````/g, '').trim()
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
        const pid = document.
