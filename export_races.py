import json
import os

import gspread
from google.oauth2.service_account import Credentials

SHEET_ID = '1Tr7D8-qsGrNDwZH_m-0vCGGIa6NRM4DyaQWSA21ZDhM'
WORKSHEET_NAME = 'G1データ'
CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'keiba', 'credentials.json')
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'races.json')
JOCKEY_NAMES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'jockey_names.json')

MAX_HORSES = 18


def _load_jockey_name_map() -> dict:
    """resolve_jockey_names.pyが生成した短縮名→正式名の辞書を読み込む（未生成なら空）"""
    if not os.path.exists(JOCKEY_NAMES_PATH):
        return {}
    with open(JOCKEY_NAMES_PATH, encoding='utf-8') as f:
        resolved = json.load(f)
    mapping = {}
    for entry in resolved.values():
        for short_name in entry['shorts']:
            mapping[short_name] = entry['full']
    return mapping


def _connect_sheet():
    scopes = ['https://spreadsheets.google.com/feeds',
              'https://www.googleapis.com/auth/drive']
    creds = Credentials.from_service_account_file(CREDS_FILE, scopes=scopes)
    gc = gspread.authorize(creds)
    return gc.open_by_key(SHEET_ID).worksheet(WORKSHEET_NAME)


def _horse_prefix(position: int) -> str:
    return 'winner' if position == 1 else f'horse{position}'


def _to_number(text: str):
    if text == '':
        return None
    try:
        if '.' in text:
            return float(text)
        return int(text)
    except ValueError:
        return text


def row_to_race(header: list, row: dict, jockey_names: dict) -> dict:
    horses = []
    for position in range(1, MAX_HORSES + 1):
        prefix = _horse_prefix(position)
        number = row.get(f'{prefix}_number', '')
        if number == '':
            break
        short_jockey = row.get(f'{prefix}_jockey', '')
        horses.append({
            'position': position,
            'number': _to_number(number),
            'name': row.get(f'{prefix}_name', ''),
            'jockey': jockey_names.get(short_jockey, short_jockey),
            'odds': _to_number(row.get(f'{prefix}_odds', '')),
            'popularity': _to_number(row.get(f'{prefix}_popularity', '')),
        })

    return {
        'race_name': row.get('race_name', ''),
        'year': _to_number(row.get('year', '')),
        'venue': row.get('venue', ''),
        'track': row.get('track', ''),
        'horses': horses,
    }


def main():
    jockey_names = _load_jockey_name_map()
    if not jockey_names:
        print('警告: jockey_names.jsonが見つからないため、騎手名は短縮表示のまま出力します')

    ws = _connect_sheet()
    values = ws.get_all_values()
    header = values[0]

    races = []
    for raw_row in values[1:]:
        row = dict(zip(header, raw_row))
        races.append(row_to_race(header, row, jockey_names))

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(races, f, ensure_ascii=False, indent=2)

    print(f'{len(races)}件のレースを{OUTPUT_PATH}に書き出しました')


if __name__ == '__main__':
    main()
