import json
import os
import re
import sys
import time

import requests

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
KEIBA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'keiba')
sys.path.insert(0, KEIBA_DIR)

from g1_parser import HEADERS, fetch_g1_race_list, parse_full_race  # noqa: E402

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'jockey_names.json')
REQUEST_INTERVAL_SEC = 0.3

FULL_NAME_PATTERN = re.compile(r'<div class="Name">\s*<h1>\s*([^\n<&]+?)&nbsp;', re.S)

# netkeiba側のデータ不備で、実際とは別人のjockey_idにリンクされている既知のケース。
# 2019年エリザベス女王杯のレイホーロマンス号の騎手表示「岩崎」が、
# 和田翼のjockey_id（01146）を指すリンクになっている（要検証・修正されない限りこのまま）。
KNOWN_BAD_LINKS = {('01146', '岩崎')}


def fetch_html(url: str, encoding: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = encoding
    return resp.text


def collect_jockeys(start_year: int, end_year: int) -> dict:
    """全レースを走査し、jockey_id -> netkeiba結果表示で見られた短縮名の集合 を作る（
    同じ騎手でも負担重量マーク等の影響でレースごとに短縮のされ方が異なることがあるため、
    出現した表記は全てセットで保持する）"""
    races = fetch_g1_race_list(start_year, end_year)
    print(f'{len(races)}件のレースから騎手IDを収集します\n')

    jockeys = {}
    for i, (race_id, race_name) in enumerate(races, 1):
        print(f'[{i}/{len(races)}] {race_name} 走査中... ', end='', flush=True)
        try:
            html = fetch_html(f'https://race.netkeiba.com/race/result.html?race_id={race_id}', 'utf-8')
            race_data = parse_full_race(html)
            for horse in race_data['horses']:
                jid = horse.get('jockey_id')
                if jid:
                    jockeys.setdefault(jid, set()).add(horse['jockey'])
            print(f'OK（累計{len(jockeys)}名）')
        except Exception as e:
            print(f'エラー: {e}')
        time.sleep(REQUEST_INTERVAL_SEC)

    for jid, short in KNOWN_BAD_LINKS:
        jockeys.get(jid, set()).discard(short)

    return jockeys


def resolve_full_names(jockeys: dict) -> dict:
    """jockey_id -> {'shorts':[...], 'full':...} の辞書を作る"""
    result = {}
    total = len(jockeys)
    for i, (jid, short_names) in enumerate(jockeys.items(), 1):
        sample = sorted(short_names)[0]
        print(f'[{i}/{total}] ID {jid}（{sample}）のプロフィール取得中... ', end='', flush=True)
        try:
            html = fetch_html(f'https://db.netkeiba.com/jockey/{jid}/', 'euc-jp')
            m = FULL_NAME_PATTERN.search(html)
            full_name = m.group(1).strip() if m else sample
            result[jid] = {'shorts': sorted(short_names), 'full': full_name}
            print(full_name)
        except Exception as e:
            print(f'エラー（短縮名のまま使用）: {e}')
            result[jid] = {'shorts': sorted(short_names), 'full': sample}
        time.sleep(REQUEST_INTERVAL_SEC)

    return result


def main(start_year: int, end_year: int, reuse_full_names: bool = False):
    jockeys = collect_jockeys(start_year, end_year)
    jockeys = {jid: shorts for jid, shorts in jockeys.items() if shorts}

    if reuse_full_names and os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, encoding='utf-8') as f:
            previous = json.load(f)
        resolved = {
            jid: {
                'shorts': sorted(short_names),
                'full': previous.get(jid, {}).get('full', sorted(short_names)[0]),
            }
            for jid, short_names in jockeys.items()
        }
    else:
        resolved = resolve_full_names(jockeys)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(resolved, f, ensure_ascii=False, indent=2)

    print(f'\n完了: {len(resolved)}名分の騎手名を{OUTPUT_PATH}に書き出しました')


if __name__ == '__main__':
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 2016
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
    reuse = '--reuse-full-names' in sys.argv
    main(start, end, reuse_full_names=reuse)
