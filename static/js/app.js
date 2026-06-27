const audioCache = {};

// One shared player: rapid taps restart the clip instead of layering copies,
// and the .catch absorbs mobile autoplay blocks (no user gesture yet) instead
// of leaving unhandled promise rejections.
const audioPlayer = new Audio();
function playAudioUrl(url) {
    if (!url) return;
    audioPlayer.pause();
    audioPlayer.src = url;
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(e => console.warn('Audio playback skipped:', e.message));
}

let allDecksData = [];
let progressData = {}; // Track completion status
let fullVocab = []; 
let deck = [];      
let currentMode = 'thai_front';
let currentCategory = 'vocab';
let currentDeckName = '';
let currentDeckId = '';
let selectedCustomDecks = new Set(); // gids chosen for a custom deck
let customCount = 50;                // chosen card-count preset
let isFlipped = false;
let isAnimating = false;

// ========== UNDO STATE ==========
let undoHistory = []; // Stack of {card, action, deckSnapshot}
const MAX_UNDO_HISTORY = 20;

// ========== LONG PRESS STATE ==========
let longPressTimer = null;
const LONG_PRESS_DURATION = 2000; // 2 seconds

// ========== NUMBERS GAME STATE ==========
let numbersGameActive = false;
let numbersInputLocked = false; // Prevents input during transitions
let currentNumberLevel = 0; // 0-6 for levels 1-7
let numbersChallenges = []; // Array of {number: 123, audioUrl: '...'}
let currentInput = '';

// ========== THAI LETTERS DATA (HARDCODED) ==========
const THAI_LETTERS = [
    { letter: "ก", fullName: "ก ไก่", letterClass: "MC", meaning: "chicken" },
    { letter: "ข", fullName: "ข ไข่", letterClass: "HC", meaning: "egg" },
    { letter: "ฃ", fullName: "ฃ ขวด", letterClass: "HC", meaning: "bottle (obsolete)" },
    { letter: "ค", fullName: "ค ควาย", letterClass: "LC", meaning: "buffalo" },
    { letter: "ฅ", fullName: "ฅ คน", letterClass: "LC", meaning: "person (obsolete)" },
    { letter: "ฆ", fullName: "ฆ ระฆัง", letterClass: "LC", meaning: "bell" },
    { letter: "ง", fullName: "ง งู", letterClass: "LC", meaning: "snake" },
    { letter: "จ", fullName: "จ จาน", letterClass: "MC", meaning: "plate" },
    { letter: "ฉ", fullName: "ฉ ฉิ่ง", letterClass: "HC", meaning: "cymbals" },
    { letter: "ช", fullName: "ช ช้าง", letterClass: "LC", meaning: "elephant" },
    { letter: "ซ", fullName: "ซ โซ่", letterClass: "LC", meaning: "chain" },
    { letter: "ฌ", fullName: "ฌ เฌอ", letterClass: "LC", meaning: "tree" },
    { letter: "ญ", fullName: "ญ หญิง", letterClass: "LC", meaning: "woman" },
    { letter: "ฎ", fullName: "ฎ ชฎา", letterClass: "MC", meaning: "Thai headdress" },
    { letter: "ฏ", fullName: "ฏ ปฏัก", letterClass: "MC", meaning: "spear" },
    { letter: "ฐ", fullName: "ฐ ฐาน", letterClass: "HC", meaning: "base / pedestal" },
    { letter: "ฑ", fullName: "ฑ มณโฑ", letterClass: "LC", meaning: "Montho (character)" },
    { letter: "ฒ", fullName: "ฒ ผู้เฒ่า", letterClass: "LC", meaning: "old man" },
    { letter: "ณ", fullName: "ณ เณร", letterClass: "LC", meaning: "novice monk" },
    { letter: "ด", fullName: "ด เด็ก", letterClass: "MC", meaning: "child" },
    { letter: "ต", fullName: "ต เต่า", letterClass: "MC", meaning: "turtle" },
    { letter: "ถ", fullName: "ถ ถุง", letterClass: "HC", meaning: "bag / sack" },
    { letter: "ท", fullName: "ท ทหาร", letterClass: "LC", meaning: "soldier" },
    { letter: "ธ", fullName: "ธ ธง", letterClass: "LC", meaning: "flag" },
    { letter: "น", fullName: "น หนู", letterClass: "LC", meaning: "mouse / rat" },
    { letter: "บ", fullName: "บ ใบไม้", letterClass: "MC", meaning: "leaf" },
    { letter: "ป", fullName: "ป ปลา", letterClass: "MC", meaning: "fish" },
    { letter: "ผ", fullName: "ผ ผึ้ง", letterClass: "HC", meaning: "bee" },
    { letter: "ฝ", fullName: "ฝ ฝา", letterClass: "HC", meaning: "lid / cover" },
    { letter: "พ", fullName: "พ พาน", letterClass: "LC", meaning: "tray" },
    { letter: "ฟ", fullName: "ฟ ฟัน", letterClass: "LC", meaning: "teeth" },
    { letter: "ภ", fullName: "ภ สำเภา", letterClass: "LC", meaning: "junk (sailing ship)" },
    { letter: "ม", fullName: "ม ม้า", letterClass: "LC", meaning: "horse" },
    { letter: "ย", fullName: "ย ยักษ์", letterClass: "LC", meaning: "giant / ogre" },
    { letter: "ร", fullName: "ร เรือ", letterClass: "LC", meaning: "boat" },
    { letter: "ล", fullName: "ล ลิง", letterClass: "LC", meaning: "monkey" },
    { letter: "ว", fullName: "ว แหวน", letterClass: "LC", meaning: "ring" },
    { letter: "ศ", fullName: "ศ ศาลา", letterClass: "HC", meaning: "pavilion" },
    { letter: "ษ", fullName: "ษ ฤๅษี", letterClass: "HC", meaning: "hermit" },
    { letter: "ส", fullName: "ส เสือ", letterClass: "HC", meaning: "tiger" },
    { letter: "ห", fullName: "ห หีบ", letterClass: "HC", meaning: "chest / box" },
    { letter: "ฬ", fullName: "ฬ จุฬา", letterClass: "LC", meaning: "kite" },
    { letter: "อ", fullName: "อ อ่าง", letterClass: "MC", meaning: "basin / tub" },
    { letter: "ฮ", fullName: "ฮ นกฮูก", letterClass: "LC", meaning: "owl" }
];

async function initApp() {
    try {
        // Fetch decks and progress in parallel
        const [decksResponse, progressResponse] = await Promise.all([
            fetch('/decks'),
            fetch('/progress')
        ]);
        allDecksData = await decksResponse.json();
        progressData = await progressResponse.json();
        console.log("Decks loaded:", allDecksData);
        console.log("Progress loaded:", progressData);
        hideLoading();
        document.getElementById('categoryMenu').style.display = 'flex';
        document.getElementById('deckMenu').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'none';
    } catch (err) {
        document.getElementById('loadingText').innerText = "Connection Failed: " + err.message;
    }
}

async function showDecks(category) {
    currentCategory = category;
    
    // Refresh deck and progress data from server
    try {
        const [decksResponse, progressResponse] = await Promise.all([
            fetch('/decks'),
            fetch('/progress')
        ]);
        allDecksData = await decksResponse.json();
        progressData = await progressResponse.json();
    } catch (err) {
        console.error('Failed to refresh data:', err);
    }
    
    const filtered = allDecksData.filter(d => d.category === category);
    const listArea = document.getElementById('deckListArea');
    listArea.innerHTML = '';

    // Vocab decks get a "Custom Deck" builder entry at the top
    if (category === 'vocab') {
        const customCard = document.createElement('div');
        customCard.className = 'deck-card custom-deck-entry';
        customCard.innerHTML = `
            <div class="deck-info">
                <span class="deck-title">🎲 Custom Deck</span>
                <span class="deck-count">mix &amp; match</span>
            </div>`;
        customCard.onclick = () => showCustomBuilder();
        listArea.appendChild(customCard);
    }

    if (filtered.length === 0) {
        listArea.innerHTML = '<div style="color:#888;">No decks found.</div>';
    } else {
        filtered.forEach(d => {
            const progress = progressData[d.gid] || { thai: false, eng: false };
            const thaiDone = progress.thai;
            const engDone = progress.eng;
            const isVocab = d.category === 'vocab';
            
            const div = document.createElement('div');
            div.className = 'deck-card';
            div.innerHTML = `
                <div class="deck-info">
                    <span class="deck-title">${d.name}</span>
                    <span class="deck-count">${d.count} cards</span>
                </div>
                <div class="deck-progress">
                    <div class="deck-progress-row ${thaiDone ? 'progress-done' : 'progress-pending'}">
                        🇹🇭 ${thaiDone ? '✅' : '☑️'}
                    </div>
                    <div class="deck-progress-row ${engDone ? 'progress-done' : 'progress-pending'}">
                        🇬🇧 ${engDone ? '✅' : '☑️'}
                    </div>
                </div>
                <div class="deck-actions">
                    <button class="deck-reset-btn" title="Reset progress" aria-label="Reset progress for ${d.name}" data-deck-id="${d.gid}">🔄</button>
                    ${isVocab ? `<button class="deck-download-btn" title="Download MP3" aria-label="Download ${d.name} as MP3" data-deck-id="${d.gid}">⬇️</button>` : ''}
                </div>
            `;
            
            // Click on card (but not buttons) loads the deck
            div.onclick = (e) => {
                if (!e.target.classList.contains('deck-reset-btn') && !e.target.classList.contains('deck-download-btn')) {
                    loadDeckData(d.gid, d.name);
                }
            };
            
            // Reset button handler
            const resetBtn = div.querySelector('.deck-reset-btn');
            resetBtn.onclick = (e) => {
                e.stopPropagation();
                resetDeckProgress(d.gid);
            };
            
            // Download button handler (only for vocab)
            if (isVocab) {
                const downloadBtn = div.querySelector('.deck-download-btn');
                downloadBtn.onclick = (e) => {
                    e.stopPropagation();
                    downloadDeckMp3(d.gid, d.name);
                };
            }
            
            listArea.appendChild(div);
        });
    }

    document.getElementById('categoryMenu').style.display = 'none';
    document.getElementById('deckMenu').style.display = 'flex';
}

// ========== CUSTOM DECK ==========
function showCustomBuilder() {
    renderCustomDeckList();
    updateCustomSummary();
    document.getElementById('categoryMenu').style.display = 'none';
    document.getElementById('deckMenu').style.display = 'none';
    document.getElementById('customMenu').style.display = 'flex';
}

function renderCustomDeckList() {
    const listArea = document.getElementById('customDeckList');
    listArea.innerHTML = '';
    allDecksData.filter(d => d.category === 'vocab').forEach(d => {
        const div = document.createElement('div');
        div.className = 'custom-deck-card' + (selectedCustomDecks.has(d.gid) ? ' selected' : '');
        div.innerHTML = `<span class="cd-name">${d.name}</span><span class="cd-count">${d.count}</span>`;
        div.onclick = () => toggleCustomDeck(d.gid, div);
        listArea.appendChild(div);
    });
}

function toggleCustomDeck(gid, el) {
    if (selectedCustomDecks.has(gid)) {
        selectedCustomDecks.delete(gid);
        el.classList.remove('selected');
    } else {
        selectedCustomDecks.add(gid);
        el.classList.add('selected');
    }
    updateCustomSummary();
}

function selectAllCustomDecks(select) {
    const vocabDecks = allDecksData.filter(d => d.category === 'vocab');
    selectedCustomDecks = new Set(select ? vocabDecks.map(d => d.gid) : []);
    renderCustomDeckList();
    updateCustomSummary();
}

function updateCustomSummary() {
    const n = selectedCustomDecks.size;
    const available = allDecksData
        .filter(d => d.category === 'vocab' && selectedCustomDecks.has(d.gid))
        .reduce((sum, d) => sum + d.count, 0);
    document.getElementById('customSummary').innerText =
        n === 0 ? 'No decks selected' : `${n} deck${n > 1 ? 's' : ''} · up to ${available} cards`;
    document.getElementById('startCustomBtn').disabled = n === 0;
}

function setupCustomCountButtons() {
    document.querySelectorAll('#countGroup .count-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#countGroup .count-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            customCount = parseInt(btn.dataset.count, 10);
        };
    });
}

async function startCustomDeck() {
    if (selectedCustomDecks.size === 0) return;
    showLoading('Building your custom deck…');
    try {
        const res = await fetch('/custom_deck', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ deck_ids: [...selectedCustomDecks], count: customCount })
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || 'Failed to build deck');
        }
        const data = await res.json();
        if (!data.words || data.words.length === 0) throw new Error('No cards found');

        fullVocab = data.words;
        currentCategory = 'custom';
        currentDeckId = 'custom';
        currentDeckName = `🎲 Custom · ${data.count}`;
        document.getElementById('deckTitle').innerText = currentDeckName;

        hideLoading();
        document.getElementById('customMenu').style.display = 'none';
        document.getElementById('modeToggle').style.display = 'flex';
        document.getElementById('gameContainer').style.display = 'flex';
        switchMode('thai_front');
    } catch (err) {
        hideLoading();
        showToast('Could not build custom deck: ' + err.message);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadDeckMp3(deckId, deckName) {
    showLoading(`Generating ${deckName} MP3…`);

    try {
        // 1. Kick off the background job
        const startRes = await fetch(`/download_deck/${deckId}/start`, { method: 'POST' });
        if (!startRes.ok) throw new Error('Could not start MP3 generation');
        const { job_id } = await startRes.json();

        // 2. Poll for progress until done (or error)
        while (true) {
            await sleep(1000);
            const statusRes = await fetch(`/download_status/${job_id}`);
            if (!statusRes.ok) throw new Error('Lost track of the MP3 job');
            const status = await statusRes.json();

            if (status.state === 'error') throw new Error(status.error || 'MP3 generation failed');
            if (status.state === 'done') break;

            const done = status.progress || 0;
            const total = status.total || 0;
            showLoading(`Generating ${deckName} MP3… ${done}/${total} words`);
        }

        // 3. Fetch the finished file and trigger the browser download
        const blob = await fetch(`/download_result/${job_id}`).then(r => r.blob());
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${deckName.replace(/ /g, '_')}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Download failed:', err);
        showToast('Failed to download MP3: ' + err.message);
    }

    hideLoading();
}

async function resetDeckProgress(deckId) {
    try {
        const response = await fetch(`/reset/${deckId}`, { method: 'POST' });
        if (response.ok) {
            progressData[deckId] = { thai: false, eng: false };
            showDecks(currentCategory); // Refresh the display
        }
    } catch (err) {
        console.error('Failed to reset progress:', err);
    }
}

function goBackToCategories() {
    document.getElementById('deckMenu').style.display = 'none';
    document.getElementById('categoryMenu').style.display = 'flex';
}

// ========== LETTERS MODE ==========
function startLettersMode() {
    currentCategory = 'letters';
    currentDeckName = 'Thai Letters';
    currentDeckId = 'letters';
    
    fullVocab = THAI_LETTERS.map(l => ({
        thai: l.letter,
        fullName: l.fullName,
        letterClass: l.letterClass,
        meaning: l.meaning,
        audio_text: l.fullName  // Use full name for audio (e.g., "ก ไก่")
    }));
    
    // Show mode toggle with Letters-specific labels
    document.getElementById('modeToggle').style.display = 'flex';
    document.getElementById('btnThai').innerText = '📖 Info';
    document.getElementById('btnEng').innerText = '🎯 Class';
    document.getElementById('deckTitle').innerText = 'Letters';
    
    document.getElementById('categoryMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'flex';
    switchMode('thai_front');
}

async function startSpeakingMode() {
    currentCategory = 'speaking';
    currentDeckName = 'Speaking Practice';
    currentDeckId = 'speaking';
    
    // Show loading while generating sentences
    showLoading('Generating sentences with AI... This may take a moment.');
    
    try {
        const response = await fetch('/generate_sentences', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate sentences');
        }
        
        const sentences = await response.json();
        
        if (!sentences || sentences.length === 0) {
            throw new Error('No sentences generated');
        }
        
        // Convert to flashcard format
        fullVocab = sentences.map(s => ({
            thai: s.thai,
            eng: s.english,
            audio_text: s.audio_text
        }));
        
        hideLoading();
        
        // Hide mode toggle for speaking (only one mode)
        document.getElementById('modeToggle').style.display = 'none';
        document.getElementById('deckTitle').innerText = 'Speaking';
        
        document.getElementById('categoryMenu').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'flex';
        
        // Start without shuffling (sentences are already randomized by AI)
        deck = [...fullVocab];
        document.getElementById('victoryArea').style.display = 'none';
        document.getElementById('gameArea').style.display = 'block';
        document.getElementById('actionArea').style.display = 'flex';
        document.getElementById('actionArea').classList.remove('visible');
        document.getElementById('topControls').style.visibility = 'visible';
        
        const moverEl = document.getElementById('cardMover');
        moverEl.classList.remove('anim-slide-right', 'anim-slide-left', 'anim-pop-in');
        
        isFlipped = false;
        isAnimating = false;
        const cardEl = document.getElementById('flashcard');
        cardEl.classList.remove('is-flipped');
        cardEl.style.transition = 'none';
        renderCard();
        setTimeout(() => { cardEl.style.transition = 'transform 0.6s'; }, 50);
        
    } catch (err) {
        hideLoading();
        showToast('Failed to generate sentences: ' + err.message);
        console.error('Speaking mode error:', err);
    }
}

async function loadDeckData(gid, deckName) {
    showLoading("Downloading Deck...");
    try {
        const response = await fetch(`/vocab/${gid}`);
        const words = await response.json();
        if (!words || words.length === 0) throw new Error("Empty deck");

        // Store deck info
        currentDeckId = gid;
        currentDeckName = deckName || 'Deck';
        document.getElementById('deckTitle').innerText = currentDeckName;

        // PRELOAD AUDIO USING 'audio_text' (which contains override if applicable)
        const preloadCount = Math.min(words.length, 5);
        for(let i=0; i<preloadCount; i++) {
             fetch('/speak', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({text: words[i].audio_text, speed: 0.9})
            }).then(r => {
                if (!r.ok) throw new Error(`TTS ${r.status}`);
                return r.blob();
            }).then(b => {
                if (b.size) audioCache[words[i].audio_text] = URL.createObjectURL(b);
            }).catch(() => {}); // preload is best-effort; playback retries on demand
        }

        fullVocab = [...words];
        hideLoading();
        startGameUI();
    } catch (err) {
        showToast('Failed to load deck data.');
        hideLoading();
    }
}

function startGameUI() {
    // Show mode toggle for vocab/script
    document.getElementById('modeToggle').style.display = 'flex';
    
    document.getElementById('deckMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'flex';
    switchMode('thai_front'); 
}

function goHome() {
    document.getElementById('gameContainer').style.display = 'none';
    
    // Reset mode toggle labels back to default
    document.getElementById('modeToggle').style.display = 'flex';
    document.getElementById('btnThai').innerText = '🇹🇭 Thai';
    document.getElementById('btnEng').innerText = '🇬🇧 Eng';
    
    if (currentCategory === 'letters' || currentCategory === 'speaking') {
        // Go back to main menu for letters and speaking
        document.getElementById('categoryMenu').style.display = 'flex';
    } else if (currentCategory === 'custom') {
        // Custom decks live under the vocab deck list
        showDecks('vocab');
    } else {
        // Go back to deck selection for vocab/script - refresh to show updated progress
        showDecks(currentCategory);
    }
}

function switchMode(newMode) {
    currentMode = newMode;
    document.getElementById('btnThai').classList.toggle('active', newMode === 'thai_front');
    document.getElementById('btnEng').classList.toggle('active', newMode === 'eng_front');
    restartRound();
}

// Fisher-Yates: unbiased, unlike the sort(() => Math.random() - 0.5) trick,
// which systematically favours some orderings.
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function restartRound() {
    deck = [...fullVocab];
    shuffleInPlace(deck);
    undoHistory = []; // Clear undo history for new round
    document.getElementById('victoryArea').style.display = 'none';
    document.getElementById('gameArea').style.display = 'block';
    document.getElementById('actionArea').style.display = 'flex';
    document.getElementById('actionArea').classList.remove('visible'); // Hide buttons until flip
    document.getElementById('topControls').style.visibility = 'visible';
    
    // Reset card mover animation classes
    const moverEl = document.getElementById('cardMover');
    moverEl.classList.remove('anim-slide-right', 'anim-slide-left', 'anim-pop-in');
    
    isFlipped = false;
    isAnimating = false;
    const cardEl = document.getElementById('flashcard');
    cardEl.classList.remove('is-flipped');
    cardEl.style.transition = 'none';
    renderCard();
    setTimeout(() => { cardEl.style.transition = 'transform 0.6s'; }, 50);
}

function handleResult(isCorrect) {
    if (deck.length === 0 || isAnimating) return;
    isAnimating = true;
    const moverEl = document.getElementById('cardMover');
    const actionArea = document.getElementById('actionArea');
    moverEl.classList.add(isCorrect ? 'anim-slide-right' : 'anim-slide-left');
    actionArea.classList.remove('visible'); 

    setTimeout(() => {
        const currentCard = deck[0];
        
        // Save to undo history before modifying deck
        undoHistory.push({
            card: currentCard,
            wasCorrect: isCorrect,
            deckLength: deck.length
        });
        if (undoHistory.length > MAX_UNDO_HISTORY) {
            undoHistory.shift(); // Remove oldest entry
        }
        
        deck.shift(); 
        if (!isCorrect) deck.push(currentCard);

        if (deck.length === 0) {
            showVictory();
            isAnimating = false;
            return;
        }
        moverEl.classList.remove('anim-slide-right', 'anim-slide-left');
        const cardEl = document.getElementById('flashcard');
        cardEl.style.transition = 'none'; 
        cardEl.classList.remove('is-flipped');
        isFlipped = false;
        updateCardContent();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                cardEl.style.transition = 'transform 0.6s';
                moverEl.classList.add('anim-pop-in');
                setTimeout(() => {
                    moverEl.classList.remove('anim-pop-in');
                    isAnimating = false;
                }, 300);
            });
        });
    }, 300);
}

function undoLastAction() {
    // Don't undo if animating, no history, or not in flashcard game
    if (isAnimating || undoHistory.length === 0) return;
    if (document.getElementById('gameContainer').style.display !== 'flex') return;
    
    const isOnVictoryScreen = document.getElementById('victoryArea').style.display === 'flex';
    
    isAnimating = true;
    const lastAction = undoHistory.pop();
    const moverEl = document.getElementById('cardMover');
    const cardEl = document.getElementById('flashcard');
    const actionArea = document.getElementById('actionArea');
    
    // If the card was marked incorrect, it's now at the end of deck - remove it
    if (!lastAction.wasCorrect && deck.length > 0) {
        deck.pop();
    }
    
    // Put the card back at the front
    deck.unshift(lastAction.card);
    
    // If coming back from victory screen, restore the game UI
    if (isOnVictoryScreen) {
        document.getElementById('victoryArea').style.display = 'none';
        document.getElementById('gameArea').style.display = 'block';
        document.getElementById('actionArea').style.display = 'flex';
        document.getElementById('topControls').style.visibility = 'visible';
    }
    
    // Animate card coming back
    cardEl.style.transition = 'none';
    cardEl.classList.remove('is-flipped');
    isFlipped = false;
    actionArea.classList.remove('visible');
    
    // Quick flash animation to show undo happened
    moverEl.style.opacity = '0';
    updateCardContent();
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            moverEl.style.transition = 'opacity 0.3s';
            moverEl.style.opacity = '1';
            cardEl.style.transition = 'transform 0.6s';
            setTimeout(() => {
                moverEl.style.transition = '';
                isAnimating = false;
            }, 300);
        });
    });
    
    console.log('Undo: restored card', lastAction.card.thai || lastAction.card.eng);
}

// ========== AUTO-FIT TEXT TO CARD ==========
// Measure the rendered text and shrink the font until the whole word/phrase
// fits inside the card face. This replaces brittle character-count buckets,
// which broke on Thai: combining vowels/tone marks inflate string length, so
// words like เกษียณ or สำหรับ were sized too big and wrapped mid-word.
function fitText(el, opts = {}) {
    const {
        maxPx = 110,
        minPx = 14,
        lineHeight = 1.3,
        preferSingleLine = false,
        singleLineMinPx = 40,
        reserveTop = 8,
        reserveBottom = 8,
    } = opts;

    const face = el.closest('.face');
    if (!face) return;

    const cs = getComputedStyle(face);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;

    let availW = face.clientWidth - padL - padR;
    let availH = face.clientHeight - padT - padB - reserveTop - reserveBottom;

    // The phonetic / translation line is pinned to the bottom of the face while
    // the main text is vertically centred, so reserve room on both sides of
    // centre to keep the two from overlapping.
    const phon = face.querySelector('.phonetic');
    if (phon && phon !== el && getComputedStyle(phon).display !== 'none') {
        availH -= (phon.offsetHeight + 46) * 2;
    }

    if (availW <= 0 || availH <= 0) return; // not laid out yet

    el.style.lineHeight = String(lineHeight);

    const fits = (px, wrap) => {
        el.style.whiteSpace = wrap ? 'normal' : 'nowrap';
        el.style.fontSize = px + 'px';
        return el.scrollWidth <= availW + 0.5 && el.scrollHeight <= availH + 0.5;
    };

    const search = (wrap) => {
        let lo = minPx, hi = maxPx, best = minPx;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (fits(mid, wrap)) { best = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return best;
    };

    // Keep short single words on one line so they don't break mid-word — but
    // only when that still yields a readable size. A long Thai sentence has no
    // spaces between words either, yet must wrap; forcing it onto one line is
    // what shrank example sentences to a tiny single line.
    if (preferSingleLine) {
        const singleBest = search(false);
        if (singleBest >= singleLineMinPx) {
            el.style.whiteSpace = 'nowrap';
            el.style.fontSize = singleBest + 'px';
            return;
        }
    }
    el.style.whiteSpace = 'normal';
    el.style.fontSize = search(true) + 'px';
}

function updateCardContent(skipAudio = false) {
    const counter = document.getElementById('counter');
    if (deck.length === 0) return;
    const cardData = deck[0];
    counter.innerText = `${deck.length} left`;

    const frontText = document.getElementById('frontText');
    const frontPhonetic = document.getElementById('frontPhonetic');
    const frontBtn = document.getElementById('frontAudioBtn');

    const backText = document.getElementById('backText');
    const backPhonetic = document.getElementById('backPhonetic');
    const backBtn = document.getElementById('backAudioBtn');

    frontPhonetic.style.display = 'none';
    frontBtn.style.display = 'none';
    backPhonetic.style.display = 'none';
    backBtn.style.display = 'none';

    // Clear any inline sizing/layout left over from a previous card or mode so
    // it can't override the class-based defaults (e.g. Letters' jumbo letter).
    [frontText, backText, frontPhonetic, backPhonetic].forEach(node => {
        node.style.fontSize = '';
        node.style.whiteSpace = '';
        node.style.lineHeight = '';
        node.style.marginBottom = '';
        node.style.position = '';
        node.style.color = '';
        node.removeAttribute('lang');
    });

    function setSize(el, text, isThai) {
        el.className = isThai ? 'thai-font' : 'eng-font';
        if (isThai) el.setAttribute('lang', 'th');
        // Measure-and-shrink so the whole word/phrase fits the card. Thai single
        // words stay on one line; phrases with spaces (and English) may wrap.
        fitText(el, {
            preferSingleLine: isThai && !/\s/.test(text),
            lineHeight: isThai ? 1.5 : 1.2,
            maxPx: isThai ? 120 : 88,
        });
    }

    // === 1. VOCAB LOGIC (custom decks render the same way) ===
    if (currentCategory === 'vocab' || currentCategory === 'custom') {
        if (currentMode === 'thai_front') {
            // Front
            frontText.innerText = cardData.thai;
            if (cardData.phonetic) {
                frontPhonetic.innerText = `/${cardData.phonetic}/`;
                frontPhonetic.style.display = 'block';
            }
            setSize(frontText, cardData.thai, true);
            frontBtn.style.display = 'flex';

            // Back
            backText.innerText = cardData.eng;
            setSize(backText, cardData.eng, false);
        } else {
            // Front
            frontText.innerText = cardData.eng;
            setSize(frontText, cardData.eng, false);

            // Back
            backText.innerText = cardData.thai;
            if (cardData.phonetic) {
                backPhonetic.innerText = `/${cardData.phonetic}/`;
                backPhonetic.style.display = 'block';
            }
            setSize(backText, cardData.thai, true);
            backBtn.style.display = 'flex';
        }
    } 
    
    // === 2. SCRIPT LOGIC ===
    else if (currentCategory === 'script') {
        if (currentMode === 'thai_front') {
            // Thai Front Mode: Shows transliteration on front, Thai + English on back
            // Front: transliteration (use phonetic class for consistent font) + audio
            frontText.innerText = `/${cardData.phonetic}/`;
            frontText.className = 'phonetic';
            frontText.style.position = 'static';
            frontText.style.fontSize = 'clamp(1.8rem, 8vw, 3rem)';
            frontText.style.color = '#333'; // Black for main text on front
            frontBtn.style.display = 'flex';
            
            // Back: Thai script centered (accounting for bottom text), English at bottom
            backText.innerText = cardData.thai;
            setSize(backText, cardData.thai, true);
            backText.style.marginBottom = '60px'; // Push up to account for bottom text
            // Use backPhonetic div for English translation at bottom
            backPhonetic.innerText = cardData.eng || '';
            backPhonetic.style.display = 'block';
            backPhonetic.className = 'phonetic';
            backPhonetic.style.fontSize = '1.6rem'; // Bigger translation text
        } else {
            // English Front Mode: Shows English on front, Thai + transliteration on back
            // Front: English meaning
            frontText.innerText = cardData.eng || '';
            setSize(frontText, cardData.eng || '', false);
            
            // Back: Thai script centered (accounting for bottom text), transliteration at bottom
            backText.innerText = cardData.thai;
            setSize(backText, cardData.thai, true);
            backText.style.marginBottom = '60px'; // Push up to account for bottom text
            backPhonetic.innerText = `/${cardData.phonetic}/`;
            backPhonetic.style.display = 'block';
            backPhonetic.className = 'phonetic';
            backPhonetic.style.fontSize = '1.6rem'; // Bigger transliteration text
            backBtn.style.display = 'flex';
        }
    }
    
    // === 3. LETTERS LOGIC ===
    else if (currentCategory === 'letters') {
        // Front: Just the letter (same for both modes)
        frontText.innerText = cardData.thai;
        frontText.className = 'thai-font text-jumbo';
        
        const classLabel = cardData.letterClass === 'HC' ? 'High' : 
                           cardData.letterClass === 'MC' ? 'Mid' : 'Low';
        
        if (currentMode === 'thai_front') {
            // INFO MODE: Full name prominent, class badge small at top
            backText.innerHTML = `
                <div class="letter-back-info">
                    <div class="letter-class ${cardData.letterClass}">${classLabel}</div>
                    <div class="letter-full-name">${cardData.fullName}</div>
                    <div class="letter-meaning">${cardData.meaning}</div>
                </div>
            `;
        } else {
            // CLASS MODE: Class label big and centered, other info smaller
            backText.innerHTML = `
                <div class="letter-back-class-mode">
                    <div class="letter-class-big ${cardData.letterClass}">${classLabel}</div>
                    <div class="letter-small-info">
                        <span class="letter-small-name">${cardData.fullName}</span>
                        <span class="letter-small-meaning">${cardData.meaning}</span>
                    </div>
                </div>
            `;
        }
        backText.className = '';
        backBtn.style.display = 'flex';
    }
    
    // === 4. SPEAKING LOGIC ===
    else if (currentCategory === 'speaking') {
        // Front: English sentence
        frontText.innerText = cardData.eng;
        setSize(frontText, cardData.eng, false);
        
        // Back: Thai sentence (with spaces) + audio button (no auto-play)
        backText.innerText = cardData.thai;
        backText.className = 'thai-font';
        backText.setAttribute('lang', 'th');
        // Sentences wrap at the spaces between words; extra line-height keeps
        // stacked vowels/tone marks from overlapping across lines.
        fitText(backText, { preferSingleLine: false, lineHeight: 1.6, maxPx: 64 });
        backBtn.style.display = 'flex';
    }

    // Auto-play audio for Thai front mode in vocab and script
    if (!skipAudio && (currentCategory === 'vocab' || currentCategory === 'custom' || currentCategory === 'script') && currentMode === 'thai_front') playCurrentAudio();
}

function renderCard() { updateCardContent(); }

function showVictory() {
    document.getElementById('gameArea').style.display = 'none';
    document.getElementById('actionArea').style.display = 'none';
    document.getElementById('topControls').style.visibility = 'hidden';
    document.getElementById('victoryArea').style.display = 'flex';
    
    // Mark this deck/mode as complete (skip for letters, speaking, and the
    // ephemeral custom decks, which have no persistent progress)
    if (currentCategory !== 'letters' && currentCategory !== 'speaking' && currentCategory !== 'custom') {
        markDeckComplete();
    }
}

async function markDeckComplete() {
    const mode = currentMode === 'thai_front' ? 'thai' : 'eng';
    try {
        const response = await fetch(`/complete/${currentDeckId}/${mode}`, { method: 'POST' });
        if (response.ok) {
            // Update local progress data
            if (!progressData[currentDeckId]) {
                progressData[currentDeckId] = { thai: false, eng: false };
            }
            progressData[currentDeckId][mode] = true;
            console.log(`Marked ${currentDeckId} [${mode}] as complete`);
        }
    } catch (err) {
        console.error('Failed to mark complete:', err);
    }
}

function flipCard() {
    if (isFlipped || isAnimating) return;
    const cardEl = document.getElementById('flashcard');
    isFlipped = true;
    cardEl.classList.add('is-flipped');
    document.getElementById('actionArea').classList.add('visible');
    playCurrentAudio();
}

function playCurrentAudio() {
    if (deck.length === 0) return;
    
    // USE THE CORRECT AUDIO TEXT (OVERRIDE or THAI or FULL NAME for letters)
    const textToSpeak = deck[0].audio_text;

    if (audioCache[textToSpeak]) {
        playAudioUrl(audioCache[textToSpeak]);
        return;
    }
    fetch('/speak', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: textToSpeak, speed: 0.9})
    })
    .then(res => {
        if (!res.ok) throw new Error(`TTS failed (${res.status})`);
        return res.blob();
    })
    .then(blob => {
        if (!blob.size) throw new Error('TTS returned empty audio');
        // Only successful audio is cached — a failure here used to be cached
        // as silence and mute that word for the rest of the session.
        const url = URL.createObjectURL(blob);
        audioCache[textToSpeak] = url;
        playAudioUrl(url);
    })
    .catch(e => console.error("Audio failed", e));
}

function showLoading(msg) {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').innerText = msg;
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
}

// Non-blocking error/info notice that replaces alert() popups.
function showToast(message, type = 'error') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 400); // after fade-out
    }, 4000);
}

// ========== NUMBERS GAME ==========

function generateRandomNumber(digits) {
    if (digits === 1) return Math.floor(Math.random() * 10);
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateNumbersChallenges() {
    showLoading("Generating numbers...");
    numbersChallenges = [];
    
    for (let i = 1; i <= 7; i++) {
        const num = generateRandomNumber(i);
        numbersChallenges.push({ number: num, audioUrl: null });
    }
    
    // Preload audio for all numbers using the /speak_number endpoint
    const preloadPromises = numbersChallenges.map(async (challenge, index) => {
        try {
            const response = await fetch('/speak_number', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ number: challenge.number, speed: 0.85 })
            });
            if (!response.ok) throw new Error(`TTS ${response.status}`);
            const blob = await response.blob();
            if (blob.size) challenge.audioUrl = URL.createObjectURL(blob);
        } catch (e) {
            console.error(`Failed to load audio for level ${index + 1}`, e);
        }
    });
    
    await Promise.all(preloadPromises);
    hideLoading();
}

async function startNumbersGame() {
    document.getElementById('categoryMenu').style.display = 'none';
    await generateNumbersChallenges();
    
    currentNumberLevel = 0;
    numbersGameActive = true;
    
    document.getElementById('numbersContainer').style.display = 'flex';
    document.getElementById('numbersCard').style.display = 'flex';
    document.getElementById('numbersVictory').style.display = 'none';
    
    renderNumbersLevel();
    
    // Focus the hidden input
    document.getElementById('numberInput').focus();
    
    // Auto-play first audio after a short delay
    setTimeout(() => playNumberAudio(), 500);
}

function renderNumbersLevel() {
    const level = currentNumberLevel;
    const challenge = numbersChallenges[level];
    const numStr = String(challenge.number);
    const digits = numStr.length;
    
    // Update level indicator
    document.getElementById('numbersLevel').innerText = `Level ${level + 1} of 7`;
    
    // Update progress dots
    const dots = document.querySelectorAll('.level-dot');
    dots.forEach((dot, i) => {
        dot.classList.remove('completed', 'current');
        if (i < level) dot.classList.add('completed');
        else if (i === level) dot.classList.add('current');
    });
    
    // Build digit display with commas
    const digitDisplay = document.getElementById('digitDisplay');
    digitDisplay.innerHTML = '';
    
    // Format: add commas from the right
    for (let i = 0; i < digits; i++) {
        const slot = document.createElement('div');
        slot.className = 'digit-slot';
        slot.dataset.index = i;
        digitDisplay.appendChild(slot);
        
        // Add comma after appropriate positions (from right: every 3 digits)
        const posFromRight = digits - 1 - i;
        if (posFromRight > 0 && posFromRight % 3 === 0) {
            const comma = document.createElement('span');
            comma.className = 'digit-comma';
            comma.innerText = ',';
            digitDisplay.appendChild(comma);
        }
    }
    
    // Reset input
    currentInput = '';
    document.getElementById('numberInput').value = '';
    document.getElementById('numbersMessage').innerText = 'Listen and type the number';
    document.getElementById('numbersMessage').className = 'numbers-message';
}

function playNumberAudio() {
    const challenge = numbersChallenges[currentNumberLevel];
    if (challenge && challenge.audioUrl) {
        playAudioUrl(challenge.audioUrl);
    }
}

function updateDigitDisplay() {
    const slots = document.querySelectorAll('.digit-slot');
    slots.forEach((slot, i) => {
        if (i < currentInput.length) {
            slot.innerText = currentInput[i];
            slot.classList.add('filled');
        } else {
            slot.innerText = '';
            slot.classList.remove('filled');
        }
        slot.classList.remove('correct', 'wrong');
    });
}

function checkNumberAnswer() {
    const challenge = numbersChallenges[currentNumberLevel];
    const correctAnswer = String(challenge.number);
    
    // Lock input immediately when checking
    numbersInputLocked = true;
    
    if (currentInput === correctAnswer) {
        // Correct!
        const slots = document.querySelectorAll('.digit-slot');
        slots.forEach(slot => {
            slot.classList.add('correct');
        });
        
        const card = document.getElementById('numbersCard');
        card.classList.add('anim-pulse-success');
        setTimeout(() => card.classList.remove('anim-pulse-success'), 600);
        
        document.getElementById('numbersMessage').innerText = 'Correct! 🎉';
        document.getElementById('numbersMessage').className = 'numbers-message success';
        
        // Move to next level after delay
        setTimeout(() => {
            if (currentNumberLevel < 6) {
                currentNumberLevel++;
                renderNumbersLevel();
                numbersInputLocked = false; // Unlock for next level
                document.getElementById('numberInput').focus();
                setTimeout(() => playNumberAudio(), 300);
            } else {
                // Won the game!
                showNumbersVictory();
            }
        }, 1000);
        
    } else {
        // Wrong - show which digits were wrong, then reset
        const slots = document.querySelectorAll('.digit-slot');
        slots.forEach((slot, i) => {
            if (currentInput[i] === correctAnswer[i]) {
                slot.classList.add('correct');
            } else {
                slot.classList.add('wrong');
            }
        });
        
        const card = document.getElementById('numbersCard');
        card.classList.add('anim-shake');
        setTimeout(() => card.classList.remove('anim-shake'), 500);
        
        document.getElementById('numbersMessage').innerText = `Wrong! The answer was ${challenge.number.toLocaleString()}. Restarting...`;
        document.getElementById('numbersMessage').className = 'numbers-message error';
        
        // Reset to level 1 with new numbers after delay (input stays locked)
        setTimeout(async () => {
            await generateNumbersChallenges();
            currentNumberLevel = 0;
            renderNumbersLevel();
            numbersInputLocked = false; // Unlock after reset
            document.getElementById('numberInput').focus();
            setTimeout(() => playNumberAudio(), 300);
        }, 2000);
    }
}

function showNumbersVictory() {
    document.getElementById('numbersCard').style.display = 'none';
    document.getElementById('numbersVictory').style.display = 'flex';
}

function restartNumbersGame() {
    startNumbersGame();
}

function exitNumbersGame() {
    numbersGameActive = false;
    document.getElementById('numbersContainer').style.display = 'none';
    document.getElementById('categoryMenu').style.display = 'flex';
}

// Handle keyboard input for numbers game AND flashcards
document.addEventListener('keydown', (e) => {
    // Numbers game input
    if (numbersGameActive && document.getElementById('numbersCard').style.display !== 'none') {
        // Block all input if locked (during transitions)
        if (numbersInputLocked) {
            e.preventDefault();
            return;
        }
        
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault(); // Prevent the hidden input from also receiving this
            const challenge = numbersChallenges[currentNumberLevel];
            const expectedLength = String(challenge.number).length;
            
            if (currentInput.length < expectedLength) {
                currentInput += e.key;
                updateDigitDisplay();
                
                // Check if complete
                if (currentInput.length === expectedLength) {
                    checkNumberAnswer();
                }
            }
        } else if (e.key === 'Backspace') {
            e.preventDefault(); // Prevent the hidden input from also receiving this
            currentInput = currentInput.slice(0, -1);
            updateDigitDisplay();
        } else if (e.key === ' ') {
            e.preventDefault();
            playNumberAudio();
        }
        return;
    }
    
    // Flashcard game input
    if (document.getElementById('gameContainer').style.display === 'flex') {
        // Undo with Ctrl+Z / Cmd+Z
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoLastAction();
            return;
        }
        
        if (!isFlipped && !isAnimating && e.code === 'Space') flipCard();
        if (isFlipped && !isAnimating) {
            if (e.code === 'ArrowLeft') handleResult(false);
            if (e.code === 'ArrowRight') handleResult(true);
        }
    }
});

// Handle mobile input for numbers game (touch keyboards don't trigger keydown reliably)
document.getElementById('numberInput').addEventListener('input', (e) => {
    if (!numbersGameActive || numbersInputLocked) {
        e.target.value = currentInput; // Reset to current state if locked
        return;
    }
    
    const challenge = numbersChallenges[currentNumberLevel];
    const expectedLength = String(challenge.number).length;
    
    // Filter to only digits and sync with currentInput
    const newValue = e.target.value.replace(/[^0-9]/g, '');
    
    // Only process if this is new input (mobile keyboard)
    // Skip if currentInput already matches (means keydown already handled it)
    if (newValue === currentInput) return;
    
    currentInput = newValue.slice(0, expectedLength);
    e.target.value = currentInput;
    updateDigitDisplay();
    
    if (currentInput.length === expectedLength) {
        checkNumberAnswer();
    }
});

// Keep focus on input for mobile
document.getElementById('numbersCard').addEventListener('click', () => {
    document.getElementById('numberInput').focus();
});

// ========== LONG PRESS TO UNDO ==========
function initLongPressUndo() {
    const card = document.getElementById('flashcard');
    
    function startLongPress(e) {
        // Only in flashcard game
        if (document.getElementById('gameContainer').style.display !== 'flex') return;
        if (undoHistory.length === 0) return;
        
        // Start visual feedback
        card.classList.add('long-press-active');
        
        longPressTimer = setTimeout(() => {
            card.classList.remove('long-press-active');
            card.classList.add('long-press-triggered');
            undoLastAction();
            
            // Remove triggered class after animation
            setTimeout(() => {
                card.classList.remove('long-press-triggered');
            }, 300);
        }, LONG_PRESS_DURATION);
    }
    
    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        card.classList.remove('long-press-active');
    }
    
    // Touch events (mobile)
    card.addEventListener('touchstart', startLongPress, { passive: true });
    card.addEventListener('touchend', cancelLongPress);
    card.addEventListener('touchcancel', cancelLongPress);
    card.addEventListener('touchmove', cancelLongPress); // Cancel if finger moves
    
    // Mouse events (desktop fallback)
    card.addEventListener('mousedown', startLongPress);
    card.addEventListener('mouseup', cancelLongPress);
    card.addEventListener('mouseleave', cancelLongPress);
}

initLongPressUndo();

// ========== RE-FIT CARD TEXT ON FONT LOAD / RESIZE ==========
// The first measurement can happen before the Mali/Lexend web fonts load (so it
// measures the fallback font); re-fit once they're ready. Also re-fit on resize
// / orientation change. skipAudio=true so we don't replay the card's audio.
function refitCurrentCard() {
    if (document.getElementById('gameContainer').style.display === 'flex' && deck.length) {
        updateCardContent(true);
    }
}

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(refitCurrentCard);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refitCurrentCard, 150);
});

setupCustomCountButtons();

// Initialize the app
initApp();
