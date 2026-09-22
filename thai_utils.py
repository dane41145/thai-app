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
