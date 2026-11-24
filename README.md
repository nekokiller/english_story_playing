# english_story_playing

英文童話故事台詞播放網頁：每位角色有自己的語音，可以開始播放、暫停，點任何一句台詞就從那一句開始播放。

## 本機預覽

```bash
python3 -m http.server 8000
```

開啟 http://localhost:8000 。（不能直接雙擊 `index.html`，瀏覽器會擋住讀取 JSON。）

指定故事：`http://localhost:8000/?story=monkey_and_crocodile`

## 新增／修改故事

每個故事一個資料夾：

```
story/<id>/
  story.txt     台詞（手寫）
  voices.json   角色 → 語音設定（手寫）
  story.json    ← 由腳本產生
  audio/*.mp3   ← 由腳本產生
```

`story.txt` 格式：

```
04【鱷魚】“I’m hungry,”     ← 有編號：新的一句
  【旁白】he said.           ← 無編號：同一句的下一個片段（換角色）
                             ← 空行：段落分隔
```

產生 JSON 與語音（只會重新產生內容或語音設定有變動的片段）：

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 第一次
.venv/bin/python scripts/build_story.py --tts
```

語音使用 [edge-tts](https://github.com/rany2/edge-tts)，可用的聲音：`.venv/bin/edge-tts --list-voices`。

## 操作

- 空白鍵：播放／暫停
- ↑ / ↓：上一句／下一句
- 點台詞：從該句開始播放
