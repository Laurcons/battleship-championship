#!/usr/bin/env python3
"""Builds the zip handed to students: bot.cpp, bsc.h, bsc.cpp and CITESTE-MA.txt, with Windows line
endings, ready to unpack into the pre-made Code::Blocks project.

    python3 make-zip.py                                       # writes bsc-cpp.zip next to this file
    python3 make-zip.py --url ws://192.168.1.10:3000/program/v1 --out /tmp/elevi.zip

--url bakes the platform address into bot.cpp (the line `char bsc_url[] = "...";`), so students only
have to paste their token. Without it bot.cpp is shipped as it is in the repository.
"""
import argparse
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ["bot.cpp", "bsc.h", "bsc.cpp", "CITESTE-MA.txt"]
URL_LINE = re.compile(r'^char bsc_url\[\] = "[^"\n]*";', re.MULTILINE)
# A fixed timestamp makes the zip reproducible.
STAMP = (2026, 1, 1, 0, 0, 0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="platform address to bake into bot.cpp, e.g. ws://host:3000/program/v1")
    ap.add_argument("--out", default=str(HERE / "bsc-cpp.zip"))
    args = ap.parse_args()
    if args.url and (not args.url.startswith("ws://") or '"' in args.url or "\\" in args.url):
        print("--url must be a plain ws:// address (the shim has no TLS)", file=sys.stderr)
        return 2

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            raw = (HERE / name).read_bytes()
            bom = raw.startswith(b"\xef\xbb\xbf")
            text = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
            if name == "bot.cpp" and args.url:
                text, n = URL_LINE.subn(lambda _m: f'char bsc_url[] = "{args.url}";', text)
                if n != 1:
                    print("could not find the bsc_url line in bot.cpp", file=sys.stderr)
                    return 1
            data = (b"\xef\xbb\xbf" if bom else b"") + text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
