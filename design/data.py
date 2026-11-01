"""Sample content for the static comps (design spike).

Mirage positions come from Valve's own retake file (eye positions, 64 units above the origin; the
nav surface sits about 4 units above the feet, so floor z is eye z minus 60). Site anchors come from
the overview file's bombsite fractions. Names, blurbs, tiers and mastery states are placeholder
content for layout work: real callouts get curated in Phase 1 (SCOPE.md section 3.3).
"""
from art import ASSETS, load

STATES = ["new", "seen", "learning", "familiar", "known", "auto"]
STATE_LABEL = {"new": "New", "seen": "Seen", "learning": "Learning", "familiar": "Familiar", "known": "Known", "auto": "Automatic"}


def floor(eye_z):
    return eye_z - 60.0


# id, display name, zone, world x, y, floor z, mastery state, tier
MIRAGE = [
    ("t-spawn",   "T Spawn",    "t",   1308.3,  -493.1, floor(-103.9), "auto",     1),
    ("a-ramp",    "A Ramp",     "t",   1003.9, -1429.5, floor(-103.9), "known",    1),
    ("palace",    "Palace",     "a",    937.7, -2309.0, floor(24.1),   "learning", 1),
    ("a-site",    "A Site",     "a",   -465.0, -2177.0, -200.0,        "seen",     1),
    ("top-mid",   "Top Mid",    "mid",  178.5,  -432.4, floor(-102.9), "known",    1),
    ("window",    "Window",     "mid", -1165.7, -728.0, floor(-103.9), "learning", 1),
    ("connector", "Connector",  "mid",  -638.1, -1043.5, floor(-146.1), "familiar", 1),
    ("underpass", "Underpass",  "mid", -1015.7,   20.8, floor(-303.9), "seen",     2),
    ("short",     "Short",      "b",   -1098.1,  247.8, floor(-108.6), "new",      1),
    ("b-site",    "B Site",     "b",   -2055.0,  278.0, -170.0,        "new",      1),
    ("t-apps",    "T Apartments", "b",   246.6,  837.8, floor(-71.9),  "familiar", 2),
    ("market",    "Market",     "ct", -1900.8,  -501.4, floor(-103.9), "new",      2),
    ("ct-spawn",  "CT Spawn",   "ct", -1608.9, -1773.1, floor(-203.1), "known",    1),
]
ZONES = [("t", "T Side"), ("a", "A"), ("mid", "Mid"), ("b", "B"), ("ct", "CT Side")]

# One-line blurbs (placeholders, 120 characters or fewer; the validator in SCOPE.md 5.3 will enforce this)
BLURB = {
    "connector": "Short passage joining Mid to the A side, under the arch.",
    "palace": "Raised interior above A site, entered from the T side.",
    "window": "Open frame in the Mid wall that looks toward the CT side.",
    "market": "Shop interior on the CT side, behind the shelves.",
}
GAME_NAME = {"connector": "Connector", "window": "Window", "market": "Market", "underpass": "Underpass"}


def mirage_anchors():
    return [{"id": r[0], "name": r[1], "zone": r[2], "x": r[3], "y": r[4], "z": r[5], "state": r[6], "tier": r[7]} for r in MIRAGE]


def counts():
    n = len(MIRAGE)
    done = sum(1 for r in MIRAGE if r[6] in ("known", "auto"))
    return n, done


# Home screen: map cards. (id, name, state of play)
HOME = [
    ("de_mirage", "Mirage", "active", 41, 3, "Core 7 of 12"),
    ("de_dust2", "Dust II", "active", 12, 0, "Core 2 of 12"),
    ("de_inferno", "Inferno", "new", 0, 0, "Not started"),
    ("de_ancient", "Ancient", "new", 0, 0, "Not started"),
    ("de_anubis", "Anubis", "new", 0, 0, "Not started"),
    ("de_nuke", "Nuke", "new", 0, 0, "Not started"),
    ("de_cache", "Cache", "new", 0, 0, "Not started"),
    ("de_overpass", "Overpass", "soon", 0, 0, "Coming"),
    ("de_vertigo", "Vertigo", "soon", 0, 0, "Coming"),
    ("de_train", "Train", "soon", 0, 0, "Coming"),
]
THUMB = {"de_mirage": "de_mirage_2", "de_dust2": "de_dust2_1", "de_inferno": "de_inferno_1", "de_ancient": "de_ancient_3",
         "de_anubis": "de_anubis_2", "de_nuke": "de_nuke_1", "de_cache": "de_cache_1", "de_overpass": "de_overpass_2",
         "de_vertigo": "de_vertigo_2", "de_train": "de_train_1"}
