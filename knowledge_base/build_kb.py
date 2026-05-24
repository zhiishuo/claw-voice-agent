#!/usr/bin/env python3
import argparse
import json
import shutil
import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_base.config import get_config
from knowledge_base.document_loader import load_documents
from knowledge_base.embedding import EmbeddingModel
from knowledge_base.keyword_index import KeywordIndex
from knowledge_base.text_cleaner import clean_text
from knowledge_base.text_splitter import split_documents
from knowledge_base.vector_store import FaissVectorStore


def build_knowledge_base(args: argparse.Namespace) -> None:
    config = get_config(
        source_dir=args.source,
        output_dir=args.output,
        embedding_model=args.model,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        batch_size=args.batch_size,
    )
    documents = load_documents(config.source_dir)
    for document in documents:
        document.text = clean_text(document.text)
    documents = [document for document in documents if document.text]

    chunks = split_documents(documents, config.chunk_size, config.chunk_overlap)
    if not chunks:
        raise RuntimeError(f"no valid knowledge chunks found in {config.source_dir}")

    embedder = EmbeddingModel(config.embedding_model, normalize=config.normalize_embeddings)
    vectors = embedder.encode([chunk.text for chunk in chunks], batch_size=config.batch_size)

    store = FaissVectorStore(config.index_path, config.metadata_path)
    store.build(vectors, chunks)

    KeywordIndex(config.keyword_index_path).build(chunks)
    manifest_rows = _write_manifest(config.manifest_path, config.originals_dir, documents)

    print("Knowledge base built successfully.")
    print(f"source_dir: {config.source_dir}")
    print(f"documents: {len(documents)}")
    print(f"source_files: {len(manifest_rows)}")
    print(f"chunks: {len(chunks)}")
    print(f"embedding_model: {config.embedding_model}")
    print(f"index_path: {config.index_path}")
    print(f"metadata_path: {config.metadata_path}")
    print(f"keyword_index_path: {config.keyword_index_path}")
    print(f"manifest_path: {config.manifest_path}")
    print(f"originals_dir: {config.originals_dir}")


def _write_manifest(manifest_path: Path, originals_dir: Path, documents) -> list[dict]:
    rows_by_checksum: dict[str, dict] = {}
    originals_dir.mkdir(parents=True, exist_ok=True)

    for document in documents:
        metadata = document.metadata
        checksum = metadata.get("file_checksum")
        source = metadata.get("source")
        if not checksum or not source or checksum in rows_by_checksum:
            continue
        source_path = Path(source)
        original_copy = originals_dir / f"{checksum[:16]}_{_safe_filename(source_path.name)}"
        if not original_copy.exists():
            shutil.copy2(source_path, original_copy)
        rows_by_checksum[checksum] = {
            "document_id": metadata.get("document_id"),
            "filename": metadata.get("filename"),
            "relative_path": metadata.get("relative_path"),
            "extension": metadata.get("extension"),
            "file_checksum": checksum,
            "file_size": metadata.get("file_size"),
            "file_mtime": metadata.get("file_mtime"),
            "ingest_time": metadata.get("ingest_time"),
            "original_copy": str(original_copy),
            "status": "indexed",
        }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    rows = list(rows_by_checksum.values())
    with manifest_path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return rows


def _safe_filename(filename: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in filename)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build FAISS knowledge base for Claw Voice Agent.")
    parser.add_argument("--source", required=True, help="Knowledge source file or directory.")
    parser.add_argument("--output", default=None, help="Output directory for FAISS index and metadata.")
    parser.add_argument("--model", default=None, help="SentenceTransformer embedding model name.")
    parser.add_argument("--chunk-size", type=int, default=None, help="Maximum characters per chunk.")
    parser.add_argument("--chunk-overlap", type=int, default=None, help="Overlapped characters between chunks.")
    parser.add_argument("--batch-size", type=int, default=None, help="Embedding batch size.")
    return parser.parse_args()


if __name__ == "__main__":
    build_knowledge_base(parse_args())
