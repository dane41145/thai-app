from flask import Flask, render_template, request, Response, jsonify
import csv
import requests
import io
import urllib.parse
import hashlib
import json
import os
import subprocess
import tempfile

app = Flask(__name__)

# ==========================================
# CONFIGURATION
# ==========================================
# Use environment variables for sensitive data (set these in Render)
AZURE_KEY = os.environ.get('AZURE_KEY')
AZURE_REGION = os.environ.get('AZURE_REGION', 'southeastasia')

if not AZURE_KEY:
    print("⚠️ WARNING: AZURE_KEY environment variable not set!")

SOURCES = {
    "vocab": {
        "sheet_id": "13yvW0q6WXHlabaRjJUSKdreNmHH-NI-_OVtRfndO_e8",
        "tabs": ["Vocab 1", "Vocab 2", "Vocab 3", "Vocab 4", "Vocab 5", "Places", "Numbers"]
    },
    "script": {
        "sheet_id": "1ny4GYNfDmK-vQH84OlpJe1PW-XemKMmVtncaKpTm0Og",
        "tabs": ["V1", "V2", "V3", "P", "N"]
    }
}

# Load from config.json if it exists (overrides the defaults above)
CONFIG_FILE = "config.json"
if os.path.exists(CONFIG_FILE):
    try:
        with open(CONFIG_FILE, 'r') as f:
            SOURCES = json.load(f)
        print(f"✅ Loaded config from {CONFIG_FILE}")
    except Exception as e:
        print(f"⚠️ Could not load {CONFIG_FILE}, using defaults: {e}")

PROGRESS_FILE = "progress.json"
# ==========================================

AUDIO_CACHE = {}
MEMORY_DECKS = {}

# ==========================================
# AZURE TTS REST API (no SDK needed)
# ==========================================
def azure_tts_rest(text, voice, speed=1.0):
    """
    Call Azure TTS using REST API instead of SDK.
    This works on any platform without native library dependencies.
    """
    # Get access token
    token_url = f"https://{AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    headers = {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    try:
        token_response = requests.post(token_url, headers=headers)
        token_response.raise_for_status()
        access_token = token_response.text
    except Exception as e:
        print(f"Token Error: {e}")
        return None
    
    # Call TTS API
    tts_url = f"https://{AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    
    ssml = f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
        <voice name="{voice}">
            <prosody rate="{speed}">{text}</prosody>
        </voice>
    </speak>'''
    
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
        'User-Agent': 'ThaiLearningApp'
    }
    
    try:
        response = requests.post(tts_url, headers=headers, data=ssml.encode('utf-8'))
        response.raise_for_status()
        return response.content
    except Exception as e:
        print(f"TTS Error: {e}")
        return None

# ==========================================
# PROGRESS TRACKING
# ==========================================
def compute_deck_hash(words):
    """Generate a short hash from deck content to detect changes."""
    content = '|'.join(w['thai'] + w.get('eng', '') for w in words)
    return hashlib.md5(content.encode()).hexdigest()[:8]

def load_progress():
    """Load progress from JSON file."""
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_progress(progress):
    """Save progress to JSON file."""
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, indent=2, ensure_ascii=False) 

# ==========================================
# THAI NUMBER CONVERSION
# ==========================================
THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
THAI_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน']

def number_to_thai(n):
    """
    Convert an integer to Thai text representation.
    Handles numbers from 0 to 9,999,999.
    """
    if n == 0:
        return 'ศูนย์'
    
    if n < 0 or n > 9999999:
        return str(n)
    
    result = ''
    
    if n >= 1000000:
        millions = n // 1000000
        result += number_to_thai_under_million(millions) + 'ล้าน'
        n = n % 1000000
    
    if n > 0:
        result += number_to_thai_under_million(n)
    
    return result

def number_to_thai_under_million(n):
    """Convert a number under 1,000,000 to Thai."""
    if n == 0:
        return ''
    
    result = ''
    s = str(n).zfill(6)
    places = ['แสน', 'หมื่น', 'พัน', 'ร้อย', 'สิบ', '']
    
    for i, digit in enumerate(s):
        d = int(digit)
        place = places[i]
        
        if d == 0:
            continue
        
        if place == 'สิบ':
            if d == 1:
                result += 'สิบ'
            elif d == 2:
                result += 'ยี่สิบ'
            else:
                result += THAI_DIGITS[d] + 'สิบ'
        elif place == '':
            if d == 1 and n > 1:
                result += 'เอ็ด'
            else:
                result += THAI_DIGITS[d]
        else:
            result += THAI_DIGITS[d] + place
    
    return result

# ==========================================
# DECK LOADING
# ==========================================
def load_all_decks():
    print("📥 Loading all decks...")
    global MEMORY_DECKS
    MEMORY_DECKS = {}

    for category, config in SOURCES.items():
        sheet_id = config['sheet_id']
        tabs = config['tabs']
        print(f"   👉 Processing category: {category.upper()}")

        for tab_name in tabs:
            encoded_name = urllib.parse.quote(tab_name)
            url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_name}"
            
            try:
                response = requests.get(url)
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
                        audio_text = override if override else thai
                        words.append({
                            'thai': thai,
                            'phonetic': phonetic,
                            'eng': eng,
                            'audio_text': audio_text
                        })
                
                deck_id = f"{category}_{tab_name.replace(' ', '_')}"
                deck_hash = compute_deck_hash(words)
                MEMORY_DECKS[deck_id] = {
                    'name': tab_name,
                    'category': category,
                    'gid': deck_id, 
                    'words': words,
                    'count': len(words),
                    'hash': deck_hash
                }
                status = "✅" if len(words) > 0 else "⚠️"
                print(f"      {status} [{tab_name}]: {len(words)} cards loaded. (hash: {deck_hash})")
                
            except Exception as e:
                print(f"      ❌ Error [{tab_name}]: {e}")

load_all_decks()

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

@app.route('/vocab/<deck_id>')
def get_vocab(deck_id):
    deck = MEMORY_DECKS.get(deck_id)
    return jsonify(deck['words'] if deck else [])

@app.route('/speak', methods=['POST'])
def speak():
    data = request.json
    text = data.get('text', '')
    speed = data.get('speed', 0.9)
    
    cache_key = f"{text}_{speed}"
    if cache_key in AUDIO_CACHE: 
        return Response(AUDIO_CACHE[cache_key], mimetype="audio/mpeg")

    try:
        audio_data = azure_tts_rest(text, "th-TH-PremwadeeNeural", speed)
        if audio_data:
            AUDIO_CACHE[cache_key] = audio_data
            return Response(audio_data, mimetype="audio/mpeg")
    except Exception as e:
        print(f"Audio Error: {e}")
        
    return Response(b'', mimetype="audio/mpeg")

@app.route('/speak_number', methods=['POST'])
def speak_number():
    """Endpoint for numbers - converts to proper Thai text first."""
    data = request.json
    number = data.get('number', 0)
    speed = data.get('speed', 0.85)
    
    try:
        number = int(number)
    except (ValueError, TypeError):
        return Response(b'', mimetype="audio/mpeg")
    
    thai_text = number_to_thai(number)
    print(f"   🔢 Number {number} → Thai: {thai_text}")
    
    cache_key = f"num_{number}_{speed}"
    if cache_key in AUDIO_CACHE: 
        return Response(AUDIO_CACHE[cache_key], mimetype="audio/mpeg")

    try:
        audio_data = azure_tts_rest(thai_text, "th-TH-PremwadeeNeural", speed)
        if audio_data:
            AUDIO_CACHE[cache_key] = audio_data
            return Response(audio_data, mimetype="audio/mpeg")
    except Exception as e:
        print(f"Audio Error: {e}")
        
    return Response(b'', mimetype="audio/mpeg")

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
def clean_english_for_tts(text):
    """
    Clean English text for more natural TTS output.
    - Remove parentheses but keep content: "(I) bought" -> "I bought"
    - Replace " / " with " or ": "already / and then" -> "already or and then"
    """
    import re
    # Remove parentheses but keep the content inside
    text = re.sub(r'\(([^)]*)\)', r'\1', text)
    # Replace slash with "or"
    text = re.sub(r'\s*/\s*', ' or ', text)
    # Clean up any double spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text

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
            if mp3_bytes:
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
        
        # Concatenate using ffmpeg
        output_path = os.path.join(tmpdir, 'output.mp3')
        try:
            subprocess.run([
                'ffmpeg', '-f', 'concat', '-safe', '0', '-i', file_list_path,
                '-c', 'copy', output_path
            ], capture_output=True, check=True)
            
            with open(output_path, 'rb') as f:
                return f.read()
        except Exception as e:
            print(f"Concatenation error: {e}")
            return b''

@app.route('/download_deck/<deck_id>')
def download_deck_mp3(deck_id):
    """Generate and download MP3 for entire vocab deck."""
    import random
    
    # Only allow vocab decks
    if not deck_id.startswith('vocab_'):
        return jsonify({'error': 'MP3 download only available for vocab decks'}), 400
    
    deck = MEMORY_DECKS.get(deck_id)
    if not deck:
        return jsonify({'error': 'Deck not found'}), 404
    
    words = deck['words'].copy()  # Copy to avoid modifying original
    deck_name = deck['name']
    
    # Randomize the order
    random.shuffle(words)
    
    print(f"   🎵 Generating MP3 for {deck_name} ({len(words)} words, randomized)...")
    
    # Pre-generate silence segments
    silence_1s = generate_silence_mp3(1000)   # 1 second
    silence_2s = generate_silence_mp3(2000)   # 2 seconds
    silence_3s = generate_silence_mp3(3000)   # 3 seconds
    
    # Build list of all audio segments
    all_segments = []
    
    for i, word in enumerate(words):
        thai_text = word.get('audio_text', word['thai'])
        eng_text = word['eng']
        
        # Clean English text for more natural TTS
        eng_text_clean = clean_english_for_tts(eng_text)
        
        print(f"      Processing {i+1}/{len(words)}: {thai_text} / {eng_text_clean}")
        
        # Generate audio clips (Thai only needs to be generated once, we'll reuse it)
        thai_audio = generate_audio_bytes(thai_text, "th-TH-PremwadeeNeural", 0.9)
        eng_audio = generate_audio_bytes(eng_text_clean, "en-US-JennyNeural", 1.0)
        
        # Workflow:
        # 1. Thai audio
        if thai_audio:
            all_segments.append(thai_audio)
        
        # 2. Wait 2 seconds
        all_segments.append(silence_2s)
        
        # 3. English audio
        if eng_audio:
            all_segments.append(eng_audio)
        
        # 4. Wait 1 second
        all_segments.append(silence_1s)
        
        # 5. Thai audio (again)
        if thai_audio:
            all_segments.append(thai_audio)
        
        # 6. Wait 3 seconds before next word
        all_segments.append(silence_3s)
    
    # Concatenate all segments
    print(f"      Concatenating {len(all_segments)} segments...")
    combined = concatenate_mp3_files(all_segments)
    
    # Create filename
    safe_name = deck_name.replace(' ', '_')
    filename = f"{safe_name}.mp3"
    
    print(f"   ✅ MP3 generated: {filename}")
    
    return Response(
        combined,
        mimetype="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

if __name__ == '__main__':
    app.run(debug=True, port=5001)
