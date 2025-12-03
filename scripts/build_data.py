import json
import os
import requests
import zipfile
import io
import datetime
import re
import time
import urllib3

# 關閉 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# === 設定區 ===
DATA_DIR = 'data'
OUTPUT_FILE = os.path.join(DATA_DIR, 'lottery-data.json')
HISTORY_YEARS = [2021, 2022, 2023, 2024, 2025]
API_BASE = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery'

# 遊戲代碼對照表
GAMES = {
    '大樂透': 'Lotto649',
    '威力彩': 'SuperLotto638',
    '今彩539': 'Daily539',
    '雙贏彩': 'Lotto1224',
    '3星彩': '3D',
    '4星彩': '4D'
}

# API回應中對應的鍵名
API_RESPONSE_KEYS = {
    'SuperLotto638': 'superLotto638Res',
    'Lotto649': 'lotto649Res',
    'Daily539': 'daily539Res',
    'Lotto1224': 'lotto1224Res',
    '3D': 'lotto3DRes',
    '4D': 'lotto4DRes'
}

# 頭獎爬蟲目標網址
JACKPOT_URLS = {
    '大樂透': 'https://www.taiwanlottery.com/lotto/result/lotto649',
    '威力彩': 'https://www.taiwanlottery.com/lotto/result/super_lotto638'
}

# 使用您測試成功的 Header
HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://www.taiwanlottery.com/'
}

def ensure_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

def get_target_months():
    """ 生成過去4個月和未來12個月的月份列表 """
    today = datetime.date.today()
    months = []
    
    # 過去4個月 (包含本月)
    for i in range(4):
        month = today.month - i
        year = today.year
        if month <= 0:
            month += 12
            year -= 1
        months.append(f"{year}-{month:02d}")
    
    # 未來12個月 (從下個月開始)
    for i in range(1, 13):
        month = today.month + i
        year = today.year
        if month > 12:
            month -= 12
            year += 1
        months.append(f"{year}-{month:02d}")
    
    # 移除重複並排序
    return sorted(list(set(months)))

def get_jackpot_amount(game_name):
    """ 從網頁 HTML 爬取目前頭獎累積金額 """
    if game_name not in JACKPOT_URLS: return None
    url = JACKPOT_URLS[game_name]
    print(f"Scraping jackpot for {game_name}...")
    try:
        res = requests.get(url, headers=HEADERS, timeout=20, verify=False)
        if res.status_code != 200: return None
        matches = re.findall(r'class="amount-number"[^>]*>(\d)</div>', res.text)
        if matches:
            return "{:,}".format(int("".join(matches)))
        return "更新中" if "更新中" in res.text else None
    except Exception as e:
        print(f"Jackpot error: {e}")
        return None

def parse_csv_line(line):
    """ 解析歷史 ZIP 檔 """
    line = line.replace('\ufeff', '').strip()
    if not line: return None
    cols = [c.strip().replace('"', '') for c in line.split(',')]
    if len(cols) < 5: return None
    
    game_name = cols[0].strip()
    matched_game = None
    for g in GAMES:
        if g in game_name:
            matched_game = g
            break
    if not matched_game: return None

    # 日期解析
    match = re.search(r'(\d{3,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})', cols[2].strip())
    final_date = ""
    if match:
        y, m, d = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if y < 1911: y += 1911
        final_date = f"{y}-{m:02d}-{d:02d}"
    else: return None

    try:
        numbers = []
        for i in range(5, len(cols)): 
            val = cols[i].strip()
            if val.isdigit():
                n = int(val)
                if 0 <= n <= 99: numbers.append(n)
        if len(numbers) < 2: return None
        return {'game': matched_game, 'data': {'date': final_date, 'period': cols[1], 'numbers': numbers, 'source': 'history'}}
    except: return None

def load_history():
    print("=== Loading History ZIPs ===")
    db = {g: [] for g in GAMES}
    for year in HISTORY_YEARS:
        zip_path = os.path.join(DATA_DIR, f'{year}.zip')
        if not os.path.exists(zip_path): continue
        try:
            with zipfile.ZipFile(zip_path, 'r') as z:
                for filename in z.namelist():
                    if filename.lower().endswith('.csv') and not filename.startswith('__'):
                        with z.open(filename) as f:
                            raw = f.read()
                            content = ""
                            for enc in ['cp950', 'utf-8-sig', 'utf-8', 'big5']:
                                try: content = raw.decode(enc); break
                                except: continue
                            if content:
                                for line in content.splitlines():
                                    parsed = parse_csv_line(line)
                                    if parsed: db[parsed['game']].append(parsed['data'])
        except Exception as e: print(f"Error reading {year}.zip: {e}")
    return db

def fetch_api(db):
    print("=== Fetching Live API ===")
    months = get_target_months()
    print(f"Target months: {len(months)} months (past 4 + future 12)")
    
    for game_name, code in GAMES.items():
        existing_keys = set(f"{d['date']}_{d['period']}" for d in db[game_name])
        print(f"Processing {game_name} ({code})...")
        
        for m in months:
            # 修正API網址格式，添加period參數
            url = f"{API_BASE}/{code}Result?period&month={m}&pageNum=1&pageSize=50"
            try:
                res = requests.get(url, headers=HEADERS, timeout=30, verify=False)
                
                if res.status_code != 200:
                    print(f"  [Fail] {m} -> {res.status_code}")
                    continue
                
                try: 
                    data = res.json()
                except Exception as e:
                    print(f"  [JSON Error] {m}: {e}")
                    continue

                # 檢查API回應格式
                rt_code = data.get('rtCode', -1)
                if rt_code != 0:
                    print(f"  [API Error] {m}: rtCode={rt_code}")
                    continue
                
                if 'content' not in data:
                    print(f"  [No Content] {m}")
                    continue
                
                # 取得對應遊戲的鍵名
                response_key = API_RESPONSE_KEYS.get(code)
                if not response_key:
                    print(f"  [Unknown Game] No response key for {code}")
                    continue
                
                # 取得開獎記錄列表
                records = data['content'].get(response_key, [])
                if not records:
                    # 可能該月份還沒有開獎資料，這是正常的
                    continue
                
                count = 0
                for item in records:
                    # 解析日期
                    date_raw = item.get('lotteryDate', '')
                    if 'T' in date_raw:
                        date_str = date_raw.split('T')[0]
                    else:
                        date_str = date_raw
                    
                    if not date_str:
                        continue
                    
                    # 建立唯一鍵
                    period = str(item.get('period', ''))
                    key = f"{date_str}_{period}"
                    
                    if key not in existing_keys:
                        # 取得開獎號碼
                        numbers = []
                        
                        # 優先使用 drawNumberSize 欄位
                        draw_numbers = item.get('drawNumberSize', [])
                        if draw_numbers:
                            numbers = [int(n) for n in draw_numbers if isinstance(n, (int, float, str)) and str(n).isdigit()]
                        
                        # 如果 drawNumberSize 沒有資料，嘗試 drawNumberAppear
                        if not numbers:
                            draw_numbers = item.get('drawNumberAppear', [])
                            if draw_numbers:
                                numbers = [int(n) for n in draw_numbers if isinstance(n, (int, float, str)) and str(n).isdigit()]
                        
                        # 如果還是沒有號碼，跳過這筆記錄
                        if not numbers:
                            continue
                        
                        # 添加到資料庫
                        db[game_name].append({
                            'date': date_str,
                            'period': period,
                            'numbers': numbers,
                            'source': 'api'
                        })
                        existing_keys.add(key)
                        count += 1
                
                if count > 0: 
                    print(f"  + API: Found {count} new records in {m}")
                
                # 避免請求過快
                time.sleep(0.5)
                
            except requests.exceptions.Timeout:
                print(f"  [Timeout] {m}: Request timeout")
            except requests.exceptions.ConnectionError:
                print(f"  [Connection Error] {m}: Failed to connect")
            except Exception as e:
                print(f"  [Error] {game_name} {m}: {str(e)}")

def save_data(db):
    print("=== Saving Data ===")
    
    # 更新頭獎金額
    jackpots = {}
    for game in JACKPOT_URLS:
        amt = get_jackpot_amount(game)
        if amt: 
            jackpots[game] = amt
            print(f"  {game} jackpot: {amt}")
    
    # 按日期排序
    for game in db:
        db[game].sort(key=lambda x: x['date'], reverse=True)
        print(f"  {game}: {len(db[game])} records")
    
    # 計算總記錄數
    total_records = sum(len(db[game]) for game in db)
    
    final_output = {
        "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_records": total_records,
        "jackpots": jackpots,
        "games": db
    }
    
    # 保存到檔案
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, separators=(',', ':'))
        print(f"Saved to {OUTPUT_FILE}")
        print(f"Total records: {total_records}")
    except Exception as e:
        print(f"Error saving data: {e}")

def main():
    try:
        ensure_dir()
        print("=" * 50)
        print(f"Start time: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 50)
        
        # 載入歷史資料
        db = load_history()
        
        # 取得API資料
        fetch_api(db)
        
        # 保存資料
        save_data(db)
        
        print("=" * 50)
        print(f"End time: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 50)
        
    except Exception as e:
        print(f"Critical error: {e}")
        import traceback
        traceback.print_exc()
        
        # 確保至少有空的輸出檔案
        if not os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
                json.dump({"games": {}, "jackpots": {}, "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}, f)

if __name__ == '__main__':
    main()
