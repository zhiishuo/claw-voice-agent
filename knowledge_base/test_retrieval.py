#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_base.config import get_config
from knowledge_base.embedding import EmbeddingModel
from knowledge_base.retriever import KnowledgeRetriever


def test_retrieval(args: argparse.Namespace) -> None:
    config = get_config(output_dir=args.output, embedding_model=args.model)
    query_vector = None
    if args.mode in {"vector", "hybrid"}:
        embedder = EmbeddingModel(config.embedding_model, normalize=config.normalize_embeddings)
        query_vector = embedder.encode([args.query], batch_size=1)

    retriever = KnowledgeRetriever(config.index_path, config.metadata_path, config.keyword_index_path)
    results = retriever.search(
        args.query,
        query_vector=query_vector,
        top_k=args.top_k,
        mode=args.mode,
        vector_weight=args.vector_weight,
        keyword_weight=args.keyword_weight,
    )
    for rank, item in enumerate(results, start=1):
        metadata = item.get("metadata", {})
        text = item.get("text", "").replace("\n", " ")
        source = metadata.get("relative_path") or metadata.get("source")
        score_bits = [f"score={item['score']:.4f}"]
        if "vector_score" in item:
            score_bits.append(f"vector={item['vector_score']:.4f}")
        if "keyword_score" in item:
            score_bits.append(f"keyword={item['keyword_score']:.4f}")
        print(f"[{rank}] {' '.join(score_bits)} source={source}")
        details = _metadata_details(metadata)
        if details:
            print(details)
        print(text[: args.preview_chars])
        print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test FAISS retrieval for Claw Voice Agent knowledge base.")
    parser.add_argument("query", help="Query text.")
    parser.add_argument("--output", default=None, help="Knowledge base output directory.")
    parser.add_argument("--model", default=None, help="SentenceTransformer embedding model name.")
    parser.add_argument("--mode", choices=["hybrid", "vector", "keyword"], default="hybrid", help="Retrieval mode.")
    parser.add_argument("--vector-weight", type=float, default=0.45, help="Hybrid vector score weight.")
    parser.add_argument("--keyword-weight", type=float, default=0.55, help="Hybrid keyword score weight.")
    parser.add_argument("--top-k", type=int, default=5, help="Number of retrieved chunks.")
    parser.add_argument("--preview-chars", type=int, default=800, help="Characters to print for each chunk.")
    return parser.parse_args()


def _metadata_details(metadata: dict) -> str:
    keys = ["knowledge_unit_id", "chunk_type", "section_title", "article_number", "page", "sheet_name", "row_start"]
    parts = [f"{key}={metadata[key]}" for key in keys if metadata.get(key) is not None]
    return "  " + " ".join(parts) if parts else ""


if __name__ == "__main__":
    test_retrieval(parse_args())
