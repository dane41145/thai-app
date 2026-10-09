"""Checks on the shared consonant table in static/js/thai-letters.js.

The `say` field is what gets sent to TTS. Its first syllable must be a
consonant of the *same class* followed by อ — that's what gives the letter
name its correct tone (rising for High, level for Mid and Low). A substitute
from the wrong class would teach the wrong tone.
"""
import os
import re

import pytest

PATH = os.path.join(os.path.dirname(__file__), '..', 'static', 'js', 'thai-letters.js')
ROW = re.compile(r'letter: "(.)", fullName: "([^"]+)", say: "([^"]+)", letterClass: "(HC|MC|LC)"')


@pytest.fixture(scope='module')
def letters():
    with open(PATH, encoding='utf-8') as f:
        rows = ROW.findall(f.read())
    return [dict(zip(('letter', 'fullName', 'say', 'cls'), r)) for r in rows]


def test_all_44_consonants_with_correct_class_sizes(letters):
    assert len(letters) == 44
    assert len({l['letter'] for l in letters}) == 44
    counts = {c: sum(l['cls'] == c for l in letters) for c in ('HC', 'MC', 'LC')}
    assert counts == {'HC': 11, 'MC': 9, 'LC': 24}


def test_spoken_name_starts_with_same_class_consonant_plus_or(letters):
    cls_of = {l['letter']: l['cls'] for l in letters}
    for l in letters:
        first, _, word = l['say'].partition(' ')
        assert len(first) == 2 and first[1] == 'อ', l
        assert cls_of[first[0]] == l['cls'], f"{l['letter']}: {first} has the wrong tone class"
        assert word, l


def test_spoken_name_never_uses_a_bare_consonant(letters):
    # A lone consonant before the space is what Azure misreads.
    for l in letters:
        assert not re.match(r'^.\s', l['say']), l
