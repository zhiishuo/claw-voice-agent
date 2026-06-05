#!/usr/bin/env python3
import os
import shutil
import threading
import time
from pathlib import Path


BACKEND = "modelscope-campplus"
DEFAULT_MODEL_ID = "damo/speech_campplus_sv_zh-cn_16k-common"
FALLBACK_MODEL_ID = "iic/speech_campplus_sv_zh-cn_16k-common"


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


def _safe_float(value):
    if value is None:
        return None
    try:
        if hasattr(value, "detach"):
            value = value.detach()
        if hasattr(value, "cpu"):
            value = value.cpu()
        if hasattr(value, "item"):
            value = value.item()
        return float(value)
    except Exception:
        try:
            return float(value)
        except Exception:
            return None


def _extract_score(result):
    if isinstance(result, (int, float)):
        return float(result)
    if isinstance(result, dict):
        for key in ("score", "scores", "similarity", "confidence"):
            if key not in result:
                continue
            value = result.get(key)
            if isinstance(value, (list, tuple)):
                value = value[0] if value else None
            score = _safe_float(value)
            if score is not None:
                return score
    if isinstance(result, (list, tuple)):
        for item in result:
            score = _extract_score(item)
            if score is not None:
                return score
    return None


class SpeakerVerifier:
    def __init__(self):
        home = Path.home() / ".openclaw"
        self.default_speaker_id = os.environ.get("OPENCLAW_SPEAKER_ID", "owner").strip() or "owner"
        self.threshold = _env_float("OPENCLAW_SPEAKER_THRESHOLD", 0.31)
        self.profile_dir = Path(
            os.environ.get("OPENCLAW_SPEAKER_PROFILE_DIR", str(home / "webchat/speakers"))
        ).expanduser()
        self.model_id = os.environ.get("OPENCLAW_SPEAKER_MODEL_ID", DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
        self.sample_strategy = (
            os.environ.get("OPENCLAW_SPEAKER_SAMPLE_STRATEGY", "best").strip().lower() or "best"
        )
        if self.sample_strategy not in {"best", "latest"}:
            self.sample_strategy = "best"
        self._pipeline = None
        self._loaded_model_id = None
        self._model_error = None
        self._lock = threading.Lock()

    def is_enabled(self):
        return _env_bool("OPENCLAW_SPEAKER_VERIFY_ENABLED", False)

    def _speaker_id(self, speaker_id=None):
        return str(speaker_id or self.default_speaker_id or "owner").strip() or "owner"

    def _speaker_dir(self, speaker_id=None):
        safe_id = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in self._speaker_id(speaker_id))
        return self.profile_dir / safe_id

    def _samples(self, speaker_id=None):
        directory = self._speaker_dir(speaker_id)
        if not directory.exists():
            return []
        suffixes = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".webm"}
        return sorted(path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in suffixes)

    def list_profiles(self):
        if not self.profile_dir.exists():
            return []
        profiles = []
        for directory in sorted(path for path in self.profile_dir.iterdir() if path.is_dir()):
            samples = self._samples(directory.name)
            profiles.append({
                "speaker_id": directory.name,
                "num_samples": len(samples),
                "has_profile": bool(samples),
                "profile_dir": str(directory),
            })
        return profiles

    def has_profile(self, speaker_id=None):
        return bool(self._samples(speaker_id))

    def _selected_samples(self, samples):
        if self.sample_strategy == "latest" and samples:
            return [max(samples, key=lambda path: path.stat().st_mtime)]
        return samples

    def _candidate_model_ids(self):
        ids = [self.model_id]
        if self.model_id != FALLBACK_MODEL_ID:
            ids.append(FALLBACK_MODEL_ID)
        return ids

    def _load_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline
        if self._model_error is not None:
            raise RuntimeError(self._model_error)
        with self._lock:
            if self._pipeline is not None:
                return self._pipeline
            if self._model_error is not None:
                raise RuntimeError(self._model_error)
            errors = []
            try:
                from modelscope.pipelines import pipeline
                from modelscope.utils.constant import Tasks
            except Exception as exc:
                self._model_error = f"failed to import modelscope: {exc}"
                raise RuntimeError(self._model_error)

            for model_id in self._candidate_model_ids():
                try:
                    self._pipeline = pipeline(task=Tasks.speaker_verification, model=model_id)
                    self._loaded_model_id = model_id
                    self._model_error = None
                    return self._pipeline
                except Exception as exc:
                    errors.append(f"{model_id}: {exc}")
            self._model_error = "failed to load ModelScope CAM++ pipeline: " + " | ".join(errors)
            raise RuntimeError(self._model_error)

    def enroll(self, audio_path, speaker_id="owner"):
        sid = self._speaker_id(speaker_id)
        src = Path(audio_path)
        if not src.exists() or not src.is_file():
            return {"ok": False, "speaker_id": sid, "error": "audio file not found"}
        try:
            directory = self._speaker_dir(sid)
            directory.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d_%H%M%S")
            target = directory / f"enroll_{stamp}.wav"
            if target.exists():
                target = directory / f"enroll_{stamp}_{int(time.time() * 1000)}.wav"
            shutil.copy2(src, target)
            samples = self._samples(sid)
            return {
                "ok": True,
                "speaker_id": sid,
                "num_samples": len(samples),
                "profile_dir": str(directory),
                "message": "speaker enrolled",
            }
        except Exception as exc:
            return {"ok": False, "speaker_id": sid, "error": str(exc)}

    def _verify_samples(self, audio_path, speaker_id, samples):
        verifier = self._load_pipeline()
        src = Path(audio_path)
        selected_samples = self._selected_samples(samples)
        best_score = None
        best_sample = None
        errors = []
        for sample in selected_samples:
            try:
                result = verifier([str(src), str(sample)], thr=self.threshold)
                score = _extract_score(result)
            except Exception as exc:
                errors.append({"sample": str(sample), "error": str(exc)})
                continue
            if score is not None and (best_score is None or score > best_score):
                best_score = score
                best_sample = sample
        return best_score, best_sample, len(selected_samples), errors

    def verify(self, audio_path, speaker_id="owner"):
        sid = self._speaker_id(speaker_id)
        if not self.is_enabled():
            return {
                "ok": True,
                "enabled": False,
                "matched": True,
                "score": None,
                "reason": "speaker verification disabled",
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
            }

        src = Path(audio_path)
        if not src.exists() or not src.is_file():
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "reason": "audio file not found",
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
            }

        samples = self._samples(sid)
        if not samples:
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "reason": "speaker profile not enrolled",
                "speaker_id": sid,
                "num_samples": 0,
                "threshold": self.threshold,
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
        }

        try:
            best_score, best_sample, compared_samples, sample_errors = self._verify_samples(str(src), sid, samples)
            matched = bool(best_score is not None and best_score >= self.threshold)
            return {
                "ok": True,
                "enabled": True,
                "matched": matched,
                "score": best_score,
                "threshold": self.threshold,
                "speaker_id": sid,
                "num_samples": len(samples),
                "compared_samples": compared_samples,
                "sample_strategy": self.sample_strategy,
                "model_id": self._loaded_model_id or self.model_id,
                "backend": BACKEND,
                "best_sample": str(best_sample) if best_sample else None,
                "sample_errors": sample_errors,
                "reason": "speaker matched" if matched else "speaker not matched",
            }
        except Exception as exc:
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "threshold": self.threshold,
                "speaker_id": sid,
                "num_samples": len(samples),
                "model_id": self._loaded_model_id or self.model_id,
                "backend": BACKEND,
                "error": str(exc),
            }

    def verify_any(self, audio_path):
        if not self.is_enabled():
            return {
                "ok": True,
                "enabled": False,
                "matched": True,
                "score": None,
                "speaker_id": self.default_speaker_id,
                "reason": "speaker verification disabled",
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
            }

        src = Path(audio_path)
        if not src.exists() or not src.is_file():
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "reason": "audio file not found",
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
            }

        profiles = [profile for profile in self.list_profiles() if profile.get("has_profile")]
        if not profiles:
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "threshold": self.threshold,
                "speaker_id": None,
                "num_samples": 0,
                "profiles": [],
                "reason": "speaker profile not enrolled",
                "backend": BACKEND,
                "model_id": self._loaded_model_id or self.model_id,
            }

        try:
            best_score = None
            best_sample = None
            best_speaker_id = None
            best_num_samples = 0
            checked = []
            for profile in profiles:
                sid = profile["speaker_id"]
                samples = self._samples(sid)
                score, sample, compared_samples, sample_errors = self._verify_samples(str(src), sid, samples)
                checked.append({
                    "speaker_id": sid,
                    "score": score,
                    "num_samples": len(samples),
                    "compared_samples": compared_samples,
                    "sample_errors": sample_errors,
                })
                if score is not None and (best_score is None or score > best_score):
                    best_score = score
                    best_sample = sample
                    best_speaker_id = sid
                    best_num_samples = len(samples)

            matched = bool(best_score is not None and best_score >= self.threshold)
            return {
                "ok": True,
                "enabled": True,
                "matched": matched,
                "score": best_score,
                "threshold": self.threshold,
                "speaker_id": best_speaker_id,
                "num_samples": best_num_samples,
                "sample_strategy": self.sample_strategy,
                "profiles": checked,
                "model_id": self._loaded_model_id or self.model_id,
                "backend": BACKEND,
                "best_sample": str(best_sample) if best_sample else None,
                "reason": "speaker matched" if matched else "speaker not matched",
            }
        except Exception as exc:
            return {
                "ok": False,
                "enabled": True,
                "matched": False,
                "score": None,
                "threshold": self.threshold,
                "speaker_id": None,
                "num_samples": 0,
                "profiles": profiles,
                "model_id": self._loaded_model_id or self.model_id,
                "backend": BACKEND,
                "error": str(exc),
            }

    def status(self, speaker_id="owner"):
        sid = self._speaker_id(speaker_id)
        samples = self._samples(sid)
        return {
            "ok": True,
            "enabled": self.is_enabled(),
            "speaker_id": sid,
            "threshold": self.threshold,
            "has_profile": bool(samples),
            "num_samples": len(samples),
            "profile_dir": str(self._speaker_dir(sid)),
            "profiles": self.list_profiles(),
            "sample_strategy": self.sample_strategy,
            "model_id": self._loaded_model_id or self.model_id,
            "configured_model_id": self.model_id,
            "backend": BACKEND,
            "model_loaded": self._pipeline is not None,
            "model_error": self._model_error,
        }
