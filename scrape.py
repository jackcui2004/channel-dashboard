#!/usr/bin/env python3
"""
三频道 YouTube 数据抓取脚本（yt-dlp）

抓取三个频道的全部视频数据，输出 data.json。
用法:
    python scrape.py                  # 全量抓取
    python scrape.py --limit 2        # 每个频道只抓前 2 个视频（测试用）
    python scrape.py --out data.json  # 指定输出文件

字段缺失时记为 null，绝不编造数字。
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone, timedelta

import yt_dlp

CHANNELS = [
    {
        "id": "moonveilstories",
        "name": "Moonveil Stories",
        "url": "https://www.youtube.com/@moonveilstories-h1/videos",
    },
    {
        "id": "kimiaudiobooks",
        "name": "Kimi Audiobooks",
        "url": "https://www.youtube.com/@kimiaudiobooks/videos",
    },
    {
        "id": "midnightvowstales",
        "name": "Midnight Vows",
        "url": "https://www.youtube.com/@midnightvowstales/videos",
    },
]

# 反爬：请求间隔与重试
BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "sleep_interval": 2,          # 每次请求间隔 2 秒
    "max_sleep_interval": 5,
    "retries": 3,
    "fragment_retries": 3,
    # 伪装成桌面 Chrome，降低被风控概率
    "user_agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    # 绕过 "Sign in to confirm you're not a bot"：优先用 android 客户端
    "extractor_args": {"youtube": {"player_client": ["android", "web_embedded"]}},
}


def fmt_duration(seconds):
    """秒数 -> H:MM:SS，缺失返回 None"""
    if seconds is None:
        return None
    try:
        s = int(seconds)
    except (TypeError, ValueError):
        return None
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}"


def fmt_date(yyyymmdd):
    """YYYYMMDD -> YYYY-MM-DD，缺失返回 None"""
    if not yyyymmdd:
        return None
    s = str(yyyymmdd)
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return None


def safe_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def list_channel_videos(ydl, channel_url, limit=None):
    """扁平抓取频道视频列表，返回 [(video_id, title, flat_data)]，flat_data 含播放量等兜底字段"""
    opts = dict(BASE_OPTS)
    opts["extract_flat"] = True
    # flat 模式下也分页取全
    opts["playlistend"] = limit
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(channel_url, download=False)
    entries = info.get("entries") or []
    videos = []
    for e in entries:
        if not e:
            continue
        vid = e.get("id")
        if vid:
            # flat 条目里可能自带 view_count（"1.2K views" 已被 yt-dlp 解析为数字）
            # 留作详情页抓不到时的兜底
            flat = {
                "views": safe_int(e.get("view_count")),
                "duration": fmt_duration(e.get("duration")),
                "published": fmt_date(e.get("upload_date")),
            }
            videos.append({"id": vid, "title": e.get("title"), "flat": flat})
    subs = safe_int(info.get("channel_follower_count"))
    return videos, subs


def fetch_video_detail(ydl, video_id, fetch_comments=False, flat_fallback=None):
    """抓取单个视频详情；fetch_comments=True 时抓前 10 条顶层评论"""
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = dict(BASE_OPTS)
    if fetch_comments:
        opts["getcomments"] = True
        # max_comments, max_parents, max_replies, all（与 BASE 的 player_client 合并）
        yt_args = dict(opts.get("extractor_args", {}).get("youtube", {}))
        yt_args["max_comments"] = ["10", "10", "5", "10"]
        opts["extractor_args"] = {"youtube": yt_args}
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=False)
    except Exception as exc:  # noqa: BLE001 - 单个视频失败不中断整体
        print(f"[warn] 视频 {video_id} 抓取失败: {exc}", file=sys.stderr)
        return None
    if not info:
        return None

    data = {
        "id": video_id,
        "title": info.get("title"),
        "views": safe_int(info.get("view_count")),
        "likes": safe_int(info.get("like_count")),
        "comments": safe_int(info.get("comment_count")),
        "comments_text": [],
        "duration": fmt_duration(info.get("duration")),
        "published": fmt_date(info.get("upload_date")),
        "description": info.get("description"),
        "tags": info.get("tags") or [],
        "hot": False,
    }

    if fetch_comments:
        data["comments_text"] = parse_comments(info.get("comments") or [])
    return data


def parse_comments(raw_comments):
    """yt-dlp 评论展平结构 -> 顶层 + replies 嵌套"""
    tops = {}
    order = []
    for c in raw_comments:
        cid = c.get("id")
        if not cid or cid in tops:
            continue
        item = {
            "author": c.get("author"),
            "text": c.get("text"),
            "likes": safe_int(c.get("like_count")),
            "time": c.get("timestamp"),
            "replies": [],
        }
        parent = c.get("parent")
        if parent and parent != "root" and parent in tops:
            tops[parent]["replies"].append(item)
        else:
            tops[cid] = item
            order.append(cid)
            if len(order) >= 10:
                # 顶层评论够 10 条后仍需继续扫一遍以便挂载回复
                pass
    # 只保留前 10 条顶层
    result = [tops[cid] for cid in order[:10]]
    # timestamp -> 可读时间
    for item in result:
        item["time"] = fmt_ts(item["time"])
        for r in item["replies"]:
            r["time"] = fmt_ts(r["time"])
    return result


def fmt_ts(ts):
    if ts is None:
        return None
    try:
        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc).astimezone(
            timezone(timedelta(hours=8))
        )
        return dt.strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OSError):
        return None


def mark_hot(videos):
    """同频道播放前 3 且 >=1000 的标爆款"""
    ranked = sorted(
        [v for v in videos if isinstance(v.get("views"), int)],
        key=lambda v: v["views"],
        reverse=True,
    )
    for v in ranked[:3]:
        if v["views"] >= 1000:
            v["hot"] = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="每个频道只抓前 N 个视频（测试用）")
    ap.add_argument("--out", default="data.json", help="输出文件路径")
    ap.add_argument("--skip-comments", action="store_true", help="跳过评论抓取（更快）")
    args = ap.parse_args()

    bj = timezone(timedelta(hours=8))
    now = datetime.now(tz=bj).isoformat(timespec="seconds")
    result = {"updated_at": now, "channels": []}

    ydl = yt_dlp.YoutubeDL(BASE_OPTS)
    total_start = time.time()

    for ch in CHANNELS:
        print(f"[info] 抓取频道 {ch['name']} ...")
        try:
            video_list, subs = list_channel_videos(ydl, ch["url"], limit=args.limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[error] 频道 {ch['id']} 列表抓取失败: {exc}", file=sys.stderr)
            result["channels"].append(
                {"id": ch["id"], "name": ch["name"], "url": ch["url"],
                 "subs": None, "videos": [], "error": str(exc)}
            )
            continue

        print(f"[info] {ch['name']}: {len(video_list)} 个视频，订阅 {subs}")
        videos = []
        for i, v in enumerate(video_list):
            # 先抓详情（不带评论），用于判定爆款；flat 数据作兜底
            detail = fetch_video_detail(ydl, v["id"], fetch_comments=False,
                                        flat_fallback=v.get("flat"))
            if detail is None:
                detail = {"id": v["id"], "title": v.get("title"), "views": None,
                          "likes": None, "comments": None, "comments_text": [],
                          "duration": None, "published": None,
                          "description": None, "tags": [], "hot": False,
                          "error": "detail_fetch_failed"}
            # flat 兜底：详情页没抓到的字段用列表页数据补
            flat = v.get("flat") or {}
            for k in ("views", "duration", "published"):
                if detail.get(k) is None and flat.get(k) is not None:
                    detail[k] = flat[k]
            videos.append(detail)
            print(f"  [{i+1}/{len(video_list)}] {detail['id']} views={detail['views']}")

        mark_hot(videos)

        if not args.skip_comments:
            # 所有视频都抓评论正文（不再只限爆款），与第一版看板数据口径一致
            print(f"[info] {ch['name']}: {len(videos)} 个视频，逐个抓评论...")
            for v in videos:
                vid = v["id"]
                # 已有评论数的才抓，无评论的跳过
                if v.get("comments") == 0:
                    continue
                detail = fetch_video_detail(ydl, vid, fetch_comments=True)
                if detail and detail.get("comments_text"):
                    v["comments_text"] = detail["comments_text"]
                    print(f"  评论 {vid}: {len(detail['comments_text'])} 条顶层")
                time.sleep(1)  # 评论接口限流保护

        result["channels"].append({
            "id": ch["id"],
            "name": ch["name"],
            "url": ch["url"],
            "subs": subs,
            "videos": videos,
        })

    elapsed = time.time() - total_start
    print(f"[info] 完成，用时 {elapsed/60:.1f} 分钟")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"[info] 已写入 {args.out}")


if __name__ == "__main__":
    main()
