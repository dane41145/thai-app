// Class Pals: learn which Thai consonants are High, Mid or Low class.
// Letter data comes from thai-letters.js, speech from audio.js (/speak).
// Letters are always spoken from their `say` spelling (กอ ไก่), never the bare
// consonant, which Azure reads unpredictably (it skips ฉ, reads ซ as สาม…).

const CLASS_ORDER = ['HC', 'MC', 'LC'];  // left-to-right, and high-to-low on screen
const CLASS_INFO = {
    HC: { name: 'High', thai: 'อักษรสูง', short: 'สูง', color: '#a970ff', dark: '#6f35d6' },
    MC: { name: 'Mid', thai: 'อักษรกลาง', short: 'กลาง', color: '#ffb52e', dark: '#d98500' },
    LC: { name: 'Low', thai: 'อักษรต่ำ', short: 'ต่ำ', color: '#38b6ff', dark: '#0a84d0' },
};

const BY_LETTER = Object.fromEntries(THAI_LETTERS.map(l => [l.letter, l]));
const letters = chars => [...chars].map(c => BY_LETTER[c]);

// The two classic memory sentences. Each word holds one letter of the class.
const SENTENCES = {
    MC: {
        icon: '🐔', thai: 'ไก่จิกเด็กตายบนปากโอ่ง', en: '“The chicken pecked the kid on the rim of the jar”',
        words: [['ไก่', 'ก'], ['จิก', 'จ'], ['เด็ก', 'ด'], ['ตาย', 'ต'], ['บน', 'บ'], ['ปาก', 'ป'], ['โอ่ง', 'อ']],
    },
    HC: {
        icon: '👻', thai: 'ผีฝากถุงข้าวสารให้ฉัน', en: '“A ghost left a bag of rice with me”',
        words: [['ผี', 'ผ'], ['ฝาก', 'ฝ'], ['ถุง', 'ถ'], ['ข้าว', 'ข'], ['สาร', 'ส'], ['ให้', 'ห'], ['ฉัน', 'ฉ']],
    },
};
const IN_SENTENCE = new Set(Object.values(SENTENCES).flatMap(s => s.words.map(w => w[1])));
// Rare letters that share a sound (and so a class) with a sentence letter.
const COPYCATS = { 'ฎ': 'ด', 'ฏ': 'ต', 'ฐ': 'ถ', 'ศ': 'ส', 'ษ': 'ส', 'ฃ': 'ข' };
// High letters and the Low letter that makes the same sound.
const TWIN_PAIRS = [['ข', 'ค'], ['ฉ', 'ช'], ['ถ', 'ท'], ['ผ', 'พ'], ['ฝ', 'ฟ'], ['ส', 'ซ'], ['ห', 'ฮ']];
const TWIN = {};
TWIN_PAIRS.forEach(([hi, lo]) => { TWIN[hi] = lo; TWIN[lo] = hi; });

const MID7 = 'กจดตบปอ';
const HIGH7 = 'ผฝถขสหฉ';
const COMMON_LOW = 'คงชซทธนพฟมยรลวฮ';
const RARE = 'ฃฅฆฌญฎฏฐฑฒณศษภฬ';

const LEVELS = [
    { id: 'chicken', icon: '🐔', name: 'Chicken Sentence', sub: 'Meet the Mid letters', awake: ['MC', 'LC'],
      build: () => [...letters(MID7), ...sample(letters(COMMON_LOW), 7)], intro: introChicken },
    { id: 'ghost', icon: '👻', name: 'Ghost Sentence', sub: 'Meet the High letters', awake: CLASS_ORDER,
      build: () => [...letters(HIGH7), ...sample(letters(MID7), 4), ...sample(letters(COMMON_LOW), 4)], intro: introGhost },
    { id: 'twins', icon: '👯', name: 'Sound Twins', sub: 'Same sound, different pal', awake: ['HC', 'LC'],
      build: () => letters(TWIN_PAIRS.flat().join('')), intro: introTwins },
    { id: 'rare', icon: '🦄', name: 'Rare & Copycats', sub: 'The tricky ones', awake: CLASS_ORDER,
      build: () => letters(RARE), intro: introRare },
    { id: 'mixed', icon: '🎲', name: 'Mixed Bag', sub: 'All 44 letters', awake: CLASS_ORDER,
      build: () => CLASS_ORDER.flatMap(c => sample(THAI_LETTERS.filter(l => l.letterClass === c), 8)), intro: introMixed },
    { id: 'rush', icon: '⚡', name: 'Letter Rush', sub: 'Sort them before they land!', awake: CLASS_ORDER, rush: true,
      intro: introRush },
];

const MAX_HEARTS = 3;
const STICKER_STREAK = 3;  // right this many times in a row → sticker
const FEVER_STREAK = 5;
const RUSH_STARS = [10, 20, 35];  // letters sorted for 1/2/3 stars
const PRAISE = ['เก่งมาก! Great!', 'ถูกต้อง! Correct!', 'สุดยอด! Awesome!', 'Nice one! 🎉', 'เยี่ยม! Perfect!'];

// -------------------------------------------------------------- save data ----

const SAVE_KEY = 'classPalsSave';
const save = loadSave();
function loadSave() {
    const blank = { stars: {}, streak: {}, stickers: [], rushBest: 0 };
    try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (s && typeof s === 'object') return { ...blank, ...s };
    } catch (e) { /* fall through */ }
    return blank;
}
function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* best-effort */ }
}
function unlocked(i) {
    return i === 0 || (save.stars[LEVELS[i - 1].id] || 0) >= 1;
}

// ------------------------------------------------------------------- pals ----

// A cartoon blob per class, standing on its home (cloud / hill / water).
// Moods are toggled with .happy / .sad / .asleep on the wrapping .pal element.
function palSVG(cls) {
    const c = CLASS_INFO[cls];
    const ink = '#2b2140';
    const home = {
        HC: `<g class="home"><path d="M14 118 q-8-14 8-18 q2-14 18-10 q8-12 22-6 q14-8 22 4 q16-2 16 12 q14 4 6 18 Z" fill="#fff" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/></g>`,
        MC: `<g class="home"><path d="M6 124 Q60 88 114 124 Z" fill="#6dd36a" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M30 110 l3-7 l3 7 M84 110 l3-7 l3 7" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/></g>`,
        LC: `<g class="home"><path d="M4 124 V108 q10-8 19 0 t19 0 t19 0 t19 0 t19 0 t19 0 V124 Z" fill="#7fd6ff" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/></g>`,
    }[cls];
    const extra = {
        // little wings: High class flies
        HC: `<ellipse cx="18" cy="66" rx="13" ry="8" transform="rotate(-25 18 66)" fill="#fff" stroke="${ink}" stroke-width="4"/>
             <ellipse cx="102" cy="66" rx="13" ry="8" transform="rotate(25 102 66)" fill="#fff" stroke="${ink}" stroke-width="4"/>`,
        // a sprout: Mid class grows on the hill
        MC: `<path d="M60 26 V12" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
             <path d="M60 14 q-14-10-18 2 q10 6 18-2Z M60 14 q14-10 18 2 q-10 6-18-2Z" fill="#6dd36a" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`,
        // bubbles: Low class lives in the water
        LC: `<circle class="bubble1" cx="100" cy="30" r="5" fill="#dff4ff" stroke="${ink}" stroke-width="3"/>
             <circle class="bubble2" cx="110" cy="16" r="3.5" fill="#dff4ff" stroke="${ink}" stroke-width="2.5"/>`,
    }[cls];
    return `
    <svg viewBox="0 0 120 130" aria-hidden="true">
      ${home}
      <g class="body-g">
        ${extra}
        <path d="M22 78 C20 44 42 26 60 26 C78 26 100 44 98 78 C97 100 82 108 60 108 C38 108 23 100 22 78Z"
              fill="${c.color}" stroke="${ink}" stroke-width="4"/>
        <ellipse cx="44" cy="44" rx="10" ry="6" fill="#fff" opacity=".35" transform="rotate(-30 44 44)"/>
        <g class="eyes-open">
          <circle cx="47" cy="66" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/>
          <circle cx="73" cy="66" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/>
          <circle class="pupil" cx="49" cy="67" r="4.5" fill="${ink}"/>
          <circle class="pupil" cx="75" cy="67" r="4.5" fill="${ink}"/>
        </g>
        <g class="eyes-happy" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round">
          <path d="M39 68 Q47 58 55 68"/><path d="M65 68 Q73 58 81 68"/>
        </g>
        <g class="eyes-sad" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round">
          <path d="M39 64 Q47 70 55 64"/><path d="M65 64 Q73 70 81 64"/>
          <path d="M84 72 q-4 8 0 10 q4-2 0-10Z" fill="#7fd6ff" stroke-width="2.5"/>
        </g>
        <g class="eyes-sleep" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round">
          <path d="M40 66 Q47 71 54 66"/><path d="M66 66 Q73 71 80 66"/>
        </g>
        <ellipse cx="35" cy="81" rx="6" ry="4" fill="#ff6f91" opacity=".45"/>
        <ellipse cx="85" cy="81" rx="6" ry="4" fill="#ff6f91" opacity=".45"/>
        <path class="mouth-idle" d="M52 84 Q60 91 68 84" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
        <path class="mouth-happy" d="M47 82 Q60 102 73 82 Z" fill="#b8324f" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>
        <path class="mouth-sad" d="M51 92 Q60 83 69 92" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
        <ellipse class="mouth-sleep" cx="60" cy="88" rx="4" ry="3.5" fill="${ink}"/>
      </g>
      <g class="zzz" fill="${ink}" font-family="Fredoka, sans-serif" font-weight="700">
        <text x="86" y="40" font-size="16">z</text><text x="98" y="26" font-size="20">z</text>
      </g>
    </svg>`;
}

function palStyle(cls) {
    const c = CLASS_INFO[cls];
    return `--pal:${c.color};--pal-dark:${c.dark}`;
}
function palHTML(cls, mood = '') {
    return `<div class="pal pal-${cls} mini ${mood}" style="${palStyle(cls)}">${palSVG(cls)}</div>`;
}

function renderPals(container, { buttons = false, awake = CLASS_ORDER } = {}) {
    container.innerHTML = '';
    CLASS_ORDER.forEach((cls, i) => {
        const c = CLASS_INFO[cls];
        const el = document.createElement(buttons ? 'button' : 'div');
        const asleep = !awake.includes(cls);
        el.className = `pal pal-${cls}${asleep ? ' asleep' : ''}`;
        el.dataset.cls = cls;
        el.setAttribute('style', `${palStyle(cls)};--d:${i * 0.3}s`);  // pals bob out of step
        el.innerHTML = `${palSVG(cls)}<span class="pal-label">${c.name}<small>${c.short}</small></span>`;
        if (buttons) {
            el.disabled = asleep;
            el.setAttribute('aria-label', asleep ? `${c.name} is asleep this level` : `${c.name} class (key ${i + 1})`);
            el.onclick = () => answer(cls);
        }
        container.appendChild(el);
    });
}

// ------------------------------------------------------------------ sound ----

// iOS only lets an <audio> element play without a tap once it has played
// inside one, so the first tap anywhere plays a silent clip on it.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audioPlayer.src = SILENT_WAV;
    audioPlayer.play().catch(() => {});
    sfx(null);  // create/resume the AudioContext inside the gesture too
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

let speakSeq = 0;      // only the most recent speak() request gets to play
let audioWarned = false;
function speak(text) {
    const seq = ++speakSeq;
    fetchAudio(text)
        .then(url => { if (seq === speakSeq) playAudioUrl(url); })
        .catch(() => {
            if (!audioWarned) { audioWarned = true; toast('🔇 Audio is unavailable right now'); }
        });
}
function preload(text) {
    fetchAudio(text).catch(() => {});
}

// Anything with data-say speaks it when tapped: sentence words, letter chips…
document.addEventListener('click', e => {
    const el = e.target.closest('[data-say]');
    if (!el) return;
    unlockAudio();
    speak(el.dataset.say);
    el.classList.remove('boing');
    void el.offsetWidth;  // restart the animation on repeat taps
    el.classList.add('boing');
});

// Tiny synthesized blips, so the game needs no sound files.
let actx = null;
const SFX = {
    good: { wave: 'sine', notes: [[660, 0], [990, 0.09]] },
    bad: { wave: 'triangle', notes: [[240, 0], [170, 0.13]] },
    win: { wave: 'sine', notes: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]] },
    sticker: { wave: 'sine', notes: [[1047, 0], [1319, 0.07], [1568, 0.14], [2093, 0.21]] },
    fever: { wave: 'square', notes: [[392, 0], [523, 0.08], [659, 0.16], [784, 0.24]] },
};
function sfx(kind) {
    try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
        if (!kind) return;
        const { wave, notes } = SFX[kind];
        notes.forEach(([freq, at]) => {
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            const t0 = actx.currentTime + at;
            osc.type = wave;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(wave === 'square' ? 0.06 : 0.2, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
            osc.connect(gain).connect(actx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.3);
        });
    } catch (e) { /* no Web Audio: play silently */ }
}

// ---------------------------------------------------------------- helpers ----

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function sample(arr, n) {
    return shuffle([...arr]).slice(0, n);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function className(cls) {
    return `<b class="c-${cls}">${CLASS_INFO[cls].name}</b>`;
}

function starsHTML(n) {
    return [0, 1, 2].map(i => `<span class="${i < n ? 'lit' : ''}">★</span>`).join('');
}

// A memory sentence as tappable words, each word's class letter coloured.
// `mark` highlights the word holding that letter.
function sentenceHTML(cls, mark = null) {
    const s = SENTENCES[cls];
    const words = s.words.map(([word, letter]) => {
        const shown = word.replace(letter, `<span class="ini">${letter}</span>`);
        return `<button class="word${letter === mark ? ' hl' : ''}" data-say="${word}">${shown}</button>`;
    }).join('');
    return `<div class="sentence c-${cls}-box">
        <button class="say-mini" data-say="${s.thai}" aria-label="Hear the whole sentence">${s.icon} 🔊</button>
        <div><div class="words">${words}</div><div class="mn-en">${s.en}</div></div>
    </div>`;
}

function letterChip(l, { faded = false } = {}) {
    return `<button class="chip chip-${l.letterClass}${faded ? ' faded' : ''}" data-say="${l.say}"
        title="${l.fullName} — ${l.meaning}" aria-label="${l.fullName}, ${l.meaning}">
        <span class="chip-letter">${l.letter}</span><span class="chip-emoji">${l.emoji}</span></button>`;
}

// The first word of a letter's name, e.g. ขอ — what the "rising name" tip is about.
function nameSyllable(l) {
    return l.say.split(' ')[0];
}

// --------------------------------------------------------------- lessons ----

function introChicken() {
    return `
    <div class="lesson-pals">${palHTML('HC', 'asleep')}${palHTML('MC', 'happy')}${palHTML('LC')}</div>
    <p>${className('MC')} has a secret sentence. Every word holds one Mid letter. Tap the words to hear them:</p>
    ${sentenceHTML('MC')}
    <p>Letters <b>not</b> in the sentence go to ${className('LC')}.<br><small>(${className('HC')} is napping 💤 until the next level.)</small></p>`;
}

function introGhost() {
    const hear = (l, arrow) => `<button class="say-mini" data-say="${l.say}">${nameSyllable(l)} ${arrow}</button>`;
    return `
    <div class="lesson-pals">${palHTML('HC', 'happy')}${palHTML('MC')}${palHTML('LC')}</div>
    <p>${className('HC')} wakes up! It has a sentence too:</p>
    ${sentenceHTML('HC')}
    <div class="ear">👂 <b>Ear trick:</b> a High letter's name goes <b>up ↗</b>. Compare
        ${hear(BY_LETTER['ข'], '↗')} with ${hear(BY_LETTER['ก'], '→')}</div>
    <p class="rules">🐔 sentence → ${className('MC')}<br>👻 sentence → ${className('HC')}<br>Neither → ${className('LC')}</p>`;
}

function introTwins() {
    const rows = TWIN_PAIRS.map(([hi, lo]) => {
        const h = BY_LETTER[hi], l = BY_LETTER[lo];
        return `<div class="twin-row">
            <button class="twin c-HC-box" data-say="${h.say}"><span class="tl">${hi}</span>${nameSyllable(h)} ↗</button>
            <span class="twin-eq">same sound</span>
            <button class="twin c-LC-box" data-say="${l.say}"><span class="tl">${lo}</span>${nameSyllable(l)} →</button>
        </div>`;
    }).join('');
    return `
    <div class="lesson-pals">${palHTML('HC', 'happy')}${palHTML('MC', 'asleep')}${palHTML('LC', 'happy')}</div>
    <p>These ${className('HC')} letters each have a ${className('LC')} twin that makes the same sound.
       Listen to the names: the High twin's goes <b>up ↗</b>, the Low twin's stays <b>level →</b>. Tap to hear:</p>
    <div class="twins">${rows}</div>
    <p><small>${className('MC')} is napping 💤, so it's just High or Low this time.</small></p>`;
}

function introRare() {
    const groups = [['ฎ', 'ฏ'], ['ฐ'], ['ศ', 'ษ'], ['ฃ']];
    const rows = groups.map(g => {
        const src = BY_LETTER[COPYCATS[g[0]]];
        const cls = src.letterClass;
        const srcs = [...new Set(g.map(c => COPYCATS[c]))].map(c => letterChip(BY_LETTER[c])).join('');
        return `<div class="copy-row">${g.map(c => letterChip(BY_LETTER[c])).join('')}
            <span class="copy-arrow">copy</span>${srcs}<span class="copy-arrow">→</span>${className(cls)}</div>`;
    }).join('');
    const rest = [...RARE].filter(c => !COPYCATS[c]).map(c => letterChip(BY_LETTER[c])).join('');
    return `
    <div class="lesson-pals">${palHTML('HC')}${palHTML('MC')}${palHTML('LC')}</div>
    <p>Most rare letters are <b>copycats</b>. They copy the sound of a sentence letter <i>and</i> join its pal:</p>
    <div class="copycats">${rows}</div>
    <p>The rest aren't in either sentence, so they're all ${className('LC')}:</p>
    <div class="chips">${rest}</div>`;
}

function introMixed() {
    return `
    <div class="lesson-pals">${palHTML('HC', 'happy')}${palHTML('MC', 'happy')}${palHTML('LC', 'happy')}</div>
    <p><b>Boss level!</b> Letters from all 44, and all three pals are awake.</p>
    <p class="rules">🐔 In the chicken sentence, or a copycat of one → ${className('MC')}<br>
       👻 In the ghost sentence, or a copycat (the name rises ↗) → ${className('HC')}<br>
       🌊 Everyone else → ${className('LC')}</p>`;
}

function introRush() {
    return `
    <div class="lesson-pals">${palHTML('HC', 'happy')}${palHTML('MC', 'happy')}${palHTML('LC', 'happy')}</div>
    <p><b>Letters fall from the sky!</b> Tap the right pal before each one lands.</p>
    <p>They fall faster and faster. You have 3 hearts. How many can you sort?</p>
    <p>⌨️ Keys <b>1 2 3</b> work too.</p>
    ${save.rushBest ? `<p class="best">🏆 Your best: ${save.rushBest} letters</p>` : ''}`;
}

// --------------------------------------------------------------- the map ----

function renderMap() {
    renderPals(document.getElementById('startPals'));
    const got = save.stickers.length;
    document.getElementById('stickerCount').textContent = `${got}/${THAI_LETTERS.length}`;
    document.getElementById('stickerFill').style.width = `${(got / THAI_LETTERS.length) * 100}%`;

    const path = document.getElementById('levelPath');
    path.innerHTML = '';
    const nextUp = LEVELS.findIndex((lv, i) => unlocked(i) && !save.stars[lv.id]);
    LEVELS.forEach((lv, i) => {
        const open = unlocked(i);
        const node = document.createElement('button');
        node.className = `level-node${open ? '' : ' locked'}${i === nextUp ? ' current' : ''}`;
        const extra = lv.rush && save.rushBest ? `<small class="node-best">🏆 ${save.rushBest}</small>` : '';
        node.innerHTML = `
            <span class="node-icon">${open ? lv.icon : '🔒'}</span>
            <span class="node-text"><b>${i + 1}. ${lv.name}</b><small>${lv.sub}</small></span>
            <span class="node-stars"><span class="srow">${starsHTML(save.stars[lv.id] || 0)}</span>${extra}</span>`;
        node.onclick = () => openLevel(i);
        path.appendChild(node);
    });
}

function showMap() {
    session++;  // stop anything still scheduled in a game
    locked = true;
    clearTimeout(rushTimer);
    document.body.classList.remove('fever');
    renderMap();
    showScreen('startScreen');
}

function openLevel(i) {
    if (i == null) return;
    if (!unlocked(i)) {
        toast(`🔒 Finish “${LEVELS[i - 1].name}” to unlock this`);
        return;
    }
    levelIdx = i;
    level = LEVELS[i];
    document.getElementById('introTitle').textContent = `${level.icon} ${level.name}`;
    document.getElementById('introBody').innerHTML = level.intro();
    showScreen('introScreen');
}

function nextLevelIndex() {
    return levelIdx + 1 < LEVELS.length ? levelIdx + 1 : null;
}

// ------------------------------------------------------------ the houses ----

function showHouses() {
    const tips = {
        HC: `Their names rise ↗ (listen to ${nameSyllable(BY_LETTER['ข'])}). Copycats: ศ ษ (copy ส), ฐ (copies ถ), ฃ (copies ข).`,
        MC: `Copycats: ฎ (copies ด), ฏ (copies ต).`,
        LC: `Everyone not in the 🐔 or 👻 sentence. Seven are twins of High letters: ${TWIN_PAIRS.map(p => p[1]).join(' ')}.`,
    };
    const list = document.getElementById('houseList');
    list.innerHTML = CLASS_ORDER.map(cls => {
        const c = CLASS_INFO[cls];
        const members = THAI_LETTERS.filter(l => l.letterClass === cls);
        const got = members.filter(l => save.stickers.includes(l.letter)).length;
        return `
        <div class="meet-card" style="${palStyle(cls)}">
            <div class="meet-head">
                ${palHTML(cls, got === members.length ? 'happy' : '')}
                <div>
                    <h3>${c.name} <button class="say-mini" data-say="${c.thai}">${c.thai} 🔊</button></h3>
                    <p class="house-count"><b>${got}/${members.length}</b> stickers</p>
                </div>
            </div>
            ${SENTENCES[cls] ? sentenceHTML(cls) : ''}
            <p class="tip">💡 ${tips[cls]}</p>
            <div class="chips">${members.map(l => letterChip(l, { faded: !save.stickers.includes(l.letter) })).join('')}</div>
        </div>`;
    }).join('') + `<button class="link-btn" onclick="resetProgress()">Reset all progress</button>`;
    showScreen('housesScreen');
}

function resetProgress() {
    if (!confirm('Erase all stars, stickers and your Rush best?')) return;
    Object.assign(save, { stars: {}, streak: {}, stickers: [], rushBest: 0 });
    persist();
    showHouses();
}

// ------------------------------------------------------------------ game ----

let level = LEVELS[0], levelIdx = 0;
let session = 0;     // bumped on start/quit so timers from an old game do nothing
let queue = [], roundSize = 0, current = null;
let cleared = 0, hearts = MAX_HEARTS, score = 0, streak = 0, mistakes = 0;
let missed = [], newStickers = [];
let locked = true;

function startLevel() {
    unlockAudio();
    session++;
    cleared = 0; hearts = MAX_HEARTS; score = 0; streak = 0; mistakes = 0;
    missed = []; newStickers = [];
    document.body.classList.remove('fever');
    renderPals(document.getElementById('choices'), { buttons: true, awake: level.awake });
    level.awake.forEach(cls => preload(CLASS_INFO[cls].thai));
    document.getElementById('gameScreen').classList.toggle('rush', !!level.rush);
    setBubble('');
    showScreen('gameScreen');
    if (level.rush) {
        rushRecent = [];
        rushNext = rushPick();
        updateHud();
        setTimeout(spawnFaller, 500);
    } else {
        queue = shuffle(level.build());
        roundSize = queue.length;
        updateHud();
        nextLetter();
    }
}

function replayLevel() {
    startLevel();
}

function multiplier() {
    return Math.min(4, 1 + Math.floor(streak / 3));
}

function updateHud() {
    document.getElementById('hearts').innerHTML =
        Array.from({ length: MAX_HEARTS }, (_, i) => `<span class="${i < hearts ? '' : 'lost'}">❤️</span>`).join('');
    document.getElementById('score').textContent = level.rush ? `📦 ${cleared}  ⭐ ${score}` : `⭐ ${score}`;
    const combo = document.getElementById('combo');
    const fever = streak >= FEVER_STREAK;
    combo.textContent = fever ? `🔥 FEVER x${multiplier()}` : multiplier() > 1 ? `🔥 x${multiplier()}` : '';
    combo.classList.toggle('on', multiplier() > 1);
    document.getElementById('progressFill').style.width = `${(cleared / roundSize) * 100}%`;
    if (fever && !document.body.classList.contains('fever')) sfx('fever');
    document.body.classList.toggle('fever', fever);
}

function palEl(cls) {
    return document.querySelector(`#choices .pal-${cls}`);
}
function resetPals() {
    document.querySelectorAll('#choices .pal').forEach(p => p.classList.remove('happy', 'sad', 'hint', 'shake', 'jump'));
}

function setBubble(html, mood = '') {
    const b = document.getElementById('bubble');
    b.innerHTML = html;
    b.className = `bubble ${mood}${html ? '' : ' empty'}`;
}

function floatPoints(text, host) {
    const el = document.createElement('div');
    el.className = 'float-points';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

// Why a letter is in its class, in terms of the lessons.
function why(l) {
    const cls = l.letterClass;
    const src = COPYCATS[l.letter];
    if (src) {
        return `${l.letter} is a copycat of ${src} (same sound), so it's ${className(cls)} too.${sentenceHTML(cls, src)}`;
    }
    if (IN_SENTENCE.has(l.letter)) {
        const twin = TWIN[l.letter] ? ` Its Low twin is ${TWIN[l.letter]}.` : '';
        return `${l.letter} is in the ${SENTENCES[cls].icon} sentence, so it's ${className(cls)}.${twin}${sentenceHTML(cls, l.letter)}`;
    }
    const twin = TWIN[l.letter];
    return `${l.letter} isn't in the 🐔 or 👻 sentence, so it's ${className('LC')}.` +
        (twin ? ` Its twin ${twin} is the High one: hear how <button class="say-mini" data-say="${BY_LETTER[twin].say}">${nameSyllable(BY_LETTER[twin])} ↗</button> rises and <button class="say-mini" data-say="${l.say}">${nameSyllable(l)} →</button> doesn't.` : '');
}

// Sticker bookkeeping: STICKER_STREAK right answers in a row (across games).
function recordAnswer(l, ok) {
    if (!ok) {
        save.streak[l.letter] = 0;
    } else {
        save.streak[l.letter] = (save.streak[l.letter] || 0) + 1;
        if (save.streak[l.letter] >= STICKER_STREAK && !save.stickers.includes(l.letter)) {
            save.stickers.push(l.letter);
            newStickers.push(l);
            stickerPop(l);
        }
    }
    persist();
}

let stickerTimer = null;
function stickerPop(l) {
    const c = CLASS_INFO[l.letterClass];
    const el = document.getElementById('stickerPop');
    el.innerHTML = `<span class="sp-letter" style="background:${c.color}">${l.letter}<small>${l.emoji}</small></span>
        <span><b>New sticker!</b><br>${l.letter} moves into ${c.name}'s house</span>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => sfx('sticker'), 200);
    clearTimeout(stickerTimer);
    stickerTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function nextLetter() {
    document.getElementById('nextBtn').classList.remove('show');
    if (hearts <= 0) return finish(false);
    if (!queue.length) return finish(true);
    current = queue.shift();

    resetPals();
    const card = document.getElementById('letterCard');
    card.classList.remove('pop', 'right', 'wrong');
    void card.offsetWidth;
    card.classList.add('pop');
    document.getElementById('letterBig').textContent = current.letter;
    document.getElementById('letterEmoji').textContent = current.emoji;
    document.getElementById('letterReveal').textContent = '';
    setBubble(level.awake.length === 2 ? `${className(level.awake[0])} or ${className(level.awake[1])}?` : 'Who does this letter live with? 🏠');

    speak(current.say);
    queue.slice(0, 2).forEach(l => preload(l.say));
    locked = false;
}

function sayLetter() {
    if (current) speak(current.say);
}

function answer(cls) {
    if (locked || !current || !level.awake.includes(cls)) return;
    locked = true;
    const s = session;
    const l = current;
    const right = l.letterClass;
    const info = CLASS_INFO[right];
    const ok = cls === right;

    recordAnswer(l, ok);
    resetPals();
    if (ok) {
        streak++;
        const gained = 10 * multiplier();
        score += gained;
        cleared++;
        palEl(cls).classList.add('happy', 'jump');
        floatPoints(`+${gained}`, level.rush ? document.getElementById('rushSky') : document.getElementById('letterCard'));
        sfx('good');
    } else {
        streak = 0;
        hearts--;
        mistakes++;
        if (!missed.includes(l)) missed.push(l);
        palEl(cls).classList.add('sad', 'shake');
        palEl(right).classList.add('happy', 'hint');
        sfx('bad');
    }
    updateHud();

    if (level.rush) return rushResolved(ok);

    document.getElementById('letterCard').classList.add(ok ? 'right' : 'wrong');
    document.getElementById('letterReveal').innerHTML =
        `<span class="rv-name">${l.fullName}</span> · ${l.meaning} · <b style="color:${info.dark}">${info.name}</b>`;
    setTimeout(() => { if (s === session) speak(info.thai); }, 250);

    if (ok) {
        setBubble(PRAISE[Math.floor(Math.random() * PRAISE.length)], 'good');
        setTimeout(() => { if (s === session) nextLetter(); }, 1400);
    } else {
        setBubble(`<div class="b-title">Oops! ${l.letter} lives with ${info.name} ${info.short}</div><div class="b-why">${why(l)}</div>`, 'bad');
        queue.splice(Math.min(queue.length, 3), 0, l);  // it comes back a few turns later
        const next = document.getElementById('nextBtn');
        next.textContent = hearts <= 0 ? 'See results ▶' : 'Next ▶';
        next.classList.add('show');
    }
}

// ------------------------------------------------------------------ rush ----

let rushTimer = null, rushRecent = [], rushNext = null;

function rushPick() {
    // Letters without a sticker yet come up twice as often.
    const pool = THAI_LETTERS.filter(l => !rushRecent.includes(l));
    const weighted = pool.flatMap(l => save.stickers.includes(l.letter) ? [l] : [l, l]);
    const l = weighted[Math.floor(Math.random() * weighted.length)];
    rushRecent.push(l);
    if (rushRecent.length > 8) rushRecent.shift();
    preload(l.say);
    return l;
}

function spawnFaller() {
    if (hearts <= 0) return finish(false);
    const s = session;
    current = rushNext;
    rushNext = rushPick();
    resetPals();
    setBubble('');

    const sky = document.getElementById('rushSky');
    const f = document.getElementById('faller');
    document.getElementById('fallerLetter').textContent = current.letter;
    document.getElementById('fallerEmoji').textContent = current.emoji;
    const fallMs = Math.max(1700, 5200 - cleared * 110);
    f.className = 'faller';
    f.style.left = `${8 + Math.random() * 54}%`;
    f.style.transition = 'none';
    f.style.transform = 'translateY(0)';
    void f.offsetWidth;
    f.style.transition = `transform ${fallMs}ms linear`;
    f.style.transform = `translateY(${sky.clientHeight - f.offsetHeight - 6}px)`;

    speak(current.say);
    locked = false;
    clearTimeout(rushTimer);
    rushTimer = setTimeout(() => { if (s === session && !locked) rushLanded(); }, fallMs);
}

function freezeFaller() {
    const f = document.getElementById('faller');
    const pos = getComputedStyle(f).transform;
    f.style.transition = 'none';
    f.style.transform = pos;
    return f;
}

function rushLanded() {
    locked = true;
    const l = current;
    current = null;  // answered: a pause now shouldn't drop it again
    streak = 0; hearts--; mistakes++;
    if (!missed.includes(l)) missed.push(l);
    recordAnswer(l, false);
    freezeFaller().classList.add('splat');
    palEl(l.letterClass).classList.add('happy', 'hint');
    setBubble(`Too slow! ${l.letter} → ${className(l.letterClass)}`, 'bad');
    sfx('bad');
    updateHud();
    const s = session;
    setTimeout(() => { if (s === session) spawnFaller(); }, 1300);
}

function rushResolved(ok) {
    clearTimeout(rushTimer);
    const l = current;
    current = null;
    freezeFaller().classList.add(ok ? 'caught' : 'splat');
    if (!ok) setBubble(`${l.letter} → ${className(l.letterClass)}`, 'bad');
    const s = session;
    setTimeout(() => { if (s === session) spawnFaller(); }, ok ? 450 : 1300);
}

// A hidden tab stops the fall animation but not the landing timer, so letters
// would "land" unseen. Pause instead, and drop the same letter again on return.
document.addEventListener('visibilitychange', () => {
    const inRush = level.rush && hearts > 0 && document.getElementById('gameScreen').classList.contains('active');
    if (!inRush) return;
    if (document.hidden) {
        session++;
        locked = true;
        clearTimeout(rushTimer);
    } else {
        if (current) rushNext = current;
        spawnFaller();
    }
});

// ---------------------------------------------------------------- results ----

function finish(won) {
    session++;
    locked = true;
    current = null;
    clearTimeout(rushTimer);
    document.body.classList.remove('fever');

    let stars, title, scoreLine, bestLine = '';
    if (level.rush) {
        stars = RUSH_STARS.filter(n => cleared >= n).length;
        const newBest = cleared > save.rushBest;
        if (newBest) save.rushBest = cleared;
        title = cleared >= RUSH_STARS[2] ? 'Lightning fast! ⚡' : 'Rush over!';
        scoreLine = `📦 ${cleared} letters sorted · ⭐ ${score}`;
        bestLine = newBest ? '🏆 New best!' : `🏆 Best: ${save.rushBest} letters`;
    } else {
        stars = !won ? 0 : mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1;
        title = !won ? 'Out of hearts! 💔' : stars === 3 ? 'Perfect! สุดยอด! 🎉' : 'Level complete! 🎉';
        scoreLine = `⭐ ${score} points`;
    }
    const prev = save.stars[level.id] || 0;
    if (stars > prev) save.stars[level.id] = stars;
    persist();
    const justUnlocked = prev === 0 && stars > 0 && nextLevelIndex() != null;
    if (justUnlocked) bestLine = `🔓 Unlocked: ${LEVELS[nextLevelIndex()].icon} ${LEVELS[nextLevelIndex()].name}`;

    const starsEl = document.getElementById('endStars');
    starsEl.innerHTML = starsHTML(stars);
    starsEl.querySelectorAll('span').forEach((sp, i) => sp.style.animationDelay = `${0.2 + i * 0.25}s`);
    document.getElementById('endTitle').textContent = title;
    document.getElementById('endScore').textContent = scoreLine;
    document.getElementById('endBest').textContent = bestLine;

    document.getElementById('endStickers').innerHTML = newStickers.length
        ? `<p>🎉 New stickers (${save.stickers.length}/${THAI_LETTERS.length}):</p><div class="chips">${newStickers.map(l => letterChip(l)).join('')}</div>` : '';
    document.getElementById('endMissed').innerHTML = missed.length
        ? `<p>Practise these, tap to hear:</p><div class="chips">${missed.map(l => letterChip(l)).join('')}</div>` : '';

    const ni = nextLevelIndex();
    const nextBtn = document.getElementById('endNextBtn');
    nextBtn.style.display = ni != null && unlocked(ni) ? '' : 'none';
    if (ni != null) nextBtn.textContent = `Next: ${LEVELS[ni].icon} ${LEVELS[ni].name} ▶`;

    showScreen('endScreen');
    if (stars > 0) { sfx('win'); confetti(); }
}

function confetti() {
    const box = document.getElementById('confetti');
    const colors = CLASS_ORDER.map(c => CLASS_INFO[c].color).concat(['#ff6f91', '#6dd36a']);
    for (let i = 0; i < 70; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.random() * 100}%`;
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = `${Math.random() * 0.6}s`;
        p.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        box.appendChild(p);
        setTimeout(() => p.remove(), 3800);
    }
}

// --------------------------------------------------------------- keyboard ----

document.addEventListener('keydown', e => {
    if (!document.getElementById('gameScreen').classList.contains('active')) return;
    const k = e.key.toLowerCase();
    const map = { '1': 'HC', h: 'HC', '2': 'MC', m: 'MC', '3': 'LC', l: 'LC' };
    if (map[k]) { answer(map[k]); return; }
    if (k === ' ') { e.preventDefault(); sayLetter(); return; }
    if (k === 'enter' && document.getElementById('nextBtn').classList.contains('show')) nextLetter();
});

renderMap();
