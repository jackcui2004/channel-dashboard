#!/usr/bin/env python3
"""
合并 data.json 与 template.html，生成最终 index.html。

用法:
    python build.py                      # 读取 data.json + template.html -> dist/index.html
    python build.py --data d.json --template t.html --out index.html
"""

import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data.json")
    ap.add_argument("--template", default="template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    for p in (args.data, args.template):
        if not os.path.exists(p):
            print(f"[error] 找不到文件: {p}", file=sys.stderr)
            sys.exit(1)

    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)
    with open(args.template, encoding="utf-8") as f:
        tpl = f.read()

    if "__DATA_JSON__" not in tpl:
        print("[error] 模板缺少 __DATA_JSON__ 占位符", file=sys.stderr)
        sys.exit(1)

    data_json = json.dumps(data, ensure_ascii=False)
    # 防止 </script> 出现在数据里破坏页面
    data_json = data_json.replace("</script>", "<\\/script>")
    html = tpl.replace("__DATA_JSON__", data_json)
    html = html.replace("__UPDATED_AT__", str(data.get("updated_at", "—")))

    outdir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(outdir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    n_videos = sum(len(c.get("videos", [])) for c in data.get("channels", []))
    print(f"[info] 生成 {args.out}（{len(html)/1024:.1f} KB，{n_videos} 个视频）")


if __name__ == "__main__":
    main()
