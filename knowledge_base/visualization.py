#!/usr/bin/env python3
import json
from pathlib import Path

import numpy as np

from .text_splitter import TextChunk


def build_visualization(
    vectors: np.ndarray,
    chunks: list[TextChunk],
    output_path: str | Path,
    method: str = "pca",
) -> dict:
    method = (method or "pca").strip().lower()
    if method not in {"pca", "umap", "none"}:
        raise ValueError("visualization method must be one of: pca, umap, none")
    if method == "none":
        return {"method": "none", "points": []}

    coordinates, actual_method = reduce_vectors(vectors, method)
    points = [_point_payload(index, chunk, coordinates[index]) for index, chunk in enumerate(chunks)]
    payload = {
        "method": actual_method,
        "dimensions": 2,
        "count": len(points),
        "points": points,
    }

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def reduce_vectors(vectors: np.ndarray, method: str = "pca") -> tuple[np.ndarray, str]:
    matrix = np.asarray(vectors, dtype="float32")
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        return np.zeros((0, 2), dtype="float32"), method
    if matrix.shape[0] == 1:
        return np.zeros((1, 2), dtype="float32"), method

    if method == "umap":
        try:
            import umap

            n_neighbors = max(2, min(15, matrix.shape[0] - 1))
            reducer = umap.UMAP(
                n_components=2,
                n_neighbors=n_neighbors,
                min_dist=0.1,
                metric="cosine",
                random_state=42,
            )
            return _normalize_coordinates(reducer.fit_transform(matrix)), "umap"
        except ImportError as exc:
            raise RuntimeError("UMAP visualization requires: pip install umap-learn") from exc

    centered = matrix - matrix.mean(axis=0, keepdims=True)
    _, _, vh = np.linalg.svd(centered, full_matrices=False)
    components = vh[:2].T
    coordinates = centered @ components
    if coordinates.shape[1] == 1:
        coordinates = np.column_stack([coordinates[:, 0], np.zeros(matrix.shape[0], dtype="float32")])
    return _normalize_coordinates(coordinates), "pca"


def _normalize_coordinates(coordinates: np.ndarray) -> np.ndarray:
    coords = np.asarray(coordinates, dtype="float32")
    if coords.ndim != 2 or coords.shape[0] == 0:
        return np.zeros((0, 2), dtype="float32")
    if coords.shape[1] < 2:
        coords = np.column_stack([coords[:, 0], np.zeros(coords.shape[0], dtype="float32")])

    normalized = np.zeros((coords.shape[0], 2), dtype="float32")
    for axis in range(2):
        values = coords[:, axis]
        low = float(values.min())
        high = float(values.max())
        if high > low:
            normalized[:, axis] = ((values - low) / (high - low)) * 2.0 - 1.0
    return normalized


def _point_payload(index: int, chunk: TextChunk, coordinate: np.ndarray) -> dict:
    metadata = chunk.metadata or {}
    source = metadata.get("relative_path") or metadata.get("filename") or metadata.get("source") or "unknown"
    text = " ".join(str(chunk.text or "").split())
    return {
        "id": index,
        "knowledge_unit_id": metadata.get("knowledge_unit_id"),
        "x": round(float(coordinate[0]), 6),
        "y": round(float(coordinate[1]), 6),
        "source": source,
        "chunk_type": metadata.get("chunk_type") or "text",
        "section_title": metadata.get("section_title"),
        "article_number": metadata.get("article_number"),
        "page": metadata.get("page"),
        "sheet_name": metadata.get("sheet_name"),
        "row_start": metadata.get("row_start"),
        "text_preview": text[:260],
    }
