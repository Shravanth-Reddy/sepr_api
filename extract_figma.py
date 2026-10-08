import requests
import json
import os

token1 = os.getenv("FIGMA_TOKEN_1", "")
token2 = os.getenv("FIGMA_TOKEN_2", "")

files = [
    ('file1_raw', '2WDYjAuOFZ3Zt1ScPwPTmA', token1),
    ('file2_exec_audit', 'PcxabVv8Y4EKeT6yPZ3ZvB', token1),
    ('file3_planner_plant', '52iSQHutUQLLl9QWQlKYWf', token2)
]

os.makedirs('figma_dumps', exist_ok=True)

for label, file_key, token in files:
    if not token:
        continue
    url = f'https://api.figma.com/v1/files/{file_key}'
    resp = requests.get(url, headers={'X-Figma-Token': token})
    print(f'=== {label} ({file_key}) ===')
    print('HTTP Status:', resp.status_code)
    if resp.status_code == 200:
        data = resp.json()
        out_path = f'figma_dumps/{label}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
