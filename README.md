# 三频道 YouTube 数据看板（GitHub Pages 静态站）

每天自动抓取 3 个 YouTube 频道（Moonveil Stories / Kimi Audiobooks / Midnight Vows）
的全部视频数据，生成静态 HTML 看板，通过 GitHub Pages 对外分享。

## 文件说明

| 文件 | 作用 |
|---|---|
| `scrape.py` | 用 yt-dlp 抓取三频道数据，输出 `data.json` |
| `template.html` | 看板页面模板（含搜索/排序/展开/中英切换） |
| `build.py` | 把 `data.json` 填入模板，生成 `dist/index.html` |
| `.github/workflows/daily.yml` | GitHub Actions 每日 00:00 UTC（北京时间 8 点）自动运行 |

## 本地运行

```bash
# 建议用虚拟环境
python3 -m venv .venv && source .venv/bin/activate
pip install yt-dlp

# 抓数据（--limit N 每个频道只抓 N 个，用于测试）
python scrape.py --limit 2

# 生成页面
python build.py

# 本地预览
python -m http.server -d dist 8000
# 浏览器打开 http://localhost:8000
```

## 发布到 GitHub Pages

1. 新建公开仓库（例如 `channel-dashboard`），把本目录所有文件推上去。
2. **手动添加 workflow 文件**：GitHub API 禁止程序写入 `.github/workflows/`，
   请在仓库网页端进入 `.github/workflows/` 目录，手动新建 `daily.yml`，
   把本地同名文件的内容粘贴进去并提交。
3. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
4. Actions 页点 **Daily channel dashboard** → **Run workflow** 手动跑一次，
   成功后 Pages 地址即生效（形如 `https://<用户名>.github.io/channel-dashboard/`）。
5. 此后每天北京时间 8 点自动更新，无需人工干预。

## 数据口径

- 数字全部来自 YouTube 公开页面原样呈现，抓不到的字段记为 null，页面显示「—」，不编造。
- 爆款 🔥：同频道播放量前 3 且 ≥1000 的视频。
- 爆款视频抓前 10 条顶层评论正文（含回复）。
- 反爬：请求间隔 2 秒、失败重试 3 次、桌面 Chrome UA；单次全量抓取约 10–20 分钟。
