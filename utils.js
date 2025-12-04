// --- 官方 API 抓取功能 (核心) ---

/**
 * 穩定版 Proxy 方案
 * 1. 主要 proxy: https://cors.sh/
 * 2. 備援 proxy: https://thingproxy.freeboard.io/fetch/
 * 3. 本地端/已允許 CORS 時自動使用原生 URL
 */
async function fetchWithProxy(url) {

    const tryFetch = async (proxyUrl) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const res = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    };

    const encoded = encodeURIComponent(url);

    const proxyList = [
        `https://cors.sh/${url}`,                                      // 主 Proxy
        `https://thingproxy.freeboard.io/fetch/${encoded}`,            // 備援
        url                                                            // 最後原生（本地測試用）
    ];

    for (let proxy of proxyList) {
        try {
            console.log(`🔄 嘗試 Proxy: ${proxy}`);
            return await tryFetch(proxy);
        } catch (e) {
            console.warn(`⚠️ Proxy 失敗: ${proxy}`, e.message);
        }
    }

    throw new Error("❌ 所有 Proxy 都無法使用");
}



/**
 * 透過 Proxy 抓取台彩官方 API（升級版）
 */
export async function fetchLiveLotteryData() {

    const now = new Date();
    const year = now.getFullYear();
    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;
    const timestamp = Date.now();

    console.log(`📡 [API] 啟動背景爬蟲 (${startMonth} ~ ${endMonth})...`);

    const apiMap = {
        '威力彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'superLotto638Res', type: 'power'
        },
        '大樂透': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'lotto649Res', type: 'lotto'
        },
        '今彩539': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'daily539Res', type: '539'
        },
        '3星彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l3DRes', type: '3d'
        },
        '4星彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l4DRes', type: '4d'
        }
    };

    const liveData = {};
    const promises = Object.entries(apiMap).map(async ([gameName, config]) => {

        try {
            const targetUrl = `${config.url}&_t=${timestamp}`;
            const raw = await fetchWithProxy(targetUrl);

            let json;
            try {
                json = JSON.parse(raw);
            } catch {
                throw new Error("Proxy 回傳非 JSON");
            }

            const content = json.content;
            if (!content) throw new Error("回傳無 content");

            const records = content[config.key];
            if (!Array.isArray(records) || records.length === 0)
                return console.warn(`⚠️ [API Empty] ${gameName}`);

            liveData[gameName] = records.map(r => {
                let numbersAppear = (r.drawNumberAppear || r.winningNumbers || [])
                    .map(n => parseInt(n, 10))
                    .filter(n => !isNaN(n));

                let numbersSize = (r.drawNumberSize || r.winningNumbers || [])
                    .map(n => parseInt(n, 10))
                    .filter(n => !isNaN(n));

                let finalNumbers =
                    (config.type === '3d' || config.type === '4d' || config.type === '539') 
                        ? numbersAppear
                        : numbersAppear;

                return {
                    period: r.drawTerm || r.period,
                    date: r.lotteryDate || r.date,
                    numbers: finalNumbers,
                    numbers_size: numbersSize
                };
            });

            console.log(`✅ [API Success] ${gameName} 抓到 ${liveData[gameName].length} 筆`);

        } catch (e) {
            console.error(`❌ [API Failed] ${gameName}:`, e.message);
        }
    });

    await Promise.all(promises);
    return liveData;
}
