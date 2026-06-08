#!/usr/bin/env python3
import json
import os
import pathlib
import sys
import threading


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name, default):
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _env_int(name, default):
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


class KnowledgeService:
    def __init__(self):
        self.enabled = _env_bool("OPENCLAW_KB_ENABLED", False)
        self.output_dir = os.environ.get("OPENCLAW_KB_OUTPUT_DIR", "").strip()
        self.model = os.environ.get("OPENCLAW_KB_EMBEDDING_MODEL", "").strip() or None
        self.mode = os.environ.get("OPENCLAW_KB_RETRIEVAL_MODE", "hybrid").strip().lower() or "hybrid"
        if self.mode not in {"hybrid", "vector", "keyword"}:
            self.mode = "hybrid"
        self.top_k = _env_int("OPENCLAW_KB_TOP_K", 4)
        self.preview_chars = _env_int("OPENCLAW_KB_PREVIEW_CHARS", 300)
        self.vector_weight = _env_float("OPENCLAW_KB_VECTOR_WEIGHT", 0.7)
        self.keyword_weight = _env_float("OPENCLAW_KB_KEYWORD_WEIGHT", 0.3)
        self._lock = threading.Lock()
        self._embedder = None
        self._retriever = None
        self._config = None
        self._error = None
        self._visualization_cache = None
        self._visualization_cache_key = None

    def status(self):
        return {
            "enabled": self.enabled,
            "output_dir": self.output_dir or None,
            "model": self.model,
            "mode": self.mode,
            "top_k": self.top_k,
            "loaded": self._retriever is not None,
            "error": self._error,
        }

    def retrieve(self, query, top_k=None, mode=None):
        return self.search(query, top_k=top_k, mode=mode).get("results", [])

    def search(self, query, top_k=None, mode=None):
        if not self.enabled:
            return {"results": [], "query_point": None}
        query = str(query or "").strip()
        if not query:
            return {"results": [], "query_point": None}
        try:
            self._ensure_loaded()
            search_mode = (mode or self.mode).lower()
            query_vector = None
            if search_mode in {"vector", "hybrid"}:
                query_vector = self._embedder.encode([query], batch_size=1)
            results = self._retriever.search(
                query,
                query_vector=query_vector,
                top_k=top_k or self.top_k,
                mode=search_mode,
                vector_weight=self.vector_weight,
                keyword_weight=self.keyword_weight,
            )
            return {"results": results, "query_point": self._project_query_point(query_vector)}
        except Exception as exc:
            self._error = str(exc)
            return {"results": [], "query_point": None}

    def build_prompt_context(self, query):
        results = self.retrieve(query)
        if not results:
            return "", []

        lines = ["Retrieved knowledge evidence. Use it when relevant and mention the source briefly:"]
        citations = []
        for index, item in enumerate(results, start=1):
            metadata = item.get("metadata", {})
            source = metadata.get("relative_path") or metadata.get("filename") or metadata.get("source") or "unknown"
            text = str(item.get("text") or "").replace("\n", " ").strip()
            preview = text[: self.preview_chars]
            score = item.get("score")
            citations.append(
                {
                    "rank": index,
                    "source": source,
                    "score": score,
                    "vector_score": item.get("vector_score"),
                    "keyword_score": item.get("keyword_score"),
                    "text": preview,
                    "knowledge_unit_id": metadata.get("knowledge_unit_id"),
                    "chunk_index": metadata.get("chunk_index"),
                    "chunk_type": metadata.get("chunk_type"),
                    "chunk_chars": metadata.get("chunk_chars"),
                    "page": metadata.get("page"),
                    "sheet_name": metadata.get("sheet_name"),
                    "row_start": metadata.get("row_start"),
                }
            )
            if isinstance(score, float):
                lines.append(f"[{index}] source={source} score={score:.4f}")
            else:
                lines.append(f"[{index}] source={source}")
            lines.append(preview)
        return "\n".join(lines), citations

    def visualization(self):
        if not self.enabled:
            return {"available": False, "points": [], "error": "knowledge base is disabled"}
        try:
            from knowledge_base.config import get_config

            config = get_config(output_dir=self.output_dir or None, embedding_model=self.model)
            path = config.visualization_path
            if not path.exists():
                return {
                    "available": False,
                    "points": [],
                    "path": str(path),
                    "error": "visualization file not found; rebuild the knowledge base",
                }
            stat = path.stat()
            cache_key = (str(path), stat.st_mtime_ns, stat.st_size)
            with self._lock:
                if self._visualization_cache is not None and self._visualization_cache_key == cache_key:
                    return self._visualization_cache
                payload = json.loads(path.read_text(encoding="utf-8"))
                payload["available"] = True
                payload["path"] = str(path)
                payload["cached"] = True
                self._visualization_cache = payload
                self._visualization_cache_key = cache_key
                return payload
        except Exception as exc:
            self._error = str(exc)
            return {"available": False, "points": [], "error": str(exc)}

    def _project_query_point(self, query_vector):
        if query_vector is None:
            return None
        try:
            from knowledge_base.visualization import project_query_vector

            config = self._config
            if config is None:
                from knowledge_base.config import get_config

                config = get_config(output_dir=self.output_dir or None, embedding_model=self.model)
            return project_query_vector(query_vector, config.visualization_model_path)
        except Exception:
            return None

    def _ensure_loaded(self):
        if self._retriever is not None and self._embedder is not None:
            return
        with self._lock:
            if self._retriever is not None and self._embedder is not None:
                return
            from knowledge_base.config import get_config
            from knowledge_base.embedding import EmbeddingModel
            from knowledge_base.retriever import KnowledgeRetriever

            config = get_config(output_dir=self.output_dir or None, embedding_model=self.model)
            self._config = config
            self._embedder = EmbeddingModel(config.embedding_model, normalize=config.normalize_embeddings)
            self._retriever = KnowledgeRetriever(config.index_path, config.metadata_path, config.keyword_index_path)
            self._error = None


KNOWLEDGE_SERVICE = KnowledgeService()
