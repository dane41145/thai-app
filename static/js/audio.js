// Azure TTS via /speak, shared by the flashcards page and the /classes game.

const audioCache = {};    // audio_text -> object URL of synthesised MP3
const audioPending = {};  // audio_text -> in-flight fetch, so preload + play don't double-request

// Fetch TTS for `text` (once), resolving to a playable object URL.
function fetchAudio(text) {
    if (audioCache[text]) return Promise.resolve(audioCache[text]);
    if (audioPending[text]) return audioPending[text];
    const p = fetch('/speak', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text, speed: 0.9})
    })
    .then(res => {
        if (!res.ok) throw new Error(`TTS failed (${res.status})`);
        return res.blob();
    })
    .then(blob => {
        if (!blob.size) throw new Error('TTS returned empty audio');
        // Only successful audio is cached — a failure here used to be cached
        // as silence and mute that word for the rest of the session.
        audioCache[text] = URL.createObjectURL(blob);
        return audioCache[text];
    })
    .finally(() => { delete audioPending[text]; });
    audioPending[text] = p;
    return p;
}

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
