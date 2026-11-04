#!/bin/bash
# 每小时抓取三频道数据并推送到 GitHub（GitHub API，无需人工确认）
set -e
cd ~/workspace/channel-dashboard
TOKEN=$(cat .api_token)
# 抓取
python3 scrape.py --out data.json 2>&1 | tail -3
# 用 GitHub API 更新 data.json
SHA=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/jackcui2004/channel-dashboard/contents/data.json?ref=main" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sha',''))")
DATE=$(date +%Y-%m-%d_%H:%M)
python3 - << PYEOF
import json, base64
content = open('data.json','rb').read()
payload = {
    "message": "每小时数据更新 $DATE",
    "content": base64.b64encode(content).decode(),
    "sha": "$SHA",
    "branch": "main"
}
json.dump(payload, open('/tmp/api_payload.json','w'))
PYEOF
PUSH_RESULT=$(curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  --data @/tmp/api_payload.json \
  "https://api.github.com/repos/jackcui2004/channel-dashboard/contents/data.json")
echo "$PUSH_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); c=d.get('commit'); print('推送:', c.get('sha')[:12] if c else d.get('message','失败'))"
# 触发 Pages 构建工作流（API push 不会自动触发）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  --data '{"ref":"main"}' \
  "https://api.github.com/repos/jackcui2004/channel-dashboard/actions/workflows/daily.yml/dispatches" > /dev/null
echo "已触发 Pages 构建"
echo "完成"
