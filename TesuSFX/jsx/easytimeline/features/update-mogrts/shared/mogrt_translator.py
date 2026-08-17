import json
import sys
import time
import urllib.parse
import urllib.request


MAX_CHARS_PER_REQUEST = 4500
LINE_BREAK_PLACEHOLDER = "[BR]"
GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EasyTimeline/1.0"
}


def normalize_caption_text(text):
    value = str(text if text is not None else "")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return value.replace("\n", LINE_BREAK_PLACEHOLDER)


def chunk_lines(lines, max_chars):
    chunks = []
    current = []
    current_len = 0

    for line in lines:
        projected_len = current_len + len(line) + (1 if current else 0)
        if current and projected_len > max_chars:
            chunks.append(current)
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len = projected_len

    if current:
        chunks.append(current)
    return chunks


def translate_text(text, target_language):
    normalized = str(text if text is not None else "").strip()
    if not normalized:
        return ""

    params = {
        "client": "gtx",
        "sl": "auto",
        "tl": target_language,
        "dt": "t",
        "q": normalized,
    }
    request_url = GOOGLE_TRANSLATE_ENDPOINT + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(request_url, headers=REQUEST_HEADERS)

    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")

    data = json.loads(payload)
    segments = data[0] if isinstance(data, list) and data else None
    if not isinstance(segments, list):
        raise ValueError("Unexpected translation response format.")

    translated_parts = []
    for segment in segments:
        if isinstance(segment, list) and segment:
            translated_parts.append(str(segment[0] if segment[0] is not None else ""))

    translated = "".join(translated_parts).strip()
    return translated or normalized


def translate_chunk(target_language, chunk_lines_list):
    joined = "\n".join(chunk_lines_list)
    translated = translate_text(joined, target_language)
    translated_lines = str(translated).split("\n")

    # Fallback when Google collapses or expands line breaks unexpectedly.
    if len(translated_lines) != len(chunk_lines_list):
        translated_lines = [translate_text(line, target_language) for line in chunk_lines_list]

    return [line.replace(LINE_BREAK_PLACEHOLDER, "\n") for line in translated_lines]


def main():
    if len(sys.argv) != 4:
        raise ValueError("Usage: mogrt_translator.py <input_json_path> <output_json_path> <target_language>")

    input_json_path = sys.argv[1]
    output_json_path = sys.argv[2]
    target_language = sys.argv[3]

    with open(input_json_path, "r", encoding="utf-8") as handle:
        captions = json.load(handle)

    if not isinstance(captions, list):
        raise ValueError("Input JSON must contain an array of caption strings.")

    normalized_lines = [normalize_caption_text(line) for line in captions]
    chunks = chunk_lines(normalized_lines, MAX_CHARS_PER_REQUEST)
    translated_lines = []
    for index, chunk in enumerate(chunks):
        translated_lines.extend(translate_chunk(target_language, chunk))
        if index < len(chunks) - 1:
            time.sleep(1)

    if len(translated_lines) != len(captions):
        raise ValueError(
            "Translated line count mismatch: expected %d, got %d"
            % (len(captions), len(translated_lines))
        )

    with open(output_json_path, "w", encoding="utf-8") as handle:
        json.dump(translated_lines, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        output_path = sys.argv[2] if len(sys.argv) > 2 else None
        if output_path:
            try:
                with open(output_path, "w", encoding="utf-8") as handle:
                    json.dump({"error": str(exc)}, handle, ensure_ascii=False, indent=2)
            except Exception:
                pass
        raise
