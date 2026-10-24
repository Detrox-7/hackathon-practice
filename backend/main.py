from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import ExifTags, Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("EVIDENCE_DATA_DIR", ROOT / "data"))
UPLOAD_DIR = Path(os.getenv("EVIDENCE_UPLOAD_DIR", ROOT / "uploads"))
DB_PATH = DATA_DIR / "investigations.sqlite3"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".pdf"}
DEMO_DOMAIN = "demo.university.edu"
SOURCES = {
    f"https://{DEMO_DOMAIN}/announcements/exams-cancelled": {
        "title": "[SYNTHETIC DEMO] University announces exam cancellation",
        "text": "The university has cancelled all examinations scheduled for this week. This synthetic announcement is provided only for the prototype demonstration.",
        "stance": "supports",
    },
    f"https://{DEMO_DOMAIN}/announcements/exams-continue": {
        "title": "[SYNTHETIC DEMO] University confirms exams will continue",
        "text": "The university confirms that all examinations will continue as scheduled this week. No examinations have been cancelled. This synthetic announcement is provided only for the prototype demonstration.",
        "stance": "contradicts",
    },
}

app = FastAPI(title="Evidence Desk API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DIST_DIR = ROOT / "dist"
ASSETS_DIR = DIST_DIR / "assets"
if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="frontend-assets")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS investigations (
            id TEXT PRIMARY KEY, claim TEXT NOT NULL, message TEXT NOT NULL,
            assessment TEXT NOT NULL, status TEXT NOT NULL, report_json TEXT NOT NULL,
            created_at TEXT NOT NULL, filename TEXT, stored_file TEXT
        )""")


@app.on_event("startup")
def startup() -> None:
    init_db()


def configured_domains() -> set[str]:
    custom = {d.strip().lower().lstrip(".") for d in os.getenv("OFFICIAL_SOURCE_DOMAINS", "").split(",") if d.strip()}
    return custom | {DEMO_DOMAIN}


def allowed_source_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        return parsed.scheme == "https" and any(host == d or host.endswith("." + d) for d in configured_domains())
    except ValueError:
        return False


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            clean = " ".join(data.split())
            if clean:
                self.parts.append(clean)


def read_source(url: str) -> dict[str, Any]:
    if url in SOURCES:
        source = SOURCES[url]
        return {"url": url, "title": source["title"], "text": source["text"], "stance": source["stance"], "synthetic": True, "retrieved_at": now_iso()}
    if not allowed_source_url(url):
        return {"url": url, "error": "Source host is not allowlisted. Add its domain to OFFICIAL_SOURCE_DOMAINS to enable fetching."}
    try:
        req = Request(url, headers={"User-Agent": "EvidenceDesk/1.0 (prototype; source verification)"})
        with urlopen(req, timeout=5) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "text/plain"}:
                return {"url": url, "error": f"Unsupported source content type: {content_type}."}
            raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                return {"url": url, "error": "Source page exceeded the 1 MB processing limit."}
            body = raw.decode("utf-8", errors="replace")
        parser = TextExtractor()
        parser.feed(body)
        title_match = re.search(r"<title[^>]*>(.*?)</title>", body, flags=re.I | re.S)
        title = " ".join(title_match.group(1).split()) if title_match else urlparse(url).netloc
        return {"url": url, "title": title, "text": " ".join(parser.parts)[:12000], "synthetic": False, "retrieved_at": now_iso()}
    except Exception as exc:
        return {"url": url, "error": f"Could not retrieve this source ({type(exc).__name__})."}


WORD_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = {"the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "that", "this", "all", "will", "for", "of", "to", "in", "on", "by", "and", "or", "it", "as", "at", "from", "with", "has", "have", "had", "do", "does", "did", "no", "not"}
NEGATIONS = {"not", "no", "never", "continue", "continues", "continuing", "proceed", "proceeds", "scheduled", "remain", "remains"}


def classify_source(claim: str, source: dict[str, Any]) -> tuple[str, str]:
    if source.get("stance"):
        return source["stance"], "The synthetic fixture has a predefined stance for this reproducible demo case."
    claim_words = set(WORD_RE.findall(claim.lower())) - STOPWORDS
    text = source.get("text", "")
    source_words = set(WORD_RE.findall(text.lower()))
    if not claim_words or not source_words:
        return "unclear", "The source contained too little usable text to compare with the claim."
    overlap = claim_words & source_words
    coverage = len(overlap) / len(claim_words)
    if coverage < 0.28:
        return "unclear", "The source did not mention enough of the claim's key terms to establish it."
    claim_negated = bool(set(WORD_RE.findall(claim.lower())) & NEGATIONS)
    source_negated = bool(set(WORD_RE.findall(text.lower())) & NEGATIONS)
    if claim_negated != source_negated and coverage >= 0.4:
        return "contradicts", "The source shares key claim terms but states the opposite position."
    return "supports", "The source contains the claim's key terms; automated text matching is suggestive and needs human review."


def evidence_excerpt(text: str, claim: str, limit: int = 420) -> str:
    text = " ".join(text.split())
    words = set(WORD_RE.findall(claim.lower()))
    sentences = re.split(r"(?<=[.!?])\s+", text)
    ranked = sorted(enumerate(sentences), key=lambda pair: sum(1 for w in WORD_RE.findall(pair[1].lower()) if w in words), reverse=True)
    picked = [sentence for _, sentence in ranked[:2] if sentence]
    excerpt = " ".join(picked) or text
    return excerpt[:limit] + ("…" if len(excerpt) > limit else "")


def inspect_file(filename: str, content: bytes) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload PNG, JPG, WEBP, or PDF.")
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    info: dict[str, Any] = {"filename": filename, "file_type": mime, "extension": suffix, "size_bytes": len(content), "metadata": {}, "indicators": [], "limitations": []}
    if suffix == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="The uploaded file does not contain a readable PDF signature.")
        info["metadata"] = {"document_metadata": "Not available in this prototype"}
        info["limitations"].append("PDF text, embedded objects, and edit history are not inspected by this prototype.")
        info["indicators"].append({"label": "Document structure", "result": "Not analyzed", "explanation": "No automated PDF manipulation analysis is available."})
        return info
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
        with Image.open(io.BytesIO(content)) as image:
            info["dimensions"] = {"width": image.width, "height": image.height}
            info["file_type"] = Image.MIME.get(image.format, mime)
            exif = image.getexif()
            meta: dict[str, Any] = {}
            for tag_id, value in exif.items():
                tag = ExifTags.TAGS.get(tag_id, str(tag_id))
                if isinstance(value, bytes):
                    value = value.decode("utf-8", errors="replace")
                meta[str(tag)] = str(value)[:300]
            info["metadata"] = meta or {"exif": "Not available"}
            info["indicators"].append({"label": "Metadata presence", "result": "Available" if meta else "Not available", "explanation": "Missing metadata alone is not evidence of manipulation." if not meta else "Metadata is descriptive and does not prove authenticity."})
            info["indicators"].append({"label": "Visual manipulation analysis", "result": "Not analyzed", "explanation": "This prototype does not run an image forgery detector."})
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=422, detail="The uploaded image is unreadable or corrupted.")
    return info


async def upload_bytes(file: UploadFile | None) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if file is None or not file.filename:
        return None, None, None
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload PNG, JPG, WEBP, or PDF.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB upload limit.")
    file_info = inspect_file(file.filename, content)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{suffix}"
    (UPLOAD_DIR / stored).write_bytes(content)
    return file_info, file.filename, stored


def build_report(claim: str, message: str, urls: list[str], file_info: dict[str, Any] | None) -> dict[str, Any]:
    source_results: list[dict[str, Any]] = []
    for url in urls:
        source = read_source(url)
        if source.get("error"):
            source_results.append({"url": url, "relation": "unavailable", "reason": source["error"], "evidence_excerpt": ""})
            continue
        relation, reason = classify_source(claim, source)
        source_results.append({"url": url, "title": source["title"], "retrieved_at": source["retrieved_at"], "synthetic": source["synthetic"], "relation": relation, "reason": reason, "evidence_excerpt": evidence_excerpt(source["text"], claim)})
    usable = [s for s in source_results if s["relation"] in {"supports", "contradicts", "unclear"}]
    has_support = any(s["relation"] == "supports" for s in usable)
    has_contradiction = any(s["relation"] == "contradicts" for s in usable)
    if has_support and not has_contradiction:
        assessment = "Supported"
        summary = "At least one supplied source supports the claim and none of the checked sources contradicts it. Review the linked evidence and its date."
    elif has_contradiction and not has_support:
        assessment = "Contradicted"
        summary = "At least one supplied source contradicts the claim and none of the checked sources supports it. Review the linked evidence and its date."
    else:
        assessment = "Inconclusive"
        summary = "The available sources do not establish a single clear conclusion. No source, mixed evidence, or insufficient text can all lead to this result."
    limitations = ["Automated text matching is a screening aid, not a fact-checker; a human should review the cited source.", "Only user-supplied URLs and labeled synthetic fixtures are checked; there is no broad web search.", "Metadata availability does not establish authenticity. This prototype does not run deepfake detection or definitive image manipulation analysis."]
    if file_info:
        limitations.extend(file_info.get("limitations", []))
    return {"claim": claim, "original_message": message, "assessment": assessment, "summary": summary, "status": "complete", "checked_at": now_iso(), "file": file_info, "sources": source_results, "checks": [
        {"name": "Claim extraction", "result": "User-provided claim", "evidence": claim},
        {"name": "Source comparison", "result": f"{len(usable)} source(s) processed", "evidence": "Each source result includes its own URL and excerpt."},
        {"name": "File inspection", "result": "Completed" if file_info else "No file supplied", "evidence": "See file details." if file_info else "No file was supplied."},
    ], "limitations": limitations}


def row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    report = json.loads(row["report_json"])
    return {"id": row["id"], "claim": row["claim"], "assessment": row["assessment"], "status": row["status"], "created_at": row["created_at"], "filename": row["filename"], "sources_count": len(report.get("sources", []))}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "source_mode": "user-supplied URLs plus labeled synthetic fixtures"}


@app.get("/", include_in_schema=False)
def frontend_index() -> FileResponse:
    index = DIST_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Frontend build is not available.")
    return FileResponse(index)


@app.get("/api/demo-sources")
def demo_sources() -> list[dict[str, str]]:
    return [{"url": url, "title": source["title"], "note": "Synthetic fixture for demonstration only"} for url, source in SOURCES.items()]


@app.get("/api/investigations")
def list_investigations() -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM investigations ORDER BY created_at DESC").fetchall()
    return [row_to_item(row) for row in rows]


@app.post("/api/investigations", status_code=201)
async def create_investigation(
    claim: str = Form(...),
    message: str = Form(""),
    source_urls: str = Form("[]"),
    file: UploadFile | None = File(None),
) -> dict[str, Any]:
    claim = claim.strip()
    if not claim:
        raise HTTPException(status_code=422, detail="Enter a claim to investigate.")
    if len(claim) > 1200:
        raise HTTPException(status_code=422, detail="Claim must be 1,200 characters or fewer.")
    try:
        urls = json.loads(source_urls)
        if not isinstance(urls, list) or any(not isinstance(url, str) for url in urls):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=422, detail="Source URLs must be a JSON array of strings.")
    urls = list(dict.fromkeys(url.strip() for url in urls if url.strip()))[:10]
    for url in urls:
        parsed = urlparse(url)
        if parsed.scheme not in {"https"} or not parsed.hostname:
            raise HTTPException(status_code=422, detail="Source URLs must be valid HTTPS URLs.")
    file_info, filename, stored = await upload_bytes(file)
    report = build_report(claim, message[:5000], urls, file_info)
    inv_id = uuid.uuid4().hex
    created_at = report["checked_at"]
    with connect() as db:
        db.execute("INSERT INTO investigations (id, claim, message, assessment, status, report_json, created_at, filename, stored_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (inv_id, claim, message[:5000], report["assessment"], "complete", json.dumps(report), created_at, filename, stored))
    return {"id": inv_id, **report}


@app.get("/api/investigations/{investigation_id}")
def get_investigation(investigation_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM investigations WHERE id = ?", (investigation_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Investigation not found.")
    return {"id": investigation_id, **json.loads(row["report_json"])}


@app.get("/{frontend_path:path}", include_in_schema=False)
def frontend_fallback(frontend_path: str) -> FileResponse:
    if frontend_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found.")
    candidate = (DIST_DIR / frontend_path).resolve()
    if candidate.is_relative_to(DIST_DIR.resolve()) and candidate.is_file():
        return FileResponse(candidate)
    index = DIST_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend build is not available.")

