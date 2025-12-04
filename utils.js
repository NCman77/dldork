/**
 * === 主函式：從台彩官方 API 取得最新開獎紀錄 ===
 */
export async function fetchLiveLotteryData() {
    const now = new Date();
    const year = now.getFullYear();

    const startMonth = `${year}-01`;
    const endMonth = `${year}-12`;
    const timestamp = Date.now();

    console.log(`📡 [API] 啟動背景爬蟲 (${startMonth} ~ ${endMonth})`);

    const apiMap = {
        '威力彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/SuperLotto638Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'superLotto638Res',
            type: 'power'
        },
        '大樂透': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'lotto649Res',
            type: 'lotto'
        },
        '今彩539': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'daily539Res',
            type: '539'
        },
        '3星彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/3DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l3DRes',
            type: '3d'
        },
        '4星彩': {
            url: `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/4DResult?period&startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=50`,
            key: 'l4DRes',
            type: '4d'
        }
    };

    const liveData = {};
    const tasks = Object.entries(apiMap).map(async ([gameName, cfg]) => {

        const fullUrl = `${cfg.url}&_t=${timestamp}`;

        try {
            const json = await safeFetch(fullUrl);

            // ✅ 判斷資料來源：有 content 就用 content[cfg.key]，沒有就直接用 json
            let records;
            if (json.content && json.content[cfg.key]) {
                records = json.content[cfg.key];
            } else if (Array.isArray(json)) {
                records = json;
            } else if (json[cfg.key] && Array.isArray(json[cfg.key])) {
                records = json[cfg.key];
            } else {
                // fallback: 如果是單筆物件，包成陣列
                records = json ? [json] : [];
            }

            if (!Array.isArray(records)) throw new Error("資料格式錯誤");

            liveData[gameName] = records.map(r => {
                const numbersAppear = (r.drawNumberAppear || r.winningNumbers || [])
                    .map(n => parseInt(n, 10))
                    .filter(n => !isNaN(n));

                const numbersSize = (r.drawNumberSize || r.winningNumbers || [])
                    .map(n => parseInt(n, 10))
                    .filter(n => !isNaN(n));

                return {
                    period: r.drawTerm || r.period,
                    date: r.lotteryDate || r.date,
                    numbers: numbersAppear,
                    numbers_size: numbersSize
                };
            });

            console.log(`✅ [API] ${gameName} → ${liveData[gameName].length} 筆`);

        } catch (e) {
            console.error(`❌ [API] ${gameName} 抓取失敗：`, e.message);
        }
    });

    await Promise.all(tasks);
    return liveData;
}
