#!/usr/bin/env python3
"""Build a page-aware text index from the full local AI Agent knowledge-base PDF.

The original PDF is read-only. The generated JSONL index is stored under data/.
Requires PyMuPDF (fitz).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable

import fitz

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "AI Agent工程师知识库全文.pdf"
DEFAULT_OUTPUT = ROOT / "data" / "knowledge_chunks.jsonl"
SECTIONS = {
    "基础篇", "RAG篇", "框架篇", "系统篇", "策略篇",
    "IDE篇", "场景题", "开放题", "核心技术文档", "数据库设计",
}


def clean_paragraph(value: str) -> str:
    value = value.replace("\x00", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def split_long_paragraph(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts = re.split(r"(?<=[。！？；.!?;])", text)
    output: list[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        if len(current) + len(part) <= limit:
            current += part
            continue
        if current:
            output.append(current.strip())
        while len(part) > limit:
            output.append(part[:limit].strip())
            part = part[limit:]
        current = part
    if current.strip():
        output.append(current.strip())
    return output


def make_chunks(paragraphs: Iterable[str], max_chars: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        for part in split_long_paragraph(paragraph, max_chars):
            candidate = (current + "\n\n" + part).strip() if current else part
            if len(candidate) <= max_chars:
                current = candidate
                continue
            if current:
                chunks.append(current)
            carry = current[-overlap:] if overlap and current else ""
            current = (carry + "\n\n" + part).strip() if carry else part
            if len(current) > max_chars:
                current = current[-max_chars:]
    if current:
        chunks.append(current)
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-chars", type=int, default=1100)
    parser.add_argument("--overlap", type=int, default=140)
    parser.add_argument("--first-page", type=int, default=1)
    parser.add_argument("--last-page", type=int, default=0, help="0 means through the final page")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source PDF not found: {args.source}")
    if args.max_chars < 300 or args.overlap < 0 or args.overlap >= args.max_chars:
        raise SystemExit("Invalid chunk size or overlap.")

    document = fitz.open(args.source)
    first_page = max(1, args.first_page)
    last_page = min(args.last_page or len(document), len(document))
    current_section = "未分类"
    rows: list[dict[str, object]] = []

    for page_index in range(first_page - 1, last_page):
        page = document[page_index]
        raw_text = page.get_text("text", sort=True)
        printed_match = re.search(r"[〈<]\s*(\d{1,4})\s*[〉>]", raw_text)
        printed_page = int(printed_match.group(1)) if printed_match else None
        paragraphs: list[str] = []

        for block in page.get_text("blocks", sort=True):
            if len(block) < 5:
                continue
            paragraph = clean_paragraph(str(block[4]))
            if not paragraph:
                continue
            compact = re.sub(r"\s+", "", paragraph)
            if compact in SECTIONS:
                current_section = compact
                continue
            if "FEISHU WIKI" in paragraph and len(paragraph) < 100:
                continue
            paragraphs.append(paragraph)

        if not paragraphs:
            continue

        page_title = next((p.splitlines()[0][:100] for p in paragraphs if p.strip()), f"PDF 第 {page_index + 1} 页")
        chunks = make_chunks(paragraphs, args.max_chars, args.overlap)
        for chunk_index, chunk in enumerate(chunks):
            digest = hashlib.sha1(f"{page_index + 1}|{chunk_index}|{chunk}".encode("utf-8")).hexdigest()[:16]
            rows.append({
                "id": f"pdf-{digest}",
                "source": args.source.name,
                "pdfPage": page_index + 1,
                "printedPage": printed_page,
                "section": current_section,
                "pageTitle": page_title,
                "chunkIndex": chunk_index,
                "text": chunk,
            })

    document.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(json.dumps({
        "source": str(args.source),
        "pdfPagesIndexed": last_page - first_page + 1,
        "chunks": len(rows),
        "output": str(args.output),
        "bytes": args.output.stat().st_size,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
