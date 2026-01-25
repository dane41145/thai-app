const audioCache = {};
let allDecksData = []; 
let progressData = {}; // Track completion status
let fullVocab = []; 
let deck = [];      
let currentMode = 'thai_front';
let currentCategory = 'vocab';
let currentDeckName = '';
let currentDeckId = '';
let isFlipped = false;
let isAnimating = false;

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
                    <button class="deck-reset-btn" title="Reset progress" data-deck-id="${d.gid}">🔄</button>
                    ${isVocab ? `<button class="deck-download-btn" title="Download MP3" data-deck-id="${d.gid}">⬇️</button>` : ''}
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

async function downloadDeckMp3(deckId, deckName) {
    // Show loading indicator
    showLoading(`Generating ${deckName} MP3... This may take a minute.`);
    
    try {
        const response = await fetch(`/download_deck/${deckId}`);
        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${deckName.replace(' ', '_')}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            alert('Failed to generate MP3');
        }
    } catch (err) {
        console.error('Download failed:', err);
        alert('Failed to download MP3');
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
        alert('Failed to generate sentences: ' + err.message);
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
            }).then(r=>r.blob()).then(b => { audioCache[words[i].audio_text] = URL.createObjectURL(b); });
        }

        fullVocab = [...words];
        hideLoading();
        startGameUI();
    } catch (err) {
        alert("Failed to load deck data.");
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

function restartRound() {
    deck = [...fullVocab]; 
    deck.sort(() => Math.random() - 0.5);
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

function updateCardContent() {
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

    function setSize(el, text, isThai) {
        el.className = isThai ? 'thai-font' : 'eng-font';
        const len = text.length;
        // Maximize size - start big and scale down based on length
        if (len <= 2) el.classList.add('text-jumbo');
        else if (len <= 5) el.classList.add('text-huge');
        else if (len <= 12) el.classList.add('text-large');
        else if (len <= 25) el.classList.add('text-med');
        else el.classList.add('text-small');
    }

    // === 1. VOCAB LOGIC ===
    if (currentCategory === 'vocab') {
        if (currentMode === 'thai_front') {
            // Front
            frontText.innerText = cardData.thai;
            setSize(frontText, cardData.thai, true);
            if(cardData.phonetic) {
                frontPhonetic.innerText = `/${cardData.phonetic}/`;
                frontPhonetic.style.display = 'block';
            }
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
            setSize(backText, cardData.thai, true);
            if(cardData.phonetic) {
                backPhonetic.innerText = `/${cardData.phonetic}/`;
                backPhonetic.style.display = 'block';
            }
            backBtn.style.display = 'flex';
        }
    } 
    
    // === 2. SCRIPT LOGIC ===
    else if (currentCategory === 'script') {
        if (currentMode === 'thai_front') {
            // Thai Front Mode: Shows transliteration on front, Thai + English on back
            // Front: transliteration + audio (autoplay)
            frontText.innerText = cardData.phonetic;
            setSize(frontText, cardData.phonetic, false);
            frontBtn.style.display = 'flex';
            
            // Back: Thai script + English meaning below
            backText.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
                    <span class="thai-font text-huge">${cardData.thai}</span>
                    <span class="eng-font text-med" style="color: #666;">${cardData.eng || ''}</span>
                </div>
            `;
            backText.className = '';
        } else {
            // English Front Mode: Shows English on front, Thai + transliteration on back
            // Front: English meaning
            frontText.innerText = cardData.eng || '';
            setSize(frontText, cardData.eng || '', false);
            
            // Back: Thai script + transliteration + audio
            backText.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                    <span class="thai-font text-huge">${cardData.thai}</span>
                    <span class="phonetic">/${cardData.phonetic}/</span>
                </div>
            `;
            backText.className = '';
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
        // Size based on length - bigger and scales down for longer sentences
        const len = cardData.thai.length;
        if (len <= 10) backText.classList.add('text-huge');
        else if (len <= 18) backText.classList.add('text-large');
        else if (len <= 30) backText.classList.add('text-med');
        else backText.classList.add('text-small');
        
        backBtn.style.display = 'flex';
    }

    // Auto-play audio for Thai front mode in vocab and script
    if ((currentCategory === 'vocab' || currentCategory === 'script') && currentMode === 'thai_front') playCurrentAudio();
}

function renderCard() { updateCardContent(); }

function showVictory() {
    document.getElementById('gameArea').style.display = 'none';
    document.getElementById('actionArea').style.display = 'none';
    document.getElementById('topControls').style.visibility = 'hidden';
    document.getElementById('victoryArea').style.display = 'flex';
    
    // Mark this deck/mode as complete (skip for letters and speaking)
    if (currentCategory !== 'letters' && currentCategory !== 'speaking') {
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
        new Audio(audioCache[textToSpeak]).play();
        return;
    }
    fetch('/speak', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: textToSpeak, speed: 0.9})
    })
    .then(res => res.blob())
    .then(blob => {
        const url = URL.createObjectURL(blob);
        audioCache[textToSpeak] = url;
        new Audio(url).play();
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
            const blob = await response.blob();
            challenge.audioUrl = URL.createObjectURL(blob);
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
        new Audio(challenge.audioUrl).play();
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

// Initialize the app
initApp();
