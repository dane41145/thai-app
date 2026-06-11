import pytest

from thai_utils import LRUCache, clean_english_for_tts, compute_deck_hash, number_to_thai

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
