#!/usr/bin/env python3
"""解析 APK 内 DEX 字符串池并检索（不依赖 Java / 不执行 APK）。

用法:
  python3 scripts/dexstrings.py <apk|dex> [--grep PAT ...] [-i] [--dump OUT.txt]
                                  [--limit N] [--out DIR]
"""
import argparse
import os
import re
import struct
import sys
import zipfile


def uleb128(data, off):
    result = 0
    shift = 0
    while True:
        b = data[off]
        off += 1
        result |= (b & 0x7F) << shift
        if b < 0x80:
            return result, off
        shift += 7


def decode_mutf8(raw):
    # MUTF-8：U+0000 写作 C0 80，增补平面用代理对（CESU-8）
    b = raw.replace(b"\xc0\x80", b"\x00")
    try:
        return b.decode("utf-8", "surrogatepass")
    except UnicodeDecodeError:
        return b.decode("utf-8", "replace")


def dex_strings(data, name):
    if data[:4] != b"dex\n":
        raise ValueError(f"{name}: 不是 DEX")
    size, off = struct.unpack_from("<II", data, 0x38)
    out = []
    for i in range(size):
        s_off = struct.unpack_from("<I", data, off + 4 * i)[0]
        ln, p = uleb128(data, s_off)
        out.append(decode_mutf8(data[p:p + ln]))
    return out


def load(container):
    if zipfile.is_zipfile(container):
        zf = zipfile.ZipFile(container)
        names = sorted(n for n in zf.namelist() if n.endswith(".dex"))
        for n in names:
            yield n, dex_strings(zf.read(n), n)
    else:
        with open(container, "rb") as fh:
            yield os.path.basename(container), dex_strings(fh.read(), container)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("container")
    ap.add_argument("--grep", action="append", default=[], help="正则，可重复")
    ap.add_argument("-i", "--ignore-case", action="store_true")
    ap.add_argument("--dump", metavar="OUT", help="落盘全部字符串（每行一条）")
    ap.add_argument("--limit", type=int, default=200, help="每个模式最多打印条数")
    ap.add_argument("--out", metavar="DIR", help="证据输出目录")
    args = ap.parse_args()

    flags = re.IGNORECASE if args.ignore_case else 0
    patterns = [re.compile(p, flags) for p in args.grep]
    dump_lines = []
    total = 0
    for name, strings in load(args.container):
        total += len(strings)
        print(f"[dex] {name}: {len(strings)} strings")
        if args.dump:
            dump_lines.extend(strings)
        for pat in patterns:
            hits = [s for s in strings if pat.search(s)]
            print(f"[{pat.pattern}] {name}: {len(hits)} hits")
            for s in hits[: args.limit]:
                print("   ", s.replace("\n", "\\n")[:300])
    print(f"[total] {total} strings")
    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as fh:
            fh.write("\n".join(dump_lines))
        print(f"[dump] {args.dump}")


if __name__ == "__main__":
    sys.exit(main())
