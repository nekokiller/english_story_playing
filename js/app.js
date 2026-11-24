import { StoryPlayer } from './player.js';

const $ = (sel) => document.querySelector(sel);

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const params = new URLSearchParams(location.search);
  let storyId = params.get('story');
  if (!storyId) {
    const index = await loadJSON('story/index.json');
    storyId = index[0]?.id;
  }
  const base = new URL(`story/${encodeURIComponent(storyId)}/`, location.href);
  const story = await loadJSON(new URL('story.json', base));

  render(story);
  const player = new StoryPlayer(story, base);
  wire(player, story);
}

function render(story) {
  document.title = `${story.title}｜英文童話故事播放`;
  $('#title').textContent = story.title;
  $('#title-zh').textContent = story.titleZh;

  const cast = $('#cast');
  for (const role of Object.values(story.roles)) {
    const li = document.createElement('li');
    li.style.setProperty('--role', role.color);
    li.innerHTML = `<span class="emoji">${role.emoji}</span><span>${role.label}</span><span class="en">${role.nameEn}</span>`;
    cast.append(li);
  }

  const script = $('#script');
  let section;
  let lastParagraph = -1;
  story.lines.forEach((line, lineIdx) => {
    if (line.paragraph !== lastParagraph) {
      section = document.createElement('ol');
      section.className = 'paragraph';
      script.append(section);
      lastParagraph = line.paragraph;
    }
    const li = document.createElement('li');
    li.className = 'line';
    li.dataset.line = lineIdx;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `從第 ${line.no} 句開始播放`);

    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = String(line.no).padStart(2, '0');
    li.append(no);

    const body = document.createElement('div');
    body.className = 'body';
    line.segments.forEach((seg, segIdx) => {
      const role = story.roles[seg.role];
      const span = document.createElement('span');
      span.className = `seg role-${seg.role}`;
      span.dataset.seg = segIdx;
      span.style.setProperty('--role', role.color);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${role.emoji} ${role.label}`;
      const text = document.createElement('span');
      text.className = 'text';
      text.lang = 'en';
      text.textContent = seg.text;
      span.append(chip, text);
      body.append(span);
    });
    li.append(body);
    section.append(li);
  });
}

function wire(player, story) {
  const btnPlay = $('#btn-play');
  const label = $('#play-label');
  const lineEls = [...document.querySelectorAll('.line')];
  let currentEl = null;
  let currentSeg = null;

  $('#btn-prev').addEventListener('click', () => player.prev());
  $('#btn-next').addEventListener('click', () => player.next());
  btnPlay.addEventListener('click', () => player.toggle());
  $('#speed').addEventListener('change', (e) => player.setRate(Number(e.target.value)));

  $('#script').addEventListener('click', (e) => {
    const li = e.target.closest('.line');
    if (li) player.playFrom(Number(li.dataset.line));
  });
  $('#script').addEventListener('keydown', (e) => {
    const li = e.target.closest('.line');
    if (li && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      player.playFrom(Number(li.dataset.line));
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target instanceof Element ? e.target : document.body;
    if (t.closest('select, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && !t.closest('button')) { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); player.next(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); player.prev(); }
  });

  const LABELS = { idle: '開始播放', playing: '暫停', paused: '繼續播放', ended: '重新播放' };
  player.addEventListener('statechange', ({ detail: { state } }) => {
    document.body.dataset.state = state;
    label.textContent = LABELS[state];
    btnPlay.setAttribute('aria-pressed', state === 'playing');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : 'paused';
  });
  document.body.dataset.state = 'idle';

  const progressText = $('#progress-text');
  const progressBar = $('#progress-bar');
  const updateProgress = (lineIdx) => {
    progressText.textContent = `第 ${lineIdx + 1} / ${lineEls.length} 句`;
    progressBar.style.width = `${((lineIdx + 1) / lineEls.length) * 100}%`;
  };
  progressText.textContent = `共 ${lineEls.length} 句`;

  player.addEventListener('position', ({ detail: { lineIdx, segIdx } }) => {
    const el = lineEls[lineIdx];
    if (el !== currentEl) {
      currentEl?.classList.remove('current');
      lineEls.forEach((l, i) => l.classList.toggle('played', i < lineIdx));
      el.classList.add('current');
      currentEl = el;
      scrollIntoViewIfNeeded(el);
    }
    currentSeg?.classList.remove('speaking');
    currentSeg = el.querySelector(`.seg[data-seg="${segIdx}"]`);
    currentSeg.classList.add('speaking');
    updateProgress(lineIdx);
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: story.title, artist: 'English Story Time' });
    navigator.mediaSession.setActionHandler('play', () => player.play());
    navigator.mediaSession.setActionHandler('pause', () => player.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => player.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => player.next());
  }
}

function scrollIntoViewIfNeeded(el) {
  const top = document.querySelector('.controls').getBoundingClientRect().bottom;
  const r = el.getBoundingClientRect();
  if (r.top < top + 8 || r.bottom > window.innerHeight - 8) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

main().catch((err) => {
  console.error(err);
  $('#title').textContent = '故事載入失敗';
  $('#script').innerHTML = `<p class="error">${err.message}<br>請用本機伺服器開啟（例如 <code>python3 -m http.server</code>），不要直接雙擊 HTML 檔。</p>`;
});
