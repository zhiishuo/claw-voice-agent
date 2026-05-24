#!/usr/bin/env python3
import re
from dataclasses import dataclass, field

from .document_loader import Document


@dataclass
class TextChunk:
    text: str
    metadata: dict = field(default_factory=dict)


def split_documents(
    documents: list[Document],
    chunk_size: int = 700,
    chunk_overlap: int = 120,
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for doc in documents:
        for index, text in enumerate(split_text(doc.text, chunk_size, chunk_overlap)):
            context = _extract_chunk_context(text)
            chunk_type = doc.metadata.get("chunk_type") or context.get("chunk_type") or "text"
            chunks.append(
                TextChunk(
                    text=text,
                    metadata={
                        **doc.metadata,
                        "chunk_index": index,
                        "chunk_chars": len(text),
                        "chunk_type": chunk_type,
                        "knowledge_unit_id": f"{doc.metadata.get('document_id', 'document')}:{index}",
                        **context,
                    },
                )
            )
    return chunks


def split_text(text: str, chunk_size: int = 700, chunk_overlap: int = 120) -> list[str]:
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    paragraphs = [item.strip() for item in text.split("\n") if item.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        pieces = _split_long_paragraph(paragraph, chunk_size)
        for piece in pieces:
            if not current:
                current = piece
                continue
            if len(current) + 1 + len(piece) <= chunk_size:
                current = f"{current}\n{piece}"
                continue
            chunks.append(current)
            prefix = _tail_overlap(current, chunk_overlap)
            current = f"{prefix}\n{piece}".strip() if prefix else piece

    if current:
        chunks.append(current)
    return chunks


def _split_long_paragraph(paragraph: str, chunk_size: int) -> list[str]:
    if len(paragraph) <= chunk_size:
        return [paragraph]

    sentence_marks = "。！？；.!?;"
    pieces: list[str] = []
    start = 0
    while start < len(paragraph):
        end = min(start + chunk_size, len(paragraph))
        if end < len(paragraph):
            split_at = max(paragraph.rfind(mark, start, end) for mark in sentence_marks)
            if split_at > start + chunk_size // 2:
                end = split_at + 1
        pieces.append(paragraph[start:end].strip())
        start = end
    return [piece for piece in pieces if piece]


def _tail_overlap(text: str, overlap: int) -> str:
    if overlap <= 0 or len(text) <= overlap:
        return text if len(text) <= overlap else ""
    tail = text[-overlap:]
    first_break = tail.find("\n")
    return tail[first_break + 1 :].strip() if first_break >= 0 else tail.strip()


def _extract_chunk_context(text: str) -> dict:
    context: dict = {}
    headings = [
        line.strip("# ").strip()
        for line in text.splitlines()
        if line.lstrip().startswith("#") and line.strip("# ").strip()
    ]
    if headings:
        context["section_title"] = headings[0]
        context["section_titles"] = headings

    page_match = re.search(r"\[page\s+(\d+)\]", text, flags=re.IGNORECASE)
    if page_match:
        context["page"] = int(page_match.group(1))

    sheet_match = re.search(r"\[sheet:\s*([^\]]+)\]", text, flags=re.IGNORECASE)
    if sheet_match:
        context["sheet_name"] = sheet_match.group(1).strip()
        context["chunk_type"] = "table"

    row_match = re.search(r"\brow\s+(\d+):", text, flags=re.IGNORECASE)
    if row_match:
        context["row_start"] = int(row_match.group(1))
        context.setdefault("chunk_type", "table")

    article_match = re.search(r"(第[一二三四五六七八九十百千万0-9]+[章节条款])", text)
    if article_match:
        context["article_number"] = article_match.group(1)

    if " | " in text or ":" in text or "：" in text:
        context.setdefault("chunk_type", "record")

    return context
