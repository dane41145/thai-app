"""Pure logic shared by the Thai flashcards app — no Flask, no network.

Kept import-light so the unit tests in tests/ can exercise this module
without importing the web app (which fetches all decks from Google Sheets
at import time).
"""
import hashlib
import random
import re
import threading
from collections import OrderedDict


class LRUCache:
    """Thread-safe, size-bounded LRU cache for audio blobs (bytes)."""
    def __init__(self, maxsize=512):
        self.maxsize = maxsize
        self._store = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._store:
                return None
            self._store.move_to_end(key)
            return self._store[key]

    def put(self, key, value):
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self.maxsize:
                self._store.popitem(last=False)


def compute_deck_hash(words):
    """Generate a short hash from deck content to detect changes."""
    content = '|'.join(w['thai'] + w.get('eng', '') for w in words)
    return hashlib.md5(content.encode()).hexdigest()[:8]


# ==========================================
# CUSTOM DECKS
# ==========================================
def pool_unique_words(decks):
    """Pool the words of several decks into one list, one card per Thai word.

    The key is the Thai text alone: the same word is often entered in several
    decks with slightly different English ("stingy" vs "stingy, cheap"), and
    keying on (thai, eng) let those through as duplicate cards. The first
    occurrence wins, so callers should pass decks in display order.
    """
    pool = []
    seen = set()
    for deck in decks:
        for w in deck['words']:
            if w['thai'] not in seen:
                seen.add(w['thai'])
                pool.append(w)
    return pool


def sample_preferring_unseen(pool, count, exclude=(), rng=random):
    """Random sample of up to `count` cards (None = the whole pool) that uses
    cards whose Thai is in `exclude` only when the rest of the pool runs out.

    Returns (cards, recycled); recycled is True when excluded cards had to be
    reused, i.e. the caller has now cycled through the whole pool.
    """
    exclude = set(exclude)
    shuffled = list(pool)
    rng.shuffle(shuffled)
    shuffled.sort(key=lambda w: w['thai'] in exclude)  # stable: fresh cards first
    selected = shuffled if count is None else shuffled[:count]
    recycled = any(w['thai'] in exclude for w in selected)
    rng.shuffle(selected)  # don't leave the recycled cards bunched at the end
    return selected, recycled


# ==========================================
# THAI NUMBER CONVERSION
# ==========================================
THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']


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


def clean_english_for_tts(text):
    """
    Clean English text for more natural TTS output.
    - Remove parentheses but keep content: "(I) bought" -> "I bought"
    - Replace " / " with " or ": "already / and then" -> "already or and then"
    """
    # Remove parentheses but keep the content inside
    text = re.sub(r'\(([^)]*)\)', r'\1', text)
    # Replace slash with "or"
    text = re.sub(r'\s*/\s*', ' or ', text)
    # Clean up any double spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# ==========================================
# MP3 STUDY TRACK
# ==========================================
# Deck exports are MPEG-2 Layer III, 24 kHz mono: every frame holds 24 ms of
# audio whatever its bitrate. Botnoi sends that as VBR; Azure's export format
# is the same stream at a constant 48 kbps. Either way we can join clips
# frame-for-frame, write silence, and measure durations without ffmpeg.
MP3_EXPORT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'   # Azure's name for it
MP3_FRAME_BYTES = 144                                    # one 48 kbps frame
MP3_FRAME_MS = 24
_SILENT_FRAME = bytes.fromhex('fff364c4') + bytes(MP3_FRAME_BYTES - 4)
_KBPS = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)  # MPEG-2 Layer III

# A frame this many global_gain steps (1.5 dB each) under the clip's loudest
# is treated as silence when trimming: ~36 dB down, i.e. room tone.
SILENCE_BELOW_PEAK = 24

# Pause lengths (ms). Clips are trimmed to tight padding, so these are
# close to what the listener actually hears.
GAP_BETWEEN_PARTS = 1200      # Thai → English → slow Thai, within one word
GAP_AFTER_INTRO = 1500
GAP_BETWEEN_PASSES = 2500


def silent_mp3(ms):
    """Silent MP3 of roughly `ms` milliseconds (rounded to whole 24 ms frames)."""
    return _SILENT_FRAME * max(1, round(ms / MP3_FRAME_MS))


def mp3_frames(data):
    """Split a 24 kHz mono MPEG-2 Layer III stream into its frames.

    Returns None if the data is anything else (another sample rate, stereo,
    an ID3 tag, a truncated frame): splicing that into the export would
    break playback.
    """
    frames, i = [], 0
    while i < len(data):
        if len(data) - i < 4:
            return None
        h = int.from_bytes(data[i:i + 4], 'big')
        # sync · MPEG-2 · Layer III · 24 kHz · mono
        if (h >> 17 != 0x7ff9 or (h >> 10) & 3 != 1 or (h >> 6) & 3 != 3
                or not 0 < (h >> 12) & 15 < 15):
            return None
        size = 3 * _KBPS[(h >> 12) & 15] + ((h >> 9) & 1)   # 72000 · kbps / 24000
        if i + size > len(data):
            return None
        frames.append(data[i:i + size])
        i += size
    return frames


def mp3_duration_ms(data):
    """Duration of an export-format MP3 (CBR or VBR), from its frame count."""
    return len(mp3_frames(data) or ()) * MP3_FRAME_MS


def _frame_gain(frame):
    """A frame's global_gain — loudness in 1.5 dB steps, readable without
    decoding — or 0 if it carries no audio data at all."""
    side = int.from_bytes(frame[6 if frame[1] & 1 == 0 else 4:][:5], 'big')  # skip CRC
    part2_3_length = (side >> 19) & 0xfff
    return (side >> 2) & 0xff if part2_3_length else 0


def trim_mp3_silence(data, lead_frames, tail_frames):
    """Cut a clip down to its speech plus `lead_frames` / `tail_frames` of
    margin (24 ms each), and drop the VBR info frame, whose length would be
    wrong once the clip is trimmed or spliced. Botnoi pads every clip with
    ~0.4 s of near-silence at each end.

    Returns None if the data isn't in the export format (see mp3_frames).
    """
    frames = mp3_frames(data)
    if frames is None:
        return None
    frames = [f for f in frames if f[13:17] not in (b'Xing', b'Info')]
    if not frames:
        return None
    gains = [_frame_gain(f) for f in frames]
    floor = max(gains) - SILENCE_BELOW_PEAK
    voiced = [i for i, g in enumerate(gains) if g and g >= floor]
    if not voiced:
        return None
    start = max(0, voiced[0] - lead_frames)
    end = min(len(frames), voiced[-1] + 1 + tail_frames)
    return b''.join(frames[start:end])


def with_vbr_header(data):
    """Prepend a Xing frame giving the track's frame count, byte length and a
    seek table. Without it players guess a VBR file's length from its first
    frames' bitrate: a 7:13 export showed as 5:37, and seeking missed."""
    frames = mp3_frames(data)
    if not frames:
        return data
    total = MP3_FRAME_BYTES + len(data)
    offsets, pos = [], 0
    for f in frames:
        offsets.append(pos)
        pos += len(f)
    # TOC[i]: where i% of the way through the audio falls, in 256ths of the file.
    toc = bytes(min(255, (MP3_FRAME_BYTES + offsets[len(frames) * i // 100]) * 256 // total)
                for i in range(100))
    xing = (b'Xing' + (0x7).to_bytes(4, 'big')     # flags: frames, bytes, TOC present
            + len(frames).to_bytes(4, 'big') + total.to_bytes(4, 'big') + toc)
    header = _SILENT_FRAME[:13] + xing               # frame header + empty side info
    return header + bytes(MP3_FRAME_BYTES - len(header)) + data


def shadow_gap_ms(thai_ms):
    """Time to repeat the Thai aloud: its own length plus a breath."""
    return max(2500, min(7000, thai_ms + 1500))


def recall_gap_ms(thai_ms):
    """Time to retrieve and say the Thai from the English cue. Longer phrases
    get longer to think, within limits that keep the track moving."""
    return max(3500, min(8000, thai_ms + 2500))


def assemble_study_mp3(clips, intros, rng):
    """Build a two-pass study track from per-word clips.

    clips:  list of {'thai', 'thai_slow', 'eng'} export-format MP3 bytes.
    intros: {'listen': bytes|None, 'recall': bytes|None} spoken part intros.
    rng:    random.Random used for both shuffles.

    Pass 1, listen & repeat:  Thai · English · slow Thai · (repeat aloud)
    Pass 2, recall:           English · (say it in Thai) · Thai · (repeat aloud)
    Pass 2 is reshuffled so recall doesn't follow the pass 1 order.
    """
    order1 = list(range(len(clips)))
    rng.shuffle(order1)
    order2 = order1[:]
    rng.shuffle(order2)
    if len(order2) > 1 and order2[0] == order1[-1]:
        order2[0], order2[-1] = order2[-1], order2[0]   # no back-to-back repeat at the seam

    out = []
    if intros.get('listen'):
        out += [intros['listen'], silent_mp3(GAP_AFTER_INTRO)]
    for i in order1:
        c = clips[i]
        thai_ms = mp3_duration_ms(c['thai'])
        out += [c['thai'], silent_mp3(GAP_BETWEEN_PARTS),
                c['eng'], silent_mp3(GAP_BETWEEN_PARTS),
                c['thai_slow'], silent_mp3(shadow_gap_ms(thai_ms))]

    out.append(silent_mp3(GAP_BETWEEN_PASSES))
    if intros.get('recall'):
        out += [intros['recall'], silent_mp3(GAP_AFTER_INTRO)]
    for i in order2:
        c = clips[i]
        thai_ms = mp3_duration_ms(c['thai'])
        out += [c['eng'], silent_mp3(recall_gap_ms(thai_ms)),
                c['thai'], silent_mp3(shadow_gap_ms(thai_ms))]

    return with_vbr_header(b''.join(out))
