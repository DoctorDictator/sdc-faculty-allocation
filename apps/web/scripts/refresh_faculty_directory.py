#!/usr/bin/env python3
"""Refresh the local MUJ CSE public directory from official faculty pages."""

from __future__ import annotations

import concurrent.futures
import html
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "src" / "data" / "manipal-cse-faculty.json"
PHOTO_DIR = ROOT / "public" / "faculty-directory"
BASE_URL = "https://jaipur.manipal.edu"
DEPARTMENT_URL = f"{BASE_URL}/fosta/department-of-Computer-Science-Engineering.php"
LIST_URL = f"{BASE_URL}/fosta/faculty-list.php"
USER_AGENT = "Mozilla/5.0 (compatible; FacultyFlowDirectory/1.0)"
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)


def fetch(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get("Content-Type", "")


def plain_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def attr(tag: str, name: str) -> str | None:
    match = re.search(rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1", tag, re.I | re.S)
    return html.unescape(match.group(2)).strip() if match else None


def parse_roster(source: str) -> list[dict[str, str]]:
    headings = list(re.finditer(r"<h2[^>]*>(.*?)</h2>", source, re.I | re.S))
    heading_index = next(
        index
        for index, heading in enumerate(headings)
        if plain_text(heading.group(1)) == "Department of Computer Science & Engineering"
    )
    start = headings[heading_index].start()
    end = next(
        (heading.start() for heading in headings[heading_index + 1 :] if plain_text(heading.group(1)).startswith("Department of ")),
        len(source),
    )
    section = source[start:end]

    roster: list[dict[str, str]] = []
    for card in re.findall(r'<div\s+class=["\']home-faculty-box["\']\s*>(.*?)</div>', section, re.I | re.S):
        link = re.search(r"<a\b([^>]*)>(.*?)</a>", card, re.I | re.S)
        if not link:
            continue
        profile_path = attr(link.group(1), "href")
        image_match = re.search(r"<img\b([^>]*)>", link.group(2), re.I | re.S)
        name_match = re.search(r"<h2\b[^>]*>(.*?)</h2>", link.group(2), re.I | re.S)
        title_match = re.search(r"<h3\b[^>]*>(.*?)</h3>", link.group(2), re.I | re.S)
        if not profile_path or not name_match:
            continue
        id_match = re.search(r"[?&]url=(\d+)", profile_path, re.I)
        if not id_match:
            continue
        roster.append(
            {
                "sourceId": id_match.group(1),
                "name": plain_text(name_match.group(1)),
                "title": plain_text(title_match.group(1)) if title_match else "Faculty",
                "profileUrl": urllib.parse.urljoin(f"{BASE_URL}/fosta/", profile_path),
                "listPhotoUrl": attr(image_match.group(0), "src") if image_match else "",
            }
        )
    return roster


def parse_profile(person: dict[str, str]) -> dict[str, str | None]:
    profile_html, _ = fetch(person["profileUrl"])
    source = profile_html.decode("utf-8", "replace")
    card_match = re.search(
        r'<div\s+class=["\']\s*modal-custom-bg\s+modal-custom-details-popup["\']\s*>(.*?)<div\s+class=["\']col-md-12\s+modal-custom-text-body["\']',
        source,
        re.I | re.S,
    )
    card = card_match.group(1) if card_match else source
    image_match = re.search(r"<img\b([^>]*)>", card, re.I | re.S)
    email_match = EMAIL_RE.search(plain_text(card))
    return {
        "email": email_match.group(0).lower() if email_match else None,
        "photoUrl": attr(image_match.group(0), "src") if image_match else person["listPhotoUrl"],
    }


def save_photo(person: dict[str, object]) -> str | None:
    photo_url = person.get("photoUrl") or person.get("listPhotoUrl")
    if not isinstance(photo_url, str) or not photo_url:
        return None
    try:
        image, content_type = fetch(photo_url)
    except Exception as error:  # noqa: BLE001 - retain the directory entry if a source photo is unavailable
        print(f"Photo unavailable for {person['name']}: {error}")
        return None
    if not content_type.lower().startswith("image/"):
        print(f"Skipping non-image response for {person['name']}: {content_type}")
        return None
    suffix = Path(urllib.parse.urlparse(photo_url).path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    relative_path = f"/faculty-directory/{person['sourceId']}{suffix}"
    (PHOTO_DIR / f"{person['sourceId']}{suffix}").write_bytes(image)
    return relative_path


def main() -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    list_html, _ = fetch(LIST_URL)
    roster = parse_roster(list_html.decode("utf-8", "replace"))
    if not roster:
        raise RuntimeError("Could not find the CSE faculty section on the official faculty list.")

    print(f"Found {len(roster)} CSE profiles. Fetching contact details and photos…")
    completed: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        future_by_person = {executor.submit(parse_profile, person): person for person in roster}
        for future in concurrent.futures.as_completed(future_by_person):
            person = future_by_person[future]
            try:
                details = future.result()
            except Exception as error:  # noqa: BLE001 - one unavailable profile should not drop the roster
                print(f"Profile unavailable for {person['name']}: {error}")
                details = {"email": None, "photoUrl": person["listPhotoUrl"]}
            completed.append({**person, **details})

    output = []
    for person in sorted(completed, key=lambda row: str(row["name"]).casefold()):
        photo_path = save_photo(person)
        output.append(
            {
                "sourceId": person["sourceId"],
                "name": person["name"],
                "title": person["title"],
                "department": "Department of Computer Science & Engineering",
                "email": person["email"],
                "photoPath": photo_path,
                "profileUrl": person["profileUrl"],
            }
        )
        time.sleep(0.03)

    dataset = {
        "source": DEPARTMENT_URL,
        "facultyListSource": LIST_URL,
        "retrievedAt": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(timespec="seconds"),
        "faculty": output,
    }
    DATA_FILE.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    email_count = sum(bool(person["email"]) for person in output)
    photo_count = sum(bool(person["photoPath"]) for person in output)
    print(f"Saved {len(output)} profiles: {email_count} emails, {photo_count} local photos.")
    print(f"Data: {DATA_FILE}")
    print(f"Photos: {PHOTO_DIR}")


if __name__ == "__main__":
    main()
