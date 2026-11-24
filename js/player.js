// 故事播放器：把所有片段攤平成一條佇列，用單一 <audio> 依序播放。
// 狀態：idle（未開始）→ playing ⇄ paused → ended
// 事件：statechange { state }、position { lineIdx, segIdx }

const GAP_SEGMENT = 150;    // 同一句內片段之間（ms）
const GAP_LINE = 450;       // 句與句之間
const GAP_PARAGRAPH = 1000; // 段落之間

export class StoryPlayer extends EventTarget {
  constructor(story, baseUrl) {
    super();
    this.queue = [];
    this.lineStart = []; // 每一句第一個片段在 queue 中的位置
    story.lines.forEach((line, lineIdx) => {
      this.lineStart.push(this.queue.length);
      line.segments.forEach((seg, segIdx) => {
        this.queue.push({ lineIdx, segIdx, paragraph: line.paragraph, ...seg, src: new URL(seg.audio, baseUrl).href });
      });
    });
    this.lineCount = story.lines.length;
    this.state = 'idle';
    this.index = 0;
    this.rate = 1;

    this._token = 0;          // 每次換片段就 +1，讓過期的回呼失效
    this._gapTimer = null;
    this._gapNext = null;     // 停頓中要接著播的片段（暫停時保留）
    this._ttsActive = false;  // 這個片段是否改用瀏覽器 TTS（找不到 MP3 時的備援）

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this._onSegmentEnd(this._token));
    this.audio.addEventListener('error', () => {
      if (this.state === 'playing' && !this._ttsActive && this.audio.getAttribute('src')) this._speak(this._token);
    });
    this._preloader = new Audio();
    this._preloader.preload = 'auto';
  }

  get current() { return this.queue[this.index]; }
  get lineIdx() { return this.current.lineIdx; }

  play() {
    if (this.state === 'playing') return;
    if (this.state === 'ended') { this.index = 0; return this._start(); }
    if (this.state === 'paused') {
      if (this._gapNext !== null) { this.index = this._gapNext; this._gapNext = null; return this._start(); }
      if (this._ttsActive || !this._audioReadyFor(this.current)) return this._start(); // TTS 無法續播，從片段開頭重來
      this._setState('playing');
      this.audio.play().catch(() => this._start());
      return;
    }
    this._start();
  }

  pause() {
    if (this.state !== 'playing') return;
    clearTimeout(this._gapTimer);
    this.audio.pause();
    if (this._ttsActive) { this._token++; speechSynthesis.cancel(); }
    this._setState('paused');
  }

  toggle() { this.state === 'playing' ? this.pause() : this.play(); }

  /** 從第 lineIdx 句（0 起算）開始播放 */
  playFrom(lineIdx) {
    lineIdx = Math.max(0, Math.min(this.lineCount - 1, lineIdx));
    this._stopAll();
    this.index = this.lineStart[lineIdx];
    this._start();
  }

  next() { this.playFrom(this.lineIdx + 1); }
  prev() { this.playFrom(this.lineIdx - 1); }

  setRate(rate) {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }

  // ---- 內部 ----

  _start() {
    this._stopAll();
    const token = ++this._token;
    const seg = this.current;
    this._ttsActive = false;
    this._setState('playing');
    this._emitPosition();
    this.audio.src = seg.src;
    this.audio.playbackRate = this.rate;
    this.audio.play().catch((err) => {
      if (token !== this._token) return;
      if (err.name === 'NotAllowedError') { this._setState('paused'); return; } // 瀏覽器擋自動播放
      if (err.name !== 'AbortError' && !this._ttsActive) this._speak(token);
    });
    const next = this.queue[this.index + 1];
    if (next) this._preloader.src = next.src;
  }

  _onSegmentEnd(token) {
    if (token !== this._token || this.state !== 'playing') return;
    const cur = this.current;
    const next = this.queue[this.index + 1];
    if (!next) {
      this._ttsActive = false;
      this._setState('ended');
      return;
    }
    const gap = next.lineIdx === cur.lineIdx ? GAP_SEGMENT
      : next.paragraph === cur.paragraph ? GAP_LINE : GAP_PARAGRAPH;
    this._gapNext = this.index + 1;
    this._gapTimer = setTimeout(() => {
      if (token !== this._token || this.state !== 'playing') return;
      this.index = this._gapNext;
      this._gapNext = null;
      this._start();
    }, gap / this.rate);
  }

  _speak(token) {
    if (!('speechSynthesis' in window)) { this._onSegmentEnd(token); return; }
    this._ttsActive = true;
    const u = new SpeechSynthesisUtterance(this.current.text.replace(/[“”]/g, '"'));
    u.lang = 'en-US';
    u.rate = this.rate;
    u.onend = () => this._onSegmentEnd(token);
    u.onerror = () => this._onSegmentEnd(token);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  _stopAll() {
    clearTimeout(this._gapTimer);
    this._gapNext = null;
    this.audio.pause();
    if (this._ttsActive) speechSynthesis.cancel();
    this._token++;
  }

  _audioReadyFor(seg) {
    return this.audio.src === seg.src && !this.audio.ended && this.audio.readyState > 0;
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state } }));
  }

  _emitPosition() {
    const { lineIdx, segIdx } = this.current;
    this.dispatchEvent(new CustomEvent('position', { detail: { lineIdx, segIdx } }));
  }
}
