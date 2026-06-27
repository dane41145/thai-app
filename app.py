from flask import Flask, render_template, request, Response, jsonify
import csv
import requests
import io
import urllib.parse
import json
import os
import subprocess
import tempfile
import re
import random
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from xml.sax.saxutils import escape

from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

from thai_utils import LRUCache, clean_english_for_tts, compute_deck_hash, number_to_thai

load_dotenv()  # pull AZURE_KEY / AZURE_REGION / GEMINI_KEY from a local .env, if present

app = Flask(__name__)

# Render/Heroku terminate TLS at a single proxy hop; trust one X-Forwarded-For
# entry so rate limits apply to the real client IP, not the proxy's.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# Per-IP rate limits for the endpoints that cost money (Azure / Gemini) or
# hammer Google Sheets. Only routes with an explicit @limiter.limit are limited.
# In-memory storage is fine here because the app runs as a single process.
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://")


@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({'error': f'Rate limit exceeded: {e.description}'}), 429

# ==========================================
# CONFIGURATION
# ==========================================
# Use environment variables for sensitive data (set these in Render)
AZURE_KEY = os.environ.get('AZURE_KEY')
AZURE_REGION = os.environ.get('AZURE_REGION', 'southeastasia')
GEMINI_KEY = os.environ.get('GEMINI_KEY')

if not AZURE_KEY:
    print("⚠️ WARNING: AZURE_KEY environment variable not set!")
if not GEMINI_KEY:
    print("⚠️ WARNING: GEMINI_KEY environment variable not set!")

# Deck sources (sheet IDs + which tabs to load) live ONLY in config.json,
# so there's a single source of truth. To add a new deck, add its tab name
# in config.json — nothing in this file needs to change.
CONFIG_FILE = "config.json"
try:
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        SOURCES = json.load(f)
    print(f"✅ Loaded deck config from {CONFIG_FILE}")
except FileNotFoundError:
    print(f"❌ FATAL: {CONFIG_FILE} not found — it defines which spreadsheet tabs to load.")
    sys.exit(1)
except json.JSONDecodeError as e:
    print(f"❌ FATAL: Could not parse {CONFIG_FILE}: {e}")
    sys.exit(1)

PROGRESS_FILE = "progress.json"

# Network timeouts (connect, read) in seconds, so a hung request can't stall us.
SHEET_TIMEOUT = (5, 15)
AZURE_TIMEOUT = (5, 30)

MAX_TTS_CHARS = 300    # cap /speak input — it's a paid API
AZURE_TOKEN_TTL = 480  # Azure tokens are valid 10 min; reuse ours for 8
# ==========================================


AUDIO_CACHE = LRUCache(maxsize=512)   # bounded: evicts least-recently-used audio
MEMORY_DECKS = {}                     # swapped atomically by load_all_decks()
DECKS_LOCK = threading.Lock()         # serializes reloads (startup + /refresh)
PROGRESS_LOCK = threading.Lock()      # serializes read-modify-write of progress.json

AZURE_TOKEN = {'value': None, 'expires': 0.0}
AZURE_TOKEN_LOCK = threading.Lock()

# ==========================================
# AZURE TTS REST API (no SDK needed)
# ==========================================
def _get_azure_token():
    """Return a cached Azure auth token, fetching a new one only when expired.

    Tokens are valid for 10 minutes; we reuse one for AZURE_TOKEN_TTL (8 min).
    Previously every synthesis call fetched a fresh token, doubling latency
    and request volume — MP3 deck jobs especially.
    """
    if not AZURE_KEY:
        return None

    with AZURE_TOKEN_LOCK:
        if AZURE_TOKEN['value'] and time.time() < AZURE_TOKEN['expires']:
            return AZURE_TOKEN['value']

        token_url = f"https://{AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
        headers = {
            'Ocp-Apim-Subscription-Key': AZURE_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        try:
            response = requests.post(token_url, headers=headers, timeout=AZURE_TIMEOUT)
            response.raise_for_status()
            AZURE_TOKEN['value'] = response.text
            AZURE_TOKEN['expires'] = time.time() + AZURE_TOKEN_TTL
            return AZURE_TOKEN['value']
        except Exception as e:
            print(f"Token Error: {e}")
            return None


def azure_tts_rest(text, voice, speed=1.0):
    """
    Call Azure TTS using REST API instead of SDK.
    This works on any platform without native library dependencies.
    """
    access_token = _get_azure_token()
    if not access_token:
        return None

    try:
        speed = max(0.5, min(2.0, float(speed)))
    except (TypeError, ValueError):
        speed = 1.0

    tts_url = f"https://{AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

    # escape() keeps &, <, > in card text from breaking the XML — and blocks
    # SSML tag injection via user-supplied text.
    ssml = f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
        <voice name="{voice}">
            <prosody rate="{speed}">{escape(str(text))}</prosody>
        </voice>
    </speak>'''

    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
        'User-Agent': 'ThaiLearningApp'
    }

    try:
        response = requests.post(tts_url, headers=headers, data=ssml.encode('utf-8'), timeout=AZURE_TIMEOUT)
        response.raise_for_status()
        return response.content
    except Exception as e:
        print(f"TTS Error: {e}")
        return None

# ==========================================
# PROGRESS TRACKING
# ==========================================
def load_progress():
    """Load progress from JSON file."""
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ Could not read {PROGRESS_FILE} ({e}); starting with empty progress")
            return {}
    return {}

def save_progress(progress):
    """Save progress atomically: write a unique temp file, then rename it over
    the real one. A crash mid-write can no longer corrupt the file (which the
    old code would then silently swallow, resetting all progress)."""
    fd, tmp_path = tempfile.mkstemp(prefix='progress_', suffix='.tmp', dir='.')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(progress, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, PROGRESS_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

# ==========================================
# DECK LOADING
# ==========================================
def _fetch_one_deck(category, sheet_id, tab_name):
    """Fetch and parse a single sheet tab. Returns (deck_id, deck) or (deck_id, None)."""
    deck_id = f"{category}_{tab_name.replace(' ', '_')}"
    encoded_name = urllib.parse.quote(tab_name)
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_name}"

    try:
        response = requests.get(url, timeout=SHEET_TIMEOUT)
        response.raise_for_status()

        csv_data = response.content.decode('utf-8')
        csv_reader = csv.DictReader(io.StringIO(csv_data))

        words = []
        for row in csv_reader:
            clean_row = {k.strip(): v.strip() for k, v in row.items() if k}

            thai = clean_row.get('Thai', '')
            phonetic = clean_row.get('Pronunciation', '')
            eng = clean_row.get('English', '')
            override = clean_row.get('Override', '')

            if category == 'script' and not eng:
                eng = phonetic

            if thai and eng:
                words.append({
                    'thai': thai,
                    'phonetic': phonetic,
                    'eng': eng,
                    'audio_text': override if override else thai
                })

        deck = {
            'name': tab_name,
            'category': category,
            'gid': deck_id,
            'words': words,
            'count': len(words),
            'hash': compute_deck_hash(words)
        }
        status = "✅" if words else "⚠️"
        print(f"      {status} [{tab_name}]: {len(words)} cards (hash: {deck['hash']})")
        return deck_id, deck

    except Exception as e:
        print(f"      ❌ Error [{tab_name}]: {e}")
        return deck_id, None


def load_all_decks():
    """Fetch every configured tab in parallel and atomically swap the result in.

    Runs at startup and on POST /refresh. Individual tab failures are logged and
    skipped (never fatal); a hung request is bounded by SHEET_TIMEOUT.
    """
    print("📥 Loading all decks (parallel)...")
    tasks = [
        (category, config['sheet_id'], tab_name)
        for category, config in SOURCES.items()
        for tab_name in config['tabs']
    ]

    with DECKS_LOCK:  # don't let startup and /refresh (or two refreshes) overlap
        new_decks = {}
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(_fetch_one_deck, c, s, t) for (c, s, t) in tasks]
            for future in as_completed(futures):
                deck_id, deck = future.result()
                if deck is not None:
                    new_decks[deck_id] = deck

        # Atomic swap: readers always see a complete, consistent deck set.
        global MEMORY_DECKS
        MEMORY_DECKS = new_decks

    print(f"📚 Loaded {len(new_decks)} of {len(tasks)} decks.")
    return len(new_decks)


load_all_decks()
if not MEMORY_DECKS:
    print("⚠️ WARNING: No decks loaded. Check config.json / network. POST /refresh to retry.")

# ==========================================
# ROUTES
# ==========================================
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/decks')
def get_decks():
    deck_list = []
    for d_id, data in MEMORY_DECKS.items():
        deck_list.append({
            'name': data['name'],
            'gid': d_id,
            'category': data['category'],
            'count': data['count'],
            'hash': data['hash']
        })
    return jsonify(deck_list)

@app.route('/refresh', methods=['POST'])
@limiter.limit("2/minute")
def refresh_decks():
    """Reload decks from Google Sheets without restarting the server.

    Useful after editing the spreadsheet — call this instead of redeploying.
    """
    count = load_all_decks()
    return jsonify({'status': 'ok', 'decks': count})

@app.route('/vocab/<deck_id>')
def get_vocab(deck_id):
    deck = MEMORY_DECKS.get(deck_id)
    return jsonify(deck['words'] if deck else [])

@app.route('/custom_deck', methods=['POST'])
def custom_deck():
    """Build an ad-hoc review deck: pool cards from the chosen vocab decks,
    de-duplicate (Arc/Archive overlap heavily), shuffle, and return up to
    `count` of them."""
    data = request.get_json(silent=True) or {}
    deck_ids = data.get('deck_ids', [])
    try:
        count = int(data.get('count', 50))
    except (ValueError, TypeError):
        count = 50
    count = max(1, min(count, 500))

    if not isinstance(deck_ids, list) or not deck_ids:
        return jsonify({'error': 'No decks selected'}), 400

    pool = []
    seen = set()
    for did in deck_ids:
        deck = MEMORY_DECKS.get(did)
        if not deck or deck['category'] != 'vocab':
            continue
        for w in deck['words']:
            key = (w['thai'], w['eng'])
            if key not in seen:
                seen.add(key)
                pool.append(w)

    random.shuffle(pool)
    selected = pool[:count]
    return jsonify({
        'words': selected,
        'total_available': len(pool),
        'count': len(selected),
    })

@app.route('/generate_sentences', methods=['POST'])
@limiter.limit("5/minute")
def generate_sentences():
    """
    Generate Thai sentences using only words from the wordbank.
    Uses Gemini API to create natural sentences.
    """
    if not GEMINI_KEY:
        return jsonify({'error': 'Gemini API key not configured'}), 500
    
    # Collect all vocab words into wordbank
    wordbank = []
    for deck_id, deck_data in MEMORY_DECKS.items():
        if deck_data['category'] == 'vocab':
            for word in deck_data['words']:
                wordbank.append({
                    'thai': word['thai'],
                    'english': word['eng'],
                    'phonetic': word.get('phonetic', '')
                })
    
    if not wordbank:
        return jsonify({'error': 'No words in wordbank'}), 400
    
    # Create a compact word list for the prompt
    word_list = [f"{w['thai']} ({w['english']})" for w in wordbank]
    word_list_text = ", ".join(word_list)
    
    # Call Gemini API
    prompt = f"""You are a Thai language teacher. Create exactly 10 simple, natural Thai sentences for a beginner student.

CRITICAL RULES:
1. Use ONLY words from this wordbank - no other Thai words allowed: {word_list_text}
2. Each sentence should be 3-6 words long
3. Sentences should be practical and natural
4. Separate Thai words with spaces
5. Include subject pronouns when natural

Respond in this exact JSON format (no other text):
[
  {{"thai": "ผม กิน ข้าว", "english": "I eat rice"}},
  {{"thai": "เธอ ชอบ กาแฟ", "english": "She likes coffee"}}
]

Generate 10 sentences now:"""

    try:
        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}"
        
        response = requests.post(gemini_url, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048
            }
        }, timeout=30)
        
        response.raise_for_status()
        result = response.json()
        
        # Extract the generated text
        generated_text = result['candidates'][0]['content']['parts'][0]['text']
        
        # Parse JSON from response (handle markdown code blocks)
        json_match = re.search(r'\[.*\]', generated_text, re.DOTALL)
        if json_match:
            sentences = json.loads(json_match.group())
        else:
            return jsonify({'error': 'Could not parse Gemini response'}), 500
        
        # Add audio_text field for TTS
        for sentence in sentences:
            # Remove spaces for audio (Thai TTS handles it better without spaces)
            sentence['audio_text'] = sentence['thai'].replace(' ', '')
        
        print(f"✅ Generated {len(sentences)} sentences")
        return jsonify(sentences)
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Gemini API timeout'}), 504
    except Exception as e:
        print(f"❌ Gemini API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/speak', methods=['POST'])
@limiter.limit("60/minute")
def speak():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    speed = data.get('speed', 0.9)

    if not text:
        return jsonify({'error': 'No text provided'}), 400
    if len(text) > MAX_TTS_CHARS:
        return jsonify({'error': f'Text too long (max {MAX_TTS_CHARS} chars)'}), 400

    cache_key = f"{text}_{speed}"
    cached = AUDIO_CACHE.get(cache_key)
    if cached is not None:
        return Response(cached, mimetype="audio/mpeg")

    try:
        audio_data = azure_tts_rest(text, "th-TH-PremwadeeNeural", speed)
        if audio_data:
            AUDIO_CACHE.put(cache_key, audio_data)
            return Response(audio_data, mimetype="audio/mpeg")
    except Exception as e:
        print(f"Audio Error: {e}")

    # A real error status (not 200 with an empty body) so the client knows
    # not to cache the failure.
    return jsonify({'error': 'TTS unavailable'}), 503

@app.route('/speak_number', methods=['POST'])
@limiter.limit("30/minute")
def speak_number():
    """Endpoint for numbers - converts to proper Thai text first."""
    data = request.get_json(silent=True) or {}
    number = data.get('number', 0)
    speed = data.get('speed', 0.85)

    try:
        number = int(number)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid number'}), 400

    thai_text = number_to_thai(number)
    print(f"   🔢 Number {number} → Thai: {thai_text}")

    cache_key = f"num_{number}_{speed}"
    cached = AUDIO_CACHE.get(cache_key)
    if cached is not None:
        return Response(cached, mimetype="audio/mpeg")

    try:
        audio_data = azure_tts_rest(thai_text, "th-TH-PremwadeeNeural", speed)
        if audio_data:
            AUDIO_CACHE.put(cache_key, audio_data)
            return Response(audio_data, mimetype="audio/mpeg")
    except Exception as e:
        print(f"Audio Error: {e}")

    return jsonify({'error': 'TTS unavailable'}), 503

@app.route('/number_to_thai/<int:number>')
def get_thai_number(number):
    """Debug endpoint to see the Thai text for a number."""
    return jsonify({
        'number': number,
        'thai': number_to_thai(number)
    })

# ==========================================
# PROGRESS TRACKING ROUTES
# ==========================================
@app.route('/progress')
def get_progress():
    """Get all progress data, auto-reset any decks whose hash has changed."""
    with PROGRESS_LOCK:
        progress = load_progress()
        updated = False

        # Check each deck's hash and reset if changed
        for deck_id, deck_data in MEMORY_DECKS.items():
            current_hash = deck_data['hash']
            if deck_id in progress:
                stored_hash = progress[deck_id].get('hash', '')
                if stored_hash != current_hash:
                    # Deck content changed - reset progress
                    print(f"   🔄 Deck '{deck_id}' changed (hash {stored_hash} → {current_hash}), resetting progress")
                    progress[deck_id] = {
                        'hash': current_hash,
                        'thai': False,
                        'eng': False
                    }
                    updated = True
            else:
                # New deck - initialize progress
                progress[deck_id] = {
                    'hash': current_hash,
                    'thai': False,
                    'eng': False
                }
                updated = True

        if updated:
            save_progress(progress)

    return jsonify(progress)

@app.route('/complete/<deck_id>/<mode>', methods=['POST'])
def mark_complete(deck_id, mode):
    """Mark a deck/mode as complete. Mode should be 'thai' or 'eng'."""
    if mode not in ['thai', 'eng']:
        return jsonify({'error': 'Invalid mode'}), 400
    
    if deck_id not in MEMORY_DECKS:
        return jsonify({'error': 'Deck not found'}), 404
    
    with PROGRESS_LOCK:
        progress = load_progress()
        current_hash = MEMORY_DECKS[deck_id]['hash']

        if deck_id not in progress:
            progress[deck_id] = {
                'hash': current_hash,
                'thai': False,
                'eng': False
            }

        progress[deck_id][mode] = True
        progress[deck_id]['hash'] = current_hash
        save_progress(progress)

    print(f"   ✅ Marked {deck_id} [{mode}] as complete")
    return jsonify({'success': True, 'deck_id': deck_id, 'mode': mode})

@app.route('/reset/<deck_id>', methods=['POST'])
def reset_deck(deck_id):
    """Reset progress for a specific deck."""
    if deck_id not in MEMORY_DECKS:
        return jsonify({'error': 'Deck not found'}), 404
    
    with PROGRESS_LOCK:
        progress = load_progress()
        current_hash = MEMORY_DECKS[deck_id]['hash']

        progress[deck_id] = {
            'hash': current_hash,
            'thai': False,
            'eng': False
        }
        save_progress(progress)

    print(f"   🔄 Reset progress for {deck_id}")
    return jsonify({'success': True, 'deck_id': deck_id})

# ==========================================
# MP3 DOWNLOAD
# ==========================================
def generate_audio_bytes(text, voice, speed=0.9):
    """Generate audio for text and return as bytes using REST API."""
    return azure_tts_rest(text, voice, speed)

def generate_silence_mp3(duration_ms, sample_rate=16000):
    """Generate silent MP3 using ffmpeg."""
    duration_sec = duration_ms / 1000.0
    try:
        result = subprocess.run([
            'ffmpeg', '-f', 'lavfi', '-i', f'anullsrc=r={sample_rate}:cl=mono',
            '-t', str(duration_sec), '-q:a', '9', '-f', 'mp3', '-'
        ], capture_output=True, check=True)
        return result.stdout
    except Exception as e:
        print(f"Silence generation error: {e}")
        return b''

def concatenate_mp3_files(mp3_bytes_list):
    """Concatenate multiple MP3 byte arrays using ffmpeg."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write each MP3 to a temp file
        file_list_path = os.path.join(tmpdir, 'files.txt')
        file_paths = []
        
        for i, mp3_bytes in enumerate(mp3_bytes_list):
            if mp3_bytes and len(mp3_bytes) > 0:
                file_path = os.path.join(tmpdir, f'part_{i:04d}.mp3')
                with open(file_path, 'wb') as f:
                    f.write(mp3_bytes)
                file_paths.append(file_path)
        
        if not file_paths:
            return b''
        
        # Create file list for ffmpeg concat
        with open(file_list_path, 'w') as f:
            for path in file_paths:
                f.write(f"file '{path}'\n")
        
        # Concatenate using ffmpeg - re-encode to ensure consistent format
        output_path = os.path.join(tmpdir, 'output.mp3')
        try:
            result = subprocess.run([
                'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', file_list_path,
                '-acodec', 'libmp3lame', '-ar', '16000', '-ab', '32k', '-ac', '1',
                output_path
            ], capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"FFmpeg error: {result.stderr}")
                return b''
            
            with open(output_path, 'rb') as f:
                return f.read()
        except Exception as e:
            print(f"Concatenation error: {e}")
            return b''

# --- Background MP3 jobs ------------------------------------------------------
# Generating a deck MP3 makes 2 Azure calls per word + ffmpeg, which is far too
# slow for one HTTP request. Instead we run it on a background thread and let the
# client poll for progress, then fetch the finished file.
DOWNLOAD_JOBS = {}                  # job_id -> {state, progress, total, deck_name, mp3, error}
DOWNLOAD_JOBS_LOCK = threading.Lock()
MAX_DOWNLOAD_JOBS = 20             # keep memory bounded; prune oldest finished jobs


def _set_job(job_id, **fields):
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(job_id)
        if job is not None:
            job.update(fields)


def _prune_jobs():
    """Drop the oldest finished jobs so DOWNLOAD_JOBS can't grow without bound."""
    with DOWNLOAD_JOBS_LOCK:
        excess = len(DOWNLOAD_JOBS) - MAX_DOWNLOAD_JOBS
        if excess <= 0:
            return
        finished = [jid for jid, j in DOWNLOAD_JOBS.items() if j['state'] in ('done', 'error')]
        for jid in finished[:excess]:  # dict preserves insertion order → oldest first
            DOWNLOAD_JOBS.pop(jid, None)


def _run_download_job(job_id, deck_id):
    """Worker thread: synthesize every word and concatenate into one MP3."""
    try:
        deck = MEMORY_DECKS.get(deck_id)
        if not deck:
            _set_job(job_id, state='error', error='Deck not found')
            return

        words = deck['words'].copy()  # copy so shuffle doesn't touch the original
        random.shuffle(words)
        total = len(words)
        _set_job(job_id, state='running', total=total, progress=0)
        print(f"   🎵 [{job_id[:8]}] Generating MP3 for {deck['name']} ({total} words)...")

        silence_1s = generate_silence_mp3(1000)
        silence_2s = generate_silence_mp3(2000)
        silence_3s = generate_silence_mp3(3000)

        all_segments = []
        for i, word in enumerate(words):
            thai_text = word.get('audio_text', word['thai'])
            eng_text_clean = clean_english_for_tts(word['eng'])

            thai_audio = generate_audio_bytes(thai_text, "th-TH-PremwadeeNeural", 0.9)
            eng_audio = generate_audio_bytes(eng_text_clean, "en-US-JennyNeural", 1.0)

            # Sequence per word: Thai, pause, English, pause, Thai, pause.
            if thai_audio:
                all_segments.append(thai_audio)
            all_segments.append(silence_2s)
            if eng_audio:
                all_segments.append(eng_audio)
            all_segments.append(silence_1s)
            if thai_audio:
                all_segments.append(thai_audio)
            all_segments.append(silence_3s)

            _set_job(job_id, progress=i + 1)

        combined = concatenate_mp3_files(all_segments)
        if not combined:
            _set_job(job_id, state='error', error='No audio generated (is AZURE_KEY set?)')
            return

        _set_job(job_id, state='done', mp3=combined)
        print(f"   ✅ [{job_id[:8]}] MP3 ready for {deck['name']}")
    except Exception as e:
        print(f"   ❌ [{job_id[:8]}] MP3 job failed: {e}")
        _set_job(job_id, state='error', error=str(e))


@app.route('/download_deck/<deck_id>/start', methods=['POST'])
@limiter.limit("3/minute;20/hour")
def start_download(deck_id):
    """Kick off MP3 generation in the background; returns a job_id to poll."""
    if not deck_id.startswith('vocab_'):
        return jsonify({'error': 'MP3 download only available for vocab decks'}), 400

    deck = MEMORY_DECKS.get(deck_id)
    if not deck:
        return jsonify({'error': 'Deck not found'}), 404

    _prune_jobs()
    job_id = uuid.uuid4().hex
    with DOWNLOAD_JOBS_LOCK:
        DOWNLOAD_JOBS[job_id] = {
            'state': 'pending', 'progress': 0, 'total': deck['count'],
            'deck_name': deck['name'], 'mp3': None, 'error': None,
        }
    threading.Thread(target=_run_download_job, args=(job_id, deck_id), daemon=True).start()
    return jsonify({'job_id': job_id, 'total': deck['count'], 'deck_name': deck['name']})


@app.route('/download_status/<job_id>')
def download_status(job_id):
    """Poll a job's progress (does not return the audio bytes)."""
    job = DOWNLOAD_JOBS.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify({
        'state': job['state'], 'progress': job['progress'],
        'total': job['total'], 'deck_name': job['deck_name'], 'error': job['error'],
    })


@app.route('/download_result/<job_id>')
def download_result(job_id):
    """Download the finished MP3 once the job is done (and free its memory)."""
    job = DOWNLOAD_JOBS.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    if job['state'] != 'done':
        return jsonify({'error': f"Job not ready (state: {job['state']})"}), 409

    mp3 = job['mp3']
    safe_name = job['deck_name'].replace(' ', '_')
    with DOWNLOAD_JOBS_LOCK:  # hand off the bytes, then release them
        DOWNLOAD_JOBS.pop(job_id, None)

    return Response(
        mp3,
        mimetype="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename={safe_name}.mp3"}
    )

if __name__ == '__main__':
    app.run(debug=True, port=5001)
