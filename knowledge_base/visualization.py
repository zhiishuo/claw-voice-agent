#!/usr/bin/env python3
import json
import pickle
from pathlib import Path

import numpy as np

from .text_splitter import TextChunk


def build_visualization(
    vectors: np.ndarray,
    chunks: list[TextChunk],
    output_path: str | Path,
    method: str = "pca",
    model_output_path: str | Path | None = None,
) -> dict:
    method = (method or "pca").strip().lower()
    if method not in {"pca", "umap", "none"}:
        raise ValueError("visualization method must be one of: pca, umap, none")
    if method == "none":
        return {"method": "none", "points": []}

    coordinates, actual_method, model_payload = reduce_vectors(vectors, method)
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
    if model_output_path and model_payload:
        model_path = Path(model_output_path)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        with model_path.open("wb") as fh:
            pickle.dump(model_payload, fh)
    return payload


def reduce_vectors(vectors: np.ndarray, method: str = "pca") -> tuple[np.ndarray, str, dict | None]:
    matrix = np.asarray(vectors, dtype="float32")
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        return np.zeros((0, 2), dtype="float32"), method, None
    if matrix.shape[0] == 1:
        payload = {
            "method": method,
            "mean": matrix.mean(axis=0, keepdims=True),
            "components": np.zeros((matrix.shape[1], 2), dtype="float32"),
            "bounds": {"low": [0.0, 0.0], "high": [1.0, 1.0]},
        }
        return np.zeros((1, 2), dtype="float32"), method, payload

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
            raw = reducer.fit_transform(matrix)
            coordinates, bounds = _normalize_coordinates(raw, return_bounds=True)
            return coordinates, "umap", {"method": "umap", "reducer": reducer, "bounds": bounds}
        except ImportError as exc:
            raise RuntimeError("UMAP visualization requires: pip install umap-learn") from exc

    mean = matrix.mean(axis=0, keepdims=True)
    centered = matrix - mean
    _, _, vh = np.linalg.svd(centered, full_matrices=False)
    components = vh[:2].T
    coordinates = centered @ components
    if coordinates.shape[1] == 1:
        coordinates = np.column_stack([coordinates[:, 0], np.zeros(matrix.shape[0], dtype="float32")])
    normalized, bounds = _normalize_coordinates(coordinates, return_bounds=True)
    return normalized, "pca", {
        "method": "pca",
        "mean": mean.astype("float32"),
        "components": components.astype("float32"),
        "bounds": bounds,
    }


def project_query_vector(query_vector: np.ndarray, model_path: str | Path) -> dict | None:
    path = Path(model_path)
    if not path.exists():
        return None
    with path.open("rb") as fh:
        payload = pickle.load(fh)

    matrix = np.asarray(query_vector, dtype="float32")
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        return None

    method = payload.get("method")
    if method == "umap":
        raw = payload["reducer"].transform(matrix)
    elif method == "pca":
        raw = (matrix - payload["mean"]) @ payload["components"]
    else:
        return None

    normalized = _apply_normalization(raw, payload.get("bounds") or {})
    return {
        "x": round(float(normalized[0, 0]), 6),
        "y": round(float(normalized[0, 1]), 6),
        "method": method,
        "projected": True,
    }


def _normalize_coordinates(coordinates: np.ndarray, return_bounds: bool = False):
    coords = np.asarray(coordinates, dtype="float32")
    if coords.ndim != 2 or coords.shape[0] == 0:
        empty = np.zeros((0, 2), dtype="float32")
        return (empty, {"low": [0.0, 0.0], "high": [1.0, 1.0]}) if return_bounds else empty
    if coords.shape[1] < 2:
        coords = np.column_stack([coords[:, 0], np.zeros(coords.shape[0], dtype="float32")])

    normalized = np.zeros((coords.shape[0], 2), dtype="float32")
    low_values = []
    high_values = []
    for axis in range(2):
        values = coords[:, axis]
        low = float(values.min())
        high = float(values.max())
        low_values.append(low)
        high_values.append(high)
        if high > low:
            normalized[:, axis] = ((values - low) / (high - low)) * 2.0 - 1.0
    bounds = {"low": low_values, "high": high_values}
    return (normalized, bounds) if return_bounds else normalized


def _apply_normalization(coordinates: np.ndarray, bounds: dict) -> np.ndarray:
    coords = np.asarray(coordinates, dtype="float32")
    if coords.shape[1] < 2:
        coords = np.column_stack([coords[:, 0], np.zeros(coords.shape[0], dtype="float32")])
    normalized = np.zeros((coords.shape[0], 2), dtype="float32")
    lows = bounds.get("low") or [0.0, 0.0]
    highs = bounds.get("high") or [1.0, 1.0]
    for axis in range(2):
        low = float(lows[axis])
        high = float(highs[axis])
        if high > low:
            normalized[:, axis] = ((coords[:, axis] - low) / (high - low)) * 2.0 - 1.0
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
