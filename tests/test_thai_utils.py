import pytest

import random

from thai_utils import (LRUCache, assemble_study_mp3, clean_english_for_tts, compute_deck_hash,
                        mp3_duration_ms, number_to_thai, pool_unique_words, recall_gap_ms,
                        sample_preferring_unseen, shadow_gap_ms, silent_mp3)

# Known-correct spellings, including the two irregular rules the numbers game
# exists to drill:
#   - a trailing 1 after tens is เอ็ด (11 = สิบเอ็ด, never สิบหนึ่ง)
#   - 2 in the tens place is ยี่ (20 = ยี่สิบ, never สองสิบ)
NUMBER_CASES = [
    (0, 'ศูนย์'),
    (1, 'หนึ่ง'),
    (2, 'สอง'),
    (9, 'เก้า'),
    (10, 'สิบ'),
    (11, 'สิบเอ็ด'),
    (12, 'สิบสอง'),
    (20, 'ยี่สิบ'),
    (21, 'ยี่สิบเอ็ด'),
    (22, 'ยี่สิบสอง'),
    (31, 'สามสิบเอ็ด'),
    (99, 'เก้าสิบเก้า'),
    (100, 'หนึ่งร้อย'),
    (101, 'หนึ่งร้อยเอ็ด'),
    (110, 'หนึ่งร้อยสิบ'),
    (111, 'หนึ่งร้อยสิบเอ็ด'),
    (121, 'หนึ่งร้อยยี่สิบเอ็ด'),
    (200, 'สองร้อย'),
    (1000, 'หนึ่งพัน'),
    (1001, 'หนึ่งพันเอ็ด'),
    (2563, 'สองพันห้าร้อยหกสิบสาม'),
    (10000, 'หนึ่งหมื่น'),
    (100000, 'หนึ่งแสน'),
    (123456, 'หนึ่งแสนสองหมื่นสามพันสี่ร้อยห้าสิบหก'),
    (1000000, 'หนึ่งล้าน'),
    (7777777, 'เจ็ดล้านเจ็ดแสนเจ็ดหมื่นเจ็ดพันเจ็ดร้อยเจ็ดสิบเจ็ด'),
    (9999999, 'เก้าล้านเก้าแสนเก้าหมื่นเก้าพันเก้าร้อยเก้าสิบเก้า'),
]


@pytest.mark.parametrize("number,expected", NUMBER_CASES)
def test_number_to_thai(number, expected):
    assert number_to_thai(number) == expected


def test_number_out_of_range_falls_back_to_digits():
    assert number_to_thai(-5) == '-5'
    assert number_to_thai(10_000_000) == '10000000'


class TestLRUCache:
    def test_roundtrip_and_miss(self):
        c = LRUCache(maxsize=2)
        c.put('a', b'1')
        assert c.get('a') == b'1'
        assert c.get('missing') is None

    def test_evicts_least_recently_used(self):
        c = LRUCache(maxsize=2)
        c.put('a', b'1')
        c.put('b', b'2')
        c.put('c', b'3')  # over capacity: 'a' is the LRU entry
        assert c.get('a') is None
        assert c.get('b') == b'2'
        assert c.get('c') == b'3'

    def test_get_refreshes_recency(self):
        c = LRUCache(maxsize=2)
        c.put('a', b'1')
        c.put('b', b'2')
        c.get('a')        # 'a' becomes most-recent
        c.put('c', b'3')  # so 'b' is evicted, not 'a'
        assert c.get('a') == b'1'
        assert c.get('b') is None

    def test_overwrite_does_not_grow(self):
        c = LRUCache(maxsize=2)
        c.put('a', b'1')
        c.put('a', b'2')
        c.put('b', b'3')
        assert c.get('a') == b'2'
        assert c.get('b') == b'3'


class TestCleanEnglishForTts:
    def test_unwraps_parentheses(self):
        assert clean_english_for_tts('(I) bought') == 'I bought'

    def test_slash_becomes_or(self):
        assert clean_english_for_tts('already / and then') == 'already or and then'

    def test_collapses_whitespace(self):
        assert clean_english_for_tts('  too   many spaces ') == 'too many spaces'

    def test_combined(self):
        assert clean_english_for_tts('(to) walk / stroll') == 'to walk or stroll'


class TestComputeDeckHash:
    def test_stable_and_short(self):
        words = [{'thai': 'หนึ่ง', 'eng': 'one'}]
        assert compute_deck_hash(words) == compute_deck_hash(words)
        assert len(compute_deck_hash(words)) == 8

    def test_changes_with_content(self):
        a = [{'thai': 'หนึ่ง', 'eng': 'one'}]
        b = [{'thai': 'หนึ่ง', 'eng': 'ONE'}]
        assert compute_deck_hash(a) != compute_deck_hash(b)

    def test_eng_is_optional(self):
        assert compute_deck_hash([{'thai': 'ก'}])


def _deck(*pairs):
    return {'words': [{'thai': t, 'eng': e} for t, e in pairs]}


class TestPoolUniqueWords:
    def test_same_thai_with_different_english_is_one_card(self):
        # The real-world case: the same word re-entered with reworded English.
        pool = pool_unique_words([
            _deck(('ขี้เหนียว', 'stingy, cheap')),
            _deck(('ขี้เหนียว', 'stingy'), ('เสร็จ', 'finish')),
        ])
        assert [w['thai'] for w in pool] == ['ขี้เหนียว', 'เสร็จ']

    def test_first_occurrence_wins(self):
        pool = pool_unique_words([_deck(('เสร็จ', 'finish')), _deck(('เสร็จ', 'done'))])
        assert pool[0]['eng'] == 'finish'

    def test_duplicates_within_one_deck(self):
        assert len(pool_unique_words([_deck(('ก', 'a'), ('ก', 'b'))])) == 1

    def test_accepts_a_generator_and_empty_input(self):
        assert pool_unique_words(d for d in []) == []


class TestSamplePreferringUnseen:
    POOL = [{'thai': str(i), 'eng': str(i)} for i in range(10)]

    def test_caps_at_pool_size(self):
        cards, recycled = sample_preferring_unseen(self.POOL, 100)
        assert len(cards) == 10 and not recycled

    def test_none_means_whole_pool(self):
        cards, _ = sample_preferring_unseen(self.POOL, None)
        assert sorted(w['thai'] for w in cards) == sorted(w['thai'] for w in self.POOL)

    def test_avoids_excluded_cards_while_others_remain(self):
        seen = {'0', '1', '2', '3', '4', '5'}
        for _ in range(20):  # random, so repeat
            cards, recycled = sample_preferring_unseen(self.POOL, 4, seen)
            assert not recycled
            assert not seen & {w['thai'] for w in cards}

    def test_recycles_only_what_it_must(self):
        seen = {str(i) for i in range(8)}  # only '8' and '9' are fresh
        cards, recycled = sample_preferring_unseen(self.POOL, 5, seen)
        got = {w['thai'] for w in cards}
        assert recycled and len(cards) == 5 and {'8', '9'} <= got

    def test_does_not_mutate_the_pool(self):
        before = list(self.POOL)
        sample_preferring_unseen(self.POOL, 3)
        assert self.POOL == before


# ------------------------------------------------------------ mp3 track ----

def test_silent_mp3_is_whole_frames_of_requested_length():
    assert mp3_duration_ms(silent_mp3(1200)) == 1200
    assert len(silent_mp3(1000)) % 144 == 0
    assert mp3_duration_ms(silent_mp3(0)) == 24  # never empty


def test_gaps_scale_with_thai_length_within_bounds():
    assert shadow_gap_ms(500) == 2500 and shadow_gap_ms(3000) == 4500 and shadow_gap_ms(20000) == 7000
    assert recall_gap_ms(500) == 3500 and recall_gap_ms(3000) == 5500 and recall_gap_ms(20000) == 8000


def test_study_track_plays_every_word_in_both_passes():
    # Distinct one-frame "clips" so we can find each in the output.
    def clip(n):
        return bytes.fromhex('fff364c4') + n.to_bytes(2, 'big') + bytes(138)

    clips = [{'thai': clip(10 * i + 1), 'thai_slow': clip(10 * i + 2), 'eng': clip(10 * i + 3)}
             for i in range(5)]
    intros = {'listen': clip(900), 'recall': clip(901)}
    out = assemble_study_mp3(clips, intros, random.Random(0))
    frames = [out[i:i + 144] for i in range(0, len(out), 144)]

    assert frames[0] == intros['listen']
    split = frames.index(intros['recall'])
    pass1, pass2 = frames[:split], frames[split:]
    for c in clips:
        assert pass1.count(c['thai']) == pass1.count(c['eng']) == pass1.count(c['thai_slow']) == 1
        assert pass2.count(c['eng']) == pass2.count(c['thai']) == 1 and c['thai_slow'] not in pass2
        # Recall: English cue comes before the Thai answer.
        assert pass2.index(c['eng']) < pass2.index(c['thai'])
