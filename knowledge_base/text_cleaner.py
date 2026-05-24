#!/usr/bin/env python3
import re


CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
REPEATED_SPACE = re.compile(r"[ \t\u3000]+")
REPEATED_NEWLINE = re.compile(r"\n{3,}")


def clean_text(text: str) -> str:
    text = str(text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = CONTROL_CHARS.sub("", text)
    text = REPEATED_SPACE.sub(" ", text)
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(line for line in lines if line)
    text = REPEATED_NEWLINE.sub("\n\n", text)
    return text.strip()
