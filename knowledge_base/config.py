#!/usr/bin/env python3
import os
from dataclasses import dataclass
from pathlib import Path


OPENCLAW_HOME = Path(os.environ.get("OPENCLAW_HOME", str(Path.home() / ".openclaw")))


@dataclass(frozen=True)
class KnowledgeBaseConfig:
    source_dir: Path
    output_dir: Path
    index_path: Path
    metadata_path: Path
    keyword_index_path: Path
    manifest_path: Path
    originals_dir: Path
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    batch_size: int
    normalize_embeddings: bool


def get_config(
    source_dir: str | None = None,
    output_dir: str | None = None,
    embedding_model: str | None = None,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    batch_size: int | None = None,
) -> KnowledgeBaseConfig:
    base_output = Path(
        output_dir
        or os.environ.get("OPENCLAW_KB_OUTPUT_DIR")
        or OPENCLAW_HOME / "knowledge_base"
    ).expanduser()
    model_name = (
        embedding_model
        or os.environ.get("OPENCLAW_KB_EMBEDDING_MODEL")
        or "shibing624/text2vec-base-chinese"
    )
    size = int(chunk_size or os.environ.get("OPENCLAW_KB_CHUNK_SIZE", "700"))
    overlap = int(chunk_overlap or os.environ.get("OPENCLAW_KB_CHUNK_OVERLAP", "120"))
    batch = int(batch_size or os.environ.get("OPENCLAW_KB_BATCH_SIZE", "32"))

    if overlap >= size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    return KnowledgeBaseConfig(
        source_dir=Path(source_dir or os.environ.get("OPENCLAW_KB_SOURCE_DIR", "")).expanduser(),
        output_dir=base_output,
        index_path=base_output / "kb.faiss",
        metadata_path=base_output / "metadata.jsonl",
        keyword_index_path=base_output / "keyword_index.json",
        manifest_path=base_output / "manifest.jsonl",
        originals_dir=base_output / "originals",
        embedding_model=model_name,
        chunk_size=size,
        chunk_overlap=overlap,
        batch_size=batch,
        normalize_embeddings=os.environ.get("OPENCLAW_KB_NORMALIZE", "true").lower() != "false",
    )
