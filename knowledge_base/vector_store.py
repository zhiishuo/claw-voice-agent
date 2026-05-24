#!/usr/bin/env python3
import json
from pathlib import Path

import numpy as np

from .text_splitter import TextChunk


class FaissVectorStore:
    def __init__(self, index_path: str | Path, metadata_path: str | Path):
        try:
            import faiss
        except ImportError as exc:
            raise RuntimeError("FAISS requires faiss-cpu: pip install faiss-cpu") from exc

        self.faiss = faiss
        self.index_path = Path(index_path)
        self.metadata_path = Path(metadata_path)

    def build(self, vectors: np.ndarray, chunks: list[TextChunk]) -> None:
        if len(vectors) != len(chunks):
            raise ValueError("vectors and chunks length mismatch")
        if len(chunks) == 0:
            raise ValueError("no chunks to index")

        dim = int(vectors.shape[1])
        index = self.faiss.IndexFlatIP(dim)
        index.add(np.asarray(vectors, dtype="float32"))

        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.faiss.write_index(index, str(self.index_path))
        self._write_metadata(chunks)

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> list[dict]:
        index = self.faiss.read_index(str(self.index_path))
        query = np.asarray(query_vector, dtype="float32")
        if query.ndim == 1:
            query = query.reshape(1, -1)
        scores, ids = index.search(query, top_k)
        metadata = self._read_metadata()
        results: list[dict] = []
        for score, idx in zip(scores[0], ids[0]):
            if idx < 0 or idx >= len(metadata):
                continue
            item = metadata[idx]
            results.append({**item, "score": float(score)})
        return results

    def _write_metadata(self, chunks: list[TextChunk]) -> None:
        with self.metadata_path.open("w", encoding="utf-8") as fh:
            for chunk_id, chunk in enumerate(chunks):
                payload = {
                    "id": chunk_id,
                    "text": chunk.text,
                    "metadata": chunk.metadata,
                }
                fh.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def _read_metadata(self) -> list[dict]:
        items: list[dict] = []
        with self.metadata_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    items.append(json.loads(line))
        return items
