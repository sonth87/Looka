"""
Prompt safety filter for /edit, per `docs/plans/cms-photo-review-plan.md`
§5.3 ("Bo loc prompt: tu khoa cam (cuoi, mo mat, bo kinh, gay, tre, dep,
doi mat/mui/mieng...)") and §6.3 ("Nhung gi AI khong duoc hua": doi bieu
cam, mo mat dang nham, bo han kinh, gay mat/tre hoa/"lam dep", ve lai
mong mat sau loa che dong tu).

This is intentionally a plain case-insensitive substring match against a
fixed keyword list -- exactly what the plan specifies (a deterministic
guardrail independent of whichever edit model eventually runs), not a
model-based classifier.
"""
from __future__ import annotations

from typing import Optional

FORBIDDEN_KEYWORDS: list[str] = [
    "cười",       # change expression / smile
    "mở mắt",     # open closed eyes
    "bỏ kính",    # remove glasses entirely
    "gầy",        # slim the face
    "trẻ hóa",    # de-age
    "đẹp",        # "beautify" (also matches "làm đẹp")
    "làm đẹp",    # beautify (explicit form, redundant with "đẹp" above but kept for traceability to the plan doc's wording)
    "đổi mắt",    # change eyes
    "đổi mũi",    # change nose
    "đổi miệng",  # change mouth
]


def find_forbidden_keyword(prompt: str) -> Optional[str]:
    """Return the first forbidden keyword found in `prompt` (case-insensitive
    substring match), or None if the prompt passes the filter."""
    if not prompt:
        return None
    lowered = prompt.lower()
    for kw in FORBIDDEN_KEYWORDS:
        if kw.lower() in lowered:
            return kw
    return None
