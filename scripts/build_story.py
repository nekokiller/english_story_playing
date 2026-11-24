#!/usr/bin/env python3
"""把 story/<id>/story.txt 解析成 story.json，並（可選）用 edge-tts 產生每個片段的 MP3。

用法：
    .venv/bin/python scripts/build_story.py                 # 所有故事，只產生 JSON
    .venv/bin/python scripts/build_story.py --tts           # 同時產生缺少／過期的 MP3
    .venv/bin/python scripts/build_story.py monkey_and_crocodile --tts --force

story.txt 格式：
    04【鱷魚】“I’m hungry,”      ← 有編號：新的一句（可點擊的單位）
      【旁白】he said.            ← 無編號：同一句的下一個片段
    （空行）                       ← 段落分隔
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORY_DIR = ROOT / "story"
LINE_RE = re.compile(r"^\s*(\d+)?\s*【(.+?)】\s*(.*?)\s*$")
MANIFEST = ".manifest.json"


def parse_story(txt_path: Path, roles: dict) -> list[dict]:
    lines: list[dict] = []
    paragraph = 0
    pending_break = False
    for lineno, raw in enumerate(txt_path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            if lines:
                pending_break = True
            continue
        m = LINE_RE.match(raw)
        if not m:
            sys.exit(f"{txt_path}:{lineno}: 無法解析：{raw!r}")
        no, role_label, text = m.groups()
        if role_label not in roles:
            sys.exit(f"{txt_path}:{lineno}: voices.json 沒有定義角色「{role_label}」")
        if not text:
            sys.exit(f"{txt_path}:{lineno}: 台詞是空的")
        if no is not None:
            if pending_break:
                paragraph += 1
                pending_break = False
            lines.append({"no": int(no), "paragraph": paragraph, "segments": []})
        elif not lines:
            sys.exit(f"{txt_path}:{lineno}: 第一行必須有編號")
        line = lines[-1]
        seg_idx = len(line["segments"]) + 1
        line["segments"].append({
            "role": roles[role_label]["id"],
            "text": text,
            "audio": f"audio/{line['no']:02d}-{seg_idx}.mp3",
        })
    return lines


def tts_key(role: dict, text: str) -> str:
    raw = json.dumps([role["voice"], role.get("rate", "+0%"), role.get("pitch", "+0Hz"), text],
                     ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


async def synthesize(jobs: list[tuple[Path, dict, str]], concurrency: int = 4) -> None:
    import edge_tts

    sem = asyncio.Semaphore(concurrency)

    async def one(out: Path, role: dict, text: str) -> None:
        async with sem:
            for attempt in range(1, 4):
                try:
                    tmp = out.with_suffix(".tmp")
                    await edge_tts.Communicate(
                        text, role["voice"],
                        rate=role.get("rate", "+0%"), pitch=role.get("pitch", "+0Hz"),
                    ).save(str(tmp))
                    tmp.replace(out)
                    print(f"  ✓ {out.name}  [{role['id']}] {text}")
                    return
                except Exception as e:  # 網路錯誤時重試
                    if attempt == 3:
                        raise RuntimeError(f"{out.name} 產生失敗：{e}") from e
                    await asyncio.sleep(1.5 * attempt)

    await asyncio.gather(*(one(*j) for j in jobs))


def build(story_id: str, tts: bool, force: bool) -> dict:
    d = STORY_DIR / story_id
    cfg = json.loads((d / "voices.json").read_text(encoding="utf-8"))
    roles = cfg["roles"]
    lines = parse_story(d / "story.txt", roles)
    by_id = {r["id"]: r for r in roles.values()}

    story = {
        "id": story_id,
        "title": cfg.get("title", story_id),
        "titleZh": cfg.get("titleZh", ""),
        "roles": {
            r["id"]: {"label": label, "nameEn": r.get("nameEn", ""), "emoji": r.get("emoji", ""),
                      "color": r.get("color", "#64748b"), "voice": r["voice"]}
            for label, r in roles.items()
        },
        "lines": lines,
    }
    (d / "story.json").write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_seg = sum(len(l["segments"]) for l in lines)
    print(f"{story_id}: {len(lines)} 句、{n_seg} 個片段 → story.json")

    if tts:
        audio_dir = d / "audio"
        audio_dir.mkdir(exist_ok=True)
        mpath = audio_dir / MANIFEST
        manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
        jobs, new_manifest = [], {}
        for line in lines:
            for seg in line["segments"]:
                out = d / seg["audio"]
                key = tts_key(by_id[seg["role"]], seg["text"])
                new_manifest[out.name] = key
                if force or not out.exists() or manifest.get(out.name) != key:
                    jobs.append((out, by_id[seg["role"]], seg["text"]))
        print(f"  需要產生 {len(jobs)} 個 MP3（其餘 {n_seg - len(jobs)} 個沒有變動）")
        if jobs:
            asyncio.run(synthesize(jobs))
        for f in audio_dir.glob("*.mp3"):  # 清掉已不再使用的檔案
            if f.name not in new_manifest:
                f.unlink()
                print(f"  🗑 移除過期檔案 {f.name}")
        mpath.write_text(json.dumps(new_manifest, indent=2, sort_keys=True) + "\n")

    return {"id": story_id, "title": story["title"], "titleZh": story["titleZh"]}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stories", nargs="*", help="故事資料夾名稱（預設：全部）")
    ap.add_argument("--tts", action="store_true", help="產生缺少或內容有變動的 MP3")
    ap.add_argument("--force", action="store_true", help="搭配 --tts：全部重新產生")
    args = ap.parse_args()

    all_ids = sorted(p.parent.name for p in STORY_DIR.glob("*/story.txt") if (p.parent / "voices.json").exists())
    for sid in args.stories:
        if sid not in all_ids:
            sys.exit(f"找不到故事：{sid}（需要 story/{sid}/story.txt 與 voices.json）")
    for sid in args.stories or all_ids:
        build(sid, args.tts, args.force)

    # 故事清單（首頁用）一律以全部故事重建
    index = []
    for sid in all_ids:
        cfg = json.loads((STORY_DIR / sid / "voices.json").read_text(encoding="utf-8"))
        index.append({"id": sid, "title": cfg.get("title", sid), "titleZh": cfg.get("titleZh", "")})
    (STORY_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
