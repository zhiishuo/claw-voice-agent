#!/usr/bin/env python3
from pathlib import Path

import numpy as np

from .keyword_index import KeywordIndex
from .vector_store import FaissVectorStore


class KnowledgeRetriever:
    def __init__(
        self,
        index_path: str | Path,
        metadata_path: str | Path,
        keyword_index_path: str | Path,
    ):
        self.vector_store = FaissVectorStore(index_path, metadata_path)
        self.keyword_index = KeywordIndex(keyword_index_path)

    def search(
        self,
        query: str,
        query_vector: np.ndarray | None = None,
        top_k: int = 5,
        mode: str = "hybrid",
        vector_weight: float = 0.45,
        keyword_weight: float = 0.55,
    ) -> list[dict]:
        mode = mode.lower()
        if mode not in {"vector", "keyword", "hybrid"}:
            raise ValueError("mode must be one of: vector, keyword, hybrid")

        if mode == "vector":
            if query_vector is None:
                raise ValueError("query_vector is required for vector retrieval")
            return self.vector_store.search(query_vector, top_k=top_k)

        metadata = self.vector_store._read_metadata()
        if mode == "keyword":
            return self._keyword_results(query, metadata, top_k)

        if query_vector is None:
            raise ValueError("query_vector is required for hybrid retrieval")

        vector_candidates = self.vector_store.search(query_vector, top_k=max(top_k * 8, 40))
        keyword_candidates = self.keyword_index.search(query, top_k=max(top_k * 8, 40))
        return self._merge_results(
            vector_candidates,
            keyword_candidates,
            metadata,
            top_k=top_k,
            vector_weight=vector_weight,
            keyword_weight=keyword_weight,
        )

    def _keyword_results(self, query: str, metadata: list[dict], top_k: int) -> list[dict]:
        results = []
        for item in self.keyword_index.search(query, top_k=top_k):
            chunk_id = item["id"]
            if 0 <= chunk_id < len(metadata):
                results.append({**metadata[chunk_id], "score": item["keyword_score"], "keyword_score": item["keyword_score"]})
        return results

    def _merge_results(
        self,
        vector_candidates: list[dict],
        keyword_candidates: list[dict],
        metadata: list[dict],
        top_k: int,
        vector_weight: float,
        keyword_weight: float,
    ) -> list[dict]:
        vector_scores = {item["id"]: float(item.get("score", 0.0)) for item in vector_candidates}
        keyword_scores = {item["id"]: float(item.get("keyword_score", 0.0)) for item in keyword_candidates}
        vector_norm = _normalize_scores(vector_scores)
        keyword_norm = _normalize_scores(keyword_scores)

        merged_ids = set(vector_scores) | set(keyword_scores)
        ranked: list[tuple[float, int]] = []
        for chunk_id in merged_ids:
            score = vector_weight * vector_norm.get(chunk_id, 0.0) + keyword_weight * keyword_norm.get(chunk_id, 0.0)
            ranked.append((score, chunk_id))

        ranked.sort(reverse=True)
        results = []
        for score, chunk_id in ranked[:top_k]:
            if 0 <= chunk_id < len(metadata):
                results.append(
                    {
                        **metadata[chunk_id],
                        "score": score,
                        "vector_score": vector_scores.get(chunk_id, 0.0),
                        "keyword_score": keyword_scores.get(chunk_id, 0.0),
                    }
                )
        return results


def _normalize_scores(scores: dict[int, float]) -> dict[int, float]:
    if not scores:
        return {}
    values = list(scores.values())
    low = min(values)
    high = max(values)
    if high <= low:
        return {key: 1.0 for key in scores}
    return {key: (value - low) / (high - low) for key, value in scores.items()}
