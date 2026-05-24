#!/usr/bin/env python3
import argparse
import re
import tempfile
import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_base.config import get_config
from knowledge_base.document_loader import load_documents
from knowledge_base.embedding import EmbeddingModel
from knowledge_base.text_cleaner import clean_text
from knowledge_base.text_splitter import split_documents
from knowledge_base.vector_store import FaissVectorStore


def run_demo(args: argparse.Namespace) -> None:
    source = Path(args.source).resolve()
    output = Path(args.output).resolve() if args.output else Path(tempfile.mkdtemp(prefix="openclaw-kb-demo-"))
    config = get_config(
        source_dir=str(source),
        output_dir=str(output),
        embedding_model=args.model,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
    )

    documents = load_documents(config.source_dir)
    for document in documents:
        document.text = clean_text(document.text)
    documents = [document for document in documents if document.text]
    chunks = split_documents(documents, config.chunk_size, config.chunk_overlap)

    embedder = EmbeddingModel(config.embedding_model, normalize=config.normalize_embeddings)
    vectors = embedder.encode([chunk.text for chunk in chunks], batch_size=config.batch_size)
    store = FaissVectorStore(config.index_path, config.metadata_path)
    store.build(vectors, chunks)

    query_vector = embedder.encode([args.query], batch_size=1)
    results = store.search(query_vector, top_k=args.top_k)
    answer = generate_demo_answer(args.query, results)

    print("=== User Question ===")
    print(args.query)
    print()
    print("=== Final Answer (Demo RAG) ===")
    print(answer)
    print()
    print("=== Retrieved Evidence ===")
    for rank, item in enumerate(results, start=1):
        metadata = item.get("metadata", {})
        source_name = metadata.get("relative_path") or metadata.get("source")
        preview = item.get("text", "").replace("\n", " ")[: args.preview_chars]
        print(f"[{rank}] score={item['score']:.4f} source={source_name}")
        print(preview)
        print()
    print("=== Knowledge Base Build ===")
    print(f"source: {source}")
    print(f"output: {output}")
    print(f"documents: {len(documents)}")
    print(f"chunks: {len(chunks)}")
    print(f"embedding: {config.embedding_model}")


def generate_demo_answer(query: str, results: list[dict]) -> str:
    if not results:
        return "知识库中没有检索到足够相关的内容，建议补充空管规章、运行手册或语音转写资料后再查询。"

    best = results[0]
    best_text = best.get("text", "")
    best_sentences = _extract_relevant_sentences(query, best_text, limit=3)
    sources: list[str] = []

    for item in results[:3]:
        metadata = item.get("metadata", {})
        source = metadata.get("relative_path") or metadata.get("filename") or metadata.get("source")
        if source and source not in sources:
            sources.append(source)

    lines = [
        f"问题：{query}",
        "",
        "回答：",
    ]
    if best_sentences:
        lines.extend(f"{index}. {sentence}" for index, sentence in enumerate(best_sentences, start=1))
    else:
        lines.append(_compact_text(best_text, 260))
    primary_source = sources[0] if sources else ""
    if primary_source:
        lines.extend(["", "主要引用来源：" + primary_source])
    if len(sources) > 1:
        lines.append("其他检索来源：" + "；".join(sources[1:]))
    lines.extend(
        [
            "",
            "Demo 说明：这里没有调用本地大模型，而是用知识库检索结果生成规则化回答；接入真实大模型后，可把 Retrieved Evidence 作为 prompt 上下文。",
        ]
    )
    return "\n".join(lines)


def _extract_relevant_sentences(query: str, text: str, limit: int = 3) -> list[str]:
    query_terms = set(_query_terms(query))
    sentences = [
        sentence.strip(" #")
        for sentence in re.split(r"(?<=[。！？；!?;])\s*|\n+", text)
        if _is_answer_sentence(sentence)
    ]
    scored: list[tuple[int, int, str]] = []
    for index, sentence in enumerate(sentences):
        terms = set(_query_terms(sentence))
        score = len(query_terms & terms)
        if any(keyword in sentence for keyword in ["应当确认", "应当说明", "复诵", "承担管制责任"]):
            score += 8
        if score > 0:
            scored.append((score, -index, sentence))
    if not scored:
        return [_compact_text(text, 260)]
    scored.sort(reverse=True)
    selected = [sentence for _, _, sentence in scored[:limit]]
    return [_compact_text(sentence, 180) for sentence in selected]


def _query_terms(text: str) -> list[str]:
    text = str(text or "").lower()
    words = re.findall(r"[a-z0-9_]+", text)
    chinese = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    chars = re.findall(r"[\u4e00-\u9fff]", text)
    return words + chinese + chars


def _is_answer_sentence(text: str) -> bool:
    sentence = str(text or "").strip(" #")
    if len(sentence) < 12:
        return False
    if sentence.startswith("##"):
        return False
    return True


def _compact_text(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a no-local-LLM RAG demo with FAISS retrieval.")
    parser.add_argument(
        "--source",
        default=str(Path(__file__).resolve().parents[1] / "examples" / "knowledge_base_docs"),
        help="Demo knowledge document directory.",
    )
    parser.add_argument("--output", default=None, help="Output directory for demo FAISS index.")
    parser.add_argument("--query", default="航空器移交前管制员需要确认哪些信息？", help="Demo question.")
    parser.add_argument("--model", default="shibing624/text2vec-base-chinese", help="Use 'shibing624/text2vec-base-chinese' for model download.")
    parser.add_argument("--top-k", type=int, default=3, help="Number of retrieved chunks.")
    parser.add_argument("--chunk-size", type=int, default=360, help="Chunk size for demo.")
    parser.add_argument("--chunk-overlap", type=int, default=60, help="Chunk overlap for demo.")
    parser.add_argument("--preview-chars", type=int, default=180, help="Evidence preview length.")
    return parser.parse_args()


if __name__ == "__main__":
    run_demo(parse_args())
