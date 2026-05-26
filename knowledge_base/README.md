# Knowledge Base Module

This module builds a FAISS knowledge base for air traffic control documents, operation manuals,
regulations, spreadsheets, and ASR transcripts.

## No Local LLM Demo

The demo below does not require a locally deployed LLM. It retrieves relevant evidence and uses a
mock RAG answer generator to show the full workflow.

```powershell
.\.venv\Scripts\python.exe knowledge_base\demo_qa.py
```

Custom question:

```powershell
.\.venv\Scripts\python.exe knowledge_base\demo_qa.py --query "航空器移交前管制员需要确认哪些信息？"
```

## Embedding Models

The knowledge base can be built with different SentenceTransformer-compatible embedding models.
Use the same model for both index building and retrieval.

| Scenario | Model | Notes |
| --- | --- | --- |
| Local development | `shibing624/text2vec-base-chinese` | Default model. Good for Chinese and mixed Chinese/English tests. Lighter and faster. |
| Server deployment | `BAAI/bge-m3` | Better multilingual retrieval for Chinese/English knowledge bases. Larger and slower to build. |

## Build With Local Text2Vec

This is the default local setup. It is suitable for development on a normal PC.

```powershell
.\.venv\Scripts\python.exe knowledge_base\build_kb.py `
  --source examples\knowledge_base_docs `
  --output .kb `
  --visualization-method pca
```

The build also writes `visualization.json` for the WebChat knowledge-base test page. The default
`pca` method is fast and requires no extra dependency. For a more cluster-like map on a server,
install `umap-learn` and build with `--visualization-method umap`.

Test retrieval with the same default model:

```powershell
.\.venv\Scripts\python.exe knowledge_base\test_retrieval.py `
  "跑道起飞许可前需要确认什么？" `
  --output .openclaw-kb
```

## Build With BGE-M3 On Server

Use this when the project is deployed to a stronger server and you want better Chinese/English
multilingual retrieval. The model will be downloaded on first use unless it already exists in the
server model cache.

```powershell
.\.venv\Scripts\python.exe knowledge_base\build_kb.py `
  --source examples\knowledge_base_docs `
  --output .kb `
  --model BAAI/bge-m3 `
  --visualization-method umap
```

Test retrieval with the same BGE-M3 model:

```powershell
.\.venv\Scripts\python.exe knowledge_base\test_retrieval.py `
  "跑道起飞许可前需要确认什么？" `
  --output .openclaw-kb-bge-m3 `
  --model BAAI/bge-m3
```

You can also set the model through an environment variable:

```powershell
$env:OPENCLAW_KB_EMBEDDING_MODEL="BAAI/bge-m3"
```

## Source Documents

Sample documents live in `examples/knowledge_base_docs/`.

Supported source formats include `.txt`, `.md`, `.json`, `.jsonl`, `.csv`, `.xlsx`, `.pdf`, and
real `.docx` files. Legacy `.doc` files should be converted to `.docx` or text before building.

After changing source documents, rebuild the knowledge base so the FAISS index and metadata stay in
sync with the latest files.

## Build Artifacts

The output directory stores the knowledge base as coordinated source, metadata, keyword, and vector
artifacts:

| File or directory | Purpose |
| --- | --- |
| `kb.faiss` | Dense vector index for semantic retrieval. |
| `keyword_index.json` | Keyword/BM25-style index for terms, codes, regulation numbers, airport names, and table fields. |
| `visualization.json` | 2D PCA/UMAP coordinates for whole-knowledge-base visualization in WebChat. |
| `metadata.jsonl` | Chunk text plus source file, checksum, section, page, sheet, row, chunk type, and knowledge unit metadata. |
| `manifest.jsonl` | File-level ingestion manifest with filename, file type, SHA-256 checksum, file size, ingest time, and original copy path. |
| `originals/` | Preserved copies of source files for version tracking and result verification. |

Each source file is identified by a SHA-256 checksum. If a source file changes, rebuild the index so
the manifest, chunks, keyword index, and vector index stay aligned.

## Retrieval Modes

Retrieval supports three modes:

| Mode | Use case |
| --- | --- |
| `vector` | Natural language semantic search with FAISS. |
| `keyword` | Exact or explicit matches such as `KJFK`, NOTAM, regulation numbers, table fields, and professional terms. |
| `hybrid` | Default. Combines vector and keyword retrieval for general QA. |

Hybrid retrieval is recommended for production-like QA:

```powershell
.\.venv\Scripts\python.exe knowledge_base\test_retrieval.py `
  "Which airport has the ident KJFK?" `
  --output .openclaw-kb `
  --mode hybrid
```

For debugging exact matches, use keyword-only retrieval:

```powershell
.\.venv\Scripts\python.exe knowledge_base\test_retrieval.py `
  "Which airport has the ident KJFK?" `
  --output .openclaw-kb `
  --mode keyword
```
