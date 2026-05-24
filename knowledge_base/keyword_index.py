#!/usr/bin/env python3
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from .text_splitter import TextChunk


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "to",
    "what",
    "which",
    "who",
    "whose",
    "with",
}


class KeywordIndex:
    def __init__(self, index_path: str | Path):
        self.index_path = Path(index_path)

    def build(self, chunks: list[TextChunk]) -> None:
        postings: dict[str, list[list[int]]] = defaultdict(list)
        lengths: list[int] = []

        for chunk_id, chunk in enumerate(chunks):
            tokens = _tokenize(_indexable_text(chunk.text, chunk.metadata))
            counts = Counter(tokens)
            lengths.append(sum(counts.values()))
            for token, count in counts.items():
                postings[token].append([chunk_id, count])

        payload = {
            "doc_count": len(chunks),
            "avg_len": (sum(lengths) / len(lengths)) if lengths else 0.0,
            "lengths": lengths,
            "postings": postings,
        }
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.index_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def search(self, query: str, top_k: int = 20) -> list[dict]:
        if not self.index_path.exists():
            return []

        payload = json.loads(self.index_path.read_text(encoding="utf-8"))
        doc_count = int(payload.get("doc_count") or 0)
        avg_len = float(payload.get("avg_len") or 1.0)
        lengths = payload.get("lengths") or []
        postings = payload.get("postings") or {}
        if doc_count <= 0:
            return []

        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        scores: dict[int, float] = defaultdict(float)
        for token in query_tokens:
            entries = postings.get(token)
            if not entries:
                continue
            df = len(entries)
            idf = math.log(1.0 + (doc_count - df + 0.5) / (df + 0.5))
            for chunk_id, tf in entries:
                doc_len = lengths[chunk_id] if chunk_id < len(lengths) else avg_len
                scores[chunk_id] += _bm25(tf, doc_len, avg_len, idf)

        for token in set(query_tokens):
            entries = postings.get(token)
            if entries and _looks_like_identifier(token, len(entries)):
                for chunk_id, _ in entries:
                    scores[chunk_id] += 3.0

        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:top_k]
        return [{"id": chunk_id, "keyword_score": score} for chunk_id, score in ranked]


def _bm25(tf: int, doc_len: float, avg_len: float, idf: float) -> float:
    k1 = 1.5
    b = 0.75
    denominator = tf + k1 * (1.0 - b + b * (doc_len / max(avg_len, 1.0)))
    return idf * ((tf * (k1 + 1.0)) / max(denominator, 1e-9))


def _indexable_text(text: str, metadata: dict) -> str:
    extras = [
        metadata.get("filename", ""),
        metadata.get("relative_path", ""),
        metadata.get("section_title", ""),
        metadata.get("article_number", ""),
        metadata.get("sheet_name", ""),
        " ".join(str(value) for value in metadata.get("table_fields", []) or []),
    ]
    return "\n".join([text, *extras])


def _tokenize(text: str) -> list[str]:
    text = str(text or "")
    lowered = text.lower()
    tokens = [
        token
        for token in re.findall(r"[a-z0-9][a-z0-9_\-./]*", lowered)
        if token not in STOPWORDS
    ]
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    cjk_bigrams = [
        text[index : index + 2]
        for index in range(max(0, len(text) - 1))
        if _has_cjk(text[index : index + 2])
    ]
    return tokens + cjk_chars + cjk_bigrams


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def _looks_like_identifier(token: str, document_frequency: int) -> bool:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_\-./]{2,}", token):
        return False
    return any(char.isdigit() for char in token) or document_frequency <= 1000
