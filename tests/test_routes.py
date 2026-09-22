"""Flask route tests.

app.py fetches every configured sheet tab at import time, so the fixture
replaces requests.get with canned CSV, points CONFIG_FILE / PROGRESS_FILE at a
temp directory, and imports the module fresh for each test. No network.
"""
import importlib
import json
import sys
import urllib.parse

import pytest
import requests

HEADER = "Thai,Pronunciation,English,Override\n"

# Two vocab tabs that overlap on สอง (with different English, as happens in the
# real sheets), plus one script tab.
CSV = {
    'A': HEADER + "หนึ่ง,neung,one,\nสอง,song,two,\n",
    'B': HEADER + "สอง,song,two (2),\nสาม,saam,three,\nสี่,sii,four,\n",
    'S1': HEADER + "ก,gor,,\n",
}


class FakeResponse:
    def __init__(self, text, status=200):
        self.content = text.encode('utf-8')
        self.text = text
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} for url")

    def json(self):
        return json.loads(self.text)


class Harness:
    def __init__(self, module, csv, failing):
        self.module = module
        self.app = module.app
        self.client = module.app.test_client()
        self.csv = csv        # mutate to simulate a sheet edit
        self.failing = failing  # tab names whose fetch should raise


@pytest.fixture
def harness(tmp_path, monkeypatch):
    csv = dict(CSV)
    failing = set()

    def fake_get(url, timeout=None):
        tab = urllib.parse.unquote(url.split('sheet=')[1])
        if tab in failing:
            raise requests.ConnectionError(f"simulated outage for {tab}")
        return FakeResponse(csv[tab])

    def no_post(*args, **kwargs):
        raise AssertionError(f"unexpected network POST: {args[0] if args else kwargs}")

    monkeypatch.setattr(requests, 'get', fake_get)
    monkeypatch.setattr(requests, 'post', no_post)

    config = {
        'vocab': {'sheet_id': 'sheet-v', 'tabs': ['A', 'B']},
        'script': {'sheet_id': 'sheet-s', 'tabs': ['S1']},
    }
    cfg = tmp_path / 'config.json'
    cfg.write_text(json.dumps(config), encoding='utf-8')
    monkeypatch.setenv('CONFIG_FILE', str(cfg))
    monkeypatch.setenv('PROGRESS_FILE', str(tmp_path / 'data' / 'progress.json'))
    (tmp_path / 'data').mkdir()
    for var in ('AZURE_KEY', 'GEMINI_KEY'):
        monkeypatch.delenv(var, raising=False)

    sys.modules.pop('app', None)
    module = importlib.import_module('app')
    module.limiter.enabled = False  # tests hit /refresh more than 2/min
    module.app.config['TESTING'] = True
    # load_dotenv may have pulled real keys from a local .env; never use them.
    module.AZURE_KEY = None
    module.GEMINI_KEY = None
    yield Harness(module, csv, failing)
    sys.modules.pop('app', None)


def custom(h, **body):
    return h.client.post('/custom_deck', json=body)


# ---------------------------------------------------------------- decks ----

def test_decks_follow_config_order(harness):
    gids = [d['gid'] for d in harness.client.get('/decks').get_json()]
    assert gids == ['vocab_A', 'vocab_B', 'script_S1']


def test_vocab_words_and_script_fallback(harness):
    words = harness.client.get('/vocab/vocab_A').get_json()
    assert [w['thai'] for w in words] == ['หนึ่ง', 'สอง']
    # Script rows with no English use the pronunciation as the "meaning".
    assert harness.client.get('/vocab/script_S1').get_json()[0]['eng'] == 'gor'
    assert harness.client.get('/vocab/nope').get_json() == []


def test_refresh_keeps_last_good_copy_when_a_fetch_fails(harness):
    harness.failing.add('B')
    res = harness.client.post('/refresh')
    assert res.status_code == 200
    gids = [d['gid'] for d in harness.client.get('/decks').get_json()]
    assert gids == ['vocab_A', 'vocab_B', 'script_S1'], "B should survive a transient outage"
    assert len(harness.client.get('/vocab/vocab_B').get_json()) == 3


def test_refresh_picks_up_sheet_edits(harness):
    harness.csv['A'] = HEADER + "หนึ่ง,neung,one,\n"
    harness.client.post('/refresh')
    assert len(harness.client.get('/vocab/vocab_A').get_json()) == 1


# ---------------------------------------------------------- custom deck ----

def test_custom_deck_dedupes_by_thai_keeping_config_order_copy(harness):
    # Client sends B first; the copy of สอง that wins is still A's ("two"),
    # because the server walks decks in config order.
    data = custom(harness, deck_ids=['vocab_B', 'vocab_A'], count='all').get_json()
    assert data['total_available'] == 4
    assert data['count'] == 4
    by_thai = {w['thai']: w['eng'] for w in data['words']}
    assert by_thai == {'หนึ่ง': 'one', 'สอง': 'two', 'สาม': 'three', 'สี่': 'four'}
    assert data['recycled'] is False


def test_custom_deck_count_caps_at_pool(harness):
    data = custom(harness, deck_ids=['vocab_A'], count=100).get_json()
    assert data['count'] == 2 and data['total_available'] == 2


def test_custom_deck_preview_returns_counts_only(harness):
    data = custom(harness, deck_ids=['vocab_A', 'vocab_B'], count=3, preview=True).get_json()
    assert data == {'words': [], 'total_available': 4, 'count': 3}


def test_custom_deck_ignores_script_and_unknown_ids(harness):
    data = custom(harness, deck_ids=['script_S1', 'ghost', 42, 'vocab_A'], count='all').get_json()
    assert sorted(w['thai'] for w in data['words']) == ['สอง', 'หนึ่ง']


def test_custom_deck_rejects_empty_selection(harness):
    assert custom(harness, deck_ids=[]).status_code == 400
    assert custom(harness, deck_ids='vocab_A').status_code == 400
    assert harness.client.post('/custom_deck', data='nope',
                               content_type='application/json').status_code == 400


def test_custom_deck_exclude_prefers_unseen_then_recycles(harness):
    ids = ['vocab_A', 'vocab_B']
    first = custom(harness, deck_ids=ids, count=2).get_json()
    seen = [w['thai'] for w in first['words']]
    second = custom(harness, deck_ids=ids, count=2, exclude=seen).get_json()
    assert not set(seen) & {w['thai'] for w in second['words']}
    assert second['recycled'] is False

    seen += [w['thai'] for w in second['words']]  # all 4 now seen
    third = custom(harness, deck_ids=ids, count=2, exclude=seen).get_json()
    assert third['count'] == 2 and third['recycled'] is True


# ------------------------------------------------------------- progress ----

def test_progress_initialises_every_deck(harness):
    progress = harness.client.get('/progress').get_json()
    assert set(progress) == {'vocab_A', 'vocab_B', 'script_S1'}
    assert progress['vocab_A'] == {'hash': harness.module.MEMORY_DECKS['vocab_A']['hash'],
                                   'thai': False, 'eng': False}


def test_complete_and_reset_roundtrip(harness):
    assert harness.client.post('/complete/vocab_A/thai').status_code == 200
    assert harness.client.post('/complete/vocab_A/eng').status_code == 200
    p = harness.client.get('/progress').get_json()['vocab_A']
    assert p['thai'] and p['eng']

    assert harness.client.post('/reset/vocab_A').status_code == 200
    p = harness.client.get('/progress').get_json()['vocab_A']
    assert not p['thai'] and not p['eng']


def test_complete_validates_deck_and_mode(harness):
    assert harness.client.post('/complete/vocab_A/sideways').status_code == 400
    assert harness.client.post('/complete/ghost/thai').status_code == 404
    assert harness.client.post('/reset/ghost').status_code == 404


def test_progress_resets_when_deck_content_changes(harness):
    harness.client.post('/complete/vocab_A/thai')
    harness.csv['A'] = HEADER + "หนึ่ง,neung,ONE,\nสอง,song,two,\n"
    harness.client.post('/refresh')
    p = harness.client.get('/progress').get_json()['vocab_A']
    assert p['thai'] is False, "an edited deck should have its completion reset"


def test_progress_is_persisted_to_the_configured_file(harness, tmp_path):
    harness.client.post('/complete/vocab_B/eng')
    saved = json.loads((tmp_path / 'data' / 'progress.json').read_text(encoding='utf-8'))
    assert saved['vocab_B']['eng'] is True
    assert not list((tmp_path / 'data').glob('progress_*.tmp')), "temp file should be renamed away"


# ------------------------------------------------------------------ TTS ----

def test_speak_validates_input(harness):
    assert harness.client.post('/speak', json={}).status_code == 400
    assert harness.client.post('/speak', json={'text': 'x' * 301}).status_code == 400


def test_speak_returns_503_without_azure(harness):
    res = harness.client.post('/speak', json={'text': 'สวัสดี'})
    assert res.status_code == 503
    assert res.get_json() == {'error': 'TTS unavailable'}


def test_speak_number_rejects_garbage(harness):
    assert harness.client.post('/speak_number', json={'number': 'abc'}).status_code == 400


def test_download_start_only_for_vocab(harness):
    assert harness.client.post('/download_deck/script_S1/start').status_code == 400
    assert harness.client.post('/download_deck/vocab_ghost/start').status_code == 404


# --------------------------------------------------------------- gemini ----

def test_generate_sentences_without_key(harness):
    res = harness.client.post('/generate_sentences')
    assert res.status_code == 500
    assert 'not configured' in res.get_json()['error']


def test_generate_sentences_sends_key_in_header_not_url(harness, monkeypatch):
    harness.module.GEMINI_KEY = 'SECRET-KEY-123'
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append((url, headers))
        body = {'candidates': [{'content': {'parts': [{'text':
            'Sure!\n[{"thai": "ผม กิน ข้าว", "english": "I eat rice"}, {"bogus": 1}, "junk"]'}]}}]}
        return FakeResponse(__import__('json').dumps(body))

    monkeypatch.setattr(requests, 'post', fake_post)
    res = harness.client.post('/generate_sentences')
    assert res.status_code == 200
    url, headers = calls[0]
    assert 'SECRET-KEY-123' not in url
    assert headers['x-goog-api-key'] == 'SECRET-KEY-123'
    assert harness.module.GEMINI_MODEL in url

    sentences = res.get_json()
    assert sentences == [{'thai': 'ผม กิน ข้าว', 'english': 'I eat rice', 'audio_text': 'ผมกินข้าว'}]


def test_generate_sentences_never_echoes_exception_text(harness, monkeypatch):
    harness.module.GEMINI_KEY = 'SECRET-KEY-123'

    def exploding_post(url, **kwargs):
        raise requests.HTTPError("500 Server Error for url: https://x/?key=SECRET-KEY-123")

    monkeypatch.setattr(requests, 'post', exploding_post)
    res = harness.client.post('/generate_sentences')
    assert res.status_code == 502
    assert 'SECRET-KEY-123' not in res.get_data(as_text=True)


def test_generate_sentences_reports_upstream_status(harness, monkeypatch):
    harness.module.GEMINI_KEY = 'k'
    monkeypatch.setattr(requests, 'post',
                        lambda url, **kw: FakeResponse('{"error": "model retired"}', status=404))
    res = harness.client.post('/generate_sentences')
    assert res.status_code == 502
    assert 'HTTP 404' in res.get_json()['error']
    assert 'model retired' not in res.get_data(as_text=True)
