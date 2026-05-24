#!/usr/bin/env python3
import hashlib
import re

import numpy as np


class EmbeddingModel:
    def __init__(self, model_name: str, normalize: bool = True):
        if model_name in {"hashing", "local-hashing"}:
            self.model_name = model_name
            self.normalize = normalize
            self.model = None
            self._dimension = 384
            return

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "Embedding requires sentence-transformers: pip install sentence-transformers"
            ) from exc

        self.model_name = model_name
        self.normalize = normalize
        self.model = SentenceTransformer(model_name)

    @property
    def dimension(self) -> int:
        if self.model is None:
            return self._dimension
        return int(self.model.get_sentence_embedding_dimension())

    def encode(self, texts: list[str], batch_size: int = 32) -> np.ndarray:
        if self.model is None:
            return self._encode_hashing(texts)

        vectors = self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            normalize_embeddings=self.normalize,
        )
        return np.asarray(vectors, dtype="float32")

    def _encode_hashing(self, texts: list[str]) -> np.ndarray:
        vectors = np.zeros((len(texts), self._dimension), dtype="float32")
        for row, text in enumerate(texts):
            for token in _tokenize(text):
                digest = hashlib.md5(token.encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "little") % self._dimension
                sign = 1.0 if digest[4] % 2 == 0 else -1.0
                vectors[row, index] += sign
            if self.normalize:
                norm = float(np.linalg.norm(vectors[row]))
                if norm > 0:
                    vectors[row] /= norm
        return vectors


def _tokenize(text: str) -> list[str]:
    text = str(text or "").lower()
    words = re.findall(r"[a-z0-9_]+", text)
    chinese = re.findall(r"[\u4e00-\u9fff]", text)
    bigrams = [text[i : i + 2] for i in range(max(0, len(text) - 1)) if _has_cjk(text[i : i + 2])]
    return words + chinese + bigrams


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)
