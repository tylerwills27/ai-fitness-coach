# backend/scrape_and_load.py
import os
import sys
import time
import shutil
import tempfile
import re
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tqdm import tqdm

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

# =========================
# Environment / Keys
# =========================
load_dotenv(override=True)
API_KEY = os.getenv("OPENAI_API_KEY")
if not API_KEY or API_KEY.startswith("your_api"):
    raise ValueError("❌ Missing OpenAI API Key in .env")

print(f"🔑 Using Key: {API_KEY[:8]}*******")

# =========================
# URL List (can still pass on CLI)
# =========================
URLS = [
    "https://www.cdc.gov/nutrition/features/micronutrient-facts.html",
    "https://www.cdc.gov/nutrition/features/healthy-eating-tips.html",
    "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    "https://ods.od.nih.gov/factsheets/list-all/",
    "https://www.cdc.gov/healthy-weight-growth/losing-weight/improve-eating-habits.html",
    "https://www.cdc.gov/healthy-weight-growth/physical-activity/index.html",
    "https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html",
    "https://journals.lww.com/acsm-msse/Fulltext/2011/07000/Quantity_and_Quality_of_Exercise_for_Developing.26.aspx",
    "https://journals.lww.com/acsm-msse/Fulltext/2016/03000/Nutrition_and_Athletic_Performance.25.aspx",
    "https://journals.lww.com/acsm-msse/Fulltext/2009/07000/Exercise_and_Physical_Activity_for_Older_Adults.20.aspx",
    "https://journals.lww.com/acsm-msse/Fulltext/2004/11000/Physical_Activity_and_Bone_Health.24.aspx",
    "https://journals.lww.com/acsm-msse/Fulltext/2004/03000/Exercise_and_Hypertension.25.aspx",
    "https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf?",
]

# =========================
# Chroma DB
# =========================
BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "data", "chroma")

_embeddings = None
_db = None

def get_db() -> Chroma:
    global _db, _embeddings
    if _embeddings is None:
        _embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=API_KEY)
    if _db is None:
        os.makedirs(DB_PATH, exist_ok=True)
        _db = Chroma(persist_directory=DB_PATH, embedding_function=_embeddings)
    return _db

# =========================
# HTTP helpers (NO timeouts)
# =========================
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome Safari (AI-Fitness-Coach-Scraper)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def is_pdf_url(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".pdf")

def get_no_timeout(url: str, stream: bool = False) -> requests.Response:
    # timeout=None => infinite (no connect/read timeout)
    return requests.get(url, headers=HEADERS, timeout=None, stream=stream)

# =========================
# Extraction utilities
# =========================
def extract_pdf_stream(resp: requests.Response) -> str:
    from pypdf import PdfReader
    total = int(resp.headers.get("Content-Length") or 0)
    chunk_size = 256 * 1024

    if total > 0:
        size_label = f"{total/1_000_000:.2f} MB"
    else:
        size_label = "size unknown"
    print(f"  📥 Downloading PDF ({size_label})…")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        if total > 0:
            with tqdm(total=total, unit="B", unit_scale=True, unit_divisor=1024, desc="  📄 PDF Bytes", leave=True) as bar:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if chunk:
                        tmp.write(chunk)
                        bar.update(len(chunk))
        else:
            with tqdm(total=None, unit="B", unit_scale=True, unit_divisor=1024, desc="  📄 PDF Bytes", leave=True) as bar:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if chunk:
                        tmp.write(chunk)
                        bar.update(len(chunk))
        tmp_path = tmp.name

    print("  🔍 Extracting text from PDF pages…")
    reader = PdfReader(tmp_path)
    pages = []
    with tqdm(total=len(reader.pages), desc="  📚 Pages", unit="page", leave=True) as page_bar:
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            pages.append(text)
            page_bar.update(1)

    try:
        os.remove(tmp_path)
    except Exception:
        pass

    text = "\n\n".join(pages)
    print(f"  ✅ Extracted {len(text)} characters from PDF")
    return text

def extract_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for bad in soup(["script", "style", "nav", "header", "footer", "noscript"]):
        bad.extract()
    text = soup.get_text(" ")
    cleaned = " ".join(text.split())
    return cleaned

# ---------- Scholarly fallbacks ----------
# 1) Find meta tags like citation_pdf_url and citation_doi
def _find_meta(soup: BeautifulSoup, name: str) -> Optional[str]:
    tag = soup.find("meta", attrs={"name": name})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None

def _find_doi_in_html(html: str) -> Optional[str]:
    # Try common patterns
    # meta name="citation_doi"
    soup = BeautifulSoup(html, "html.parser")
    doi = _find_meta(soup, "citation_doi")
    if doi:
        return doi

    # Sometimes DOI appears as a URL like https://doi.org/10.xxxx/xxxx
    m = re.search(r"https?://doi\.org/([^\s\"'<>{}]+)", html, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # Generic DOI regex (best effort)
    m2 = re.search(r"\b10\.\d{4,9}/[^\s\"'<>{}]+", html, re.IGNORECASE)
    if m2:
        return m2.group(0).strip()

    return None

def _crossref_abstract(doi: str) -> Optional[str]:
    try:
        url = f"https://api.crossref.org/works/{requests.utils.quote(doi, safe='')}"
        r = get_no_timeout(url, stream=False)
        data = r.json()
        # abstract may be in JATS XML-like string e.g. "<jats:p>...</jats:p>"
        abstract = (data.get("message", {}) or {}).get("abstract")
        if abstract and isinstance(abstract, str):
            # remove simple JATS tags
            abstract_clean = re.sub(r"<[^>]+>", " ", abstract)
            abstract_clean = " ".join(abstract_clean.split())
            return abstract_clean.strip()
    except Exception:
        return None
    return None

def _pubmed_abstract_from_doi(doi: str) -> Optional[str]:
    try:
        # 1) find PMID by DOI
        esearch = get_no_timeout(
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term={requests.utils.quote(doi)}",
            stream=False,
        ).json()
        ids = ((esearch or {}).get("esearchresult", {}) or {}).get("idlist", [])
        if not ids:
            return None
        pmid = ids[0]
        # 2) fetch summary
        efetch = get_no_timeout(
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id={pmid}",
            stream=False,
        ).text
        # quick & dirty abstract parse
        m = re.search(r"<AbstractText[^>]*>(.*?)</AbstractText>", efetch, re.DOTALL | re.IGNORECASE)
        if m:
            text = re.sub(r"<[^>]+>", " ", m.group(1))
            text = " ".join(text.split())
            return text.strip()
    except Exception:
        return None
    return None

def scholarly_fallback_from_html(url: str, html: str) -> Optional[Tuple[str, str]]:
    """
    Try to recover useful text when HTML page is paywalled:
    1) citation_pdf_url → fetch PDF text
    2) DOI → Crossref abstract
    3) DOI → PubMed abstract
    Returns (text, source_note) or None
    """
    soup = BeautifulSoup(html, "html.parser")

    # 1) Try direct PDF via meta (often present even on paywalled HTML)
    pdf_url = _find_meta(soup, "citation_pdf_url")
    if pdf_url:
        try:
            print(f"  🔎 Found citation_pdf_url → {pdf_url}")
            pdf_resp = get_no_timeout(pdf_url, stream=True)
            ctype = (pdf_resp.headers.get("Content-Type") or "").lower()
            if "pdf" in ctype or is_pdf_url(pdf_url):
                text = extract_pdf_stream(pdf_resp)
                if len(text.strip()) >= 200:
                    return text, f"{url} [PDF via citation_pdf_url]"
        except Exception as e:
            print(f"  ⚠️ PDF fetch via citation_pdf_url failed: {e}")

    # 2) Try DOI → Crossref abstract
    doi = _find_doi_in_html(html)
    if doi:
        print(f"  🔎 Found DOI: {doi} → trying Crossref abstract")
        abs_text = _crossref_abstract(doi)
        if abs_text and len(abs_text.strip()) >= 100:
            return abs_text, f"{url} [Crossref abstract for DOI {doi}]"

        # 3) Try PubMed as a second option
        print(f"  🔎 Trying PubMed for DOI: {doi}")
        p_text = _pubmed_abstract_from_doi(doi)
        if p_text and len(p_text.strip()) >= 100:
            return p_text, f"{url} [PubMed abstract for DOI {doi}]"

    return None

# =========================
# Scraping (no timeouts)
# =========================
def scrape(url: str) -> Tuple[str, str]:
    """
    Returns (text, source_note)
    """
    print(f"\n🌐 Scraping: {url}")
    stream = is_pdf_url(url)
    resp = get_no_timeout(url, stream=stream)

    ctype = (resp.headers.get("Content-Type") or "").lower()
    if "pdf" in ctype or is_pdf_url(url):
        print("  📑 PDF detected")
        text = extract_pdf_stream(resp)
        return text, url

    # HTML path
    print("  🌍 HTML page detected")
    html = resp.text
    text = extract_html_text(html)
    if len(text.strip()) >= 200:
        print(f"  ✅ Extracted {len(text)} characters from HTML")
        return text, url

    print("  ⚠️ Not enough meaningful text — attempting scholarly fallbacks…")
    fb = scholarly_fallback_from_html(url, html)
    if fb:
        ftext, src = fb
        print(f"  ✅ Scholarly fallback succeeded ({len(ftext)} chars)")
        return ftext, src

    print("  ❌ No usable text found after fallbacks.")
    return "", url

# =========================
# Storage
# =========================
def already_in_db(url: str) -> bool:
    try:
        return len(get_db().get(where={"source": url})["ids"]) > 0
    except Exception:
        return False

def process(url: str):
    if already_in_db(url):
        print(f"⏭️ Skipping (exists): {url}")
        return

    text, source_note = scrape(url)
    if len(text.strip()) < 200:
        print("  ⚠️ Not enough text to index. Skipping.")
        return

    print("✂️ Splitting text into chunks…")
    splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=300)
    chunks = splitter.split_text(text)
    print(f"📦 Generated {len(chunks)} chunks")

    db = get_db()
    batch = 10
    print("🧠 Embedding & storing chunks (with ETA)…")
    for i in tqdm(range(0, len(chunks), batch), desc="  🔗 Embedding", unit="batch", leave=True):
        part = chunks[i:i + batch]
        ids = [f"{source_note}_chunk_{j}" for j in range(i, i + len(part))]
        metas = [{"source": source_note, "chunk": j} for j in range(i, i + len(part))]
        db.add_texts(texts=part, ids=ids, metadatas=metas)

    try:
        db.persist()
    except Exception:
        pass

    print("✅ Done.")

# =========================
# Main
# =========================
def parse_cli() -> List[str]:
    args = sys.argv[1:]
    return args if args else URLS

if __name__ == "__main__":
    print("⚙️  Running with **NO TIMEOUTS** (infinite wait allowed)")
    urls = parse_cli()
    for u in urls:
        try:
            process(u)
        except Exception as e:
            print(f"❌ Error: {e}")

    print("\n🎉 All scraping + embedding complete!\n")
