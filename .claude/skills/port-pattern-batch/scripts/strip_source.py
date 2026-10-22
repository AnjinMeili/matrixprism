#!/usr/bin/env python3
"""Print C, C++ or Arduino source compactly, for reading before a port.

Usage:
  strip_source.py FILE [FILE ...]            whole files
  strip_source.py FILE --functions a,b,c     only the named functions
  strip_source.py FILE --list                names and sizes of its functions
  strip_source.py FILE --cases N,M --in fn   the `case N:` blocks inside fn

Removes comments, blank lines and Serial debugging calls, and halves the
indentation, which cuts a typical sketch to about half its size without
losing any code. Long lines are kept whole: truncating them hides the
arithmetic that a port has to reproduce.
"""
import re
import sys

FUNCTION = re.compile(
    r"^(?:static\s+|inline\s+)*(?:void|bool|boolean|int\w*|uint\w*|float|double|byte|CRGB|CHSV|Point|unsigned\s+\w+)"
    r"\s+\**(\w+)\s*\([^;]*\)\s*(?:\{.*|//.*)?$")


def clean(lines):
    text = re.sub(r"/\*.*?\*/", "", "\n".join(lines), flags=re.S)
    out = []
    for line in text.split("\n"):
        line = re.sub(r"\s*//.*$", "", line)
        # Drop the debugging call but keep the rest of the line: a brace or
        # an `else` sharing the line with Serial.print changes the logic.
        line = re.sub(r"Serial\.\w+\s*\([^;]*\)\s*;", "", line).rstrip()
        if not line.strip():
            continue
        out.append(re.sub(r"^\s+", lambda m: " " * (len(m.group(0)) // 2), line))
    return out


def functions(lines):
    """Top-level functions as {name: (first line index, end index)}."""
    starts = [(i, FUNCTION.match(line).group(1)) for i, line in enumerate(lines)
              if not line.startswith((" ", "\t")) and FUNCTION.match(line)]
    return {name: (start, starts[n + 1][0] if n + 1 < len(starts) else len(lines))
            for n, (start, name) in enumerate(starts)}


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    def option(flag):
        return args[args.index(flag) + 1] if flag in args else None

    files = [a for i, a in enumerate(args)
             if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--functions", "--cases", "--in"))]
    for path in files:
        with open(path, errors="replace") as handle:
            lines = handle.read().split("\n")
        index = functions(lines)
        if "--list" in args:
            for name, (start, end) in sorted(index.items(), key=lambda item: item[1]):
                print(f"{start + 1:>6}  {len(clean(lines[start:end])):>4} lines  {name}")
            continue
        if option("--cases"):
            start, end = index[option("--in")]
            wanted, current, blocks = set(option("--cases").split(",")), None, {}
            for line in lines[start:end]:
                match = re.match(r"\s*case\s+(\w+)\s*:", line)
                if match:
                    current = match.group(1)
                if current in wanted:
                    blocks.setdefault(current, []).append(line)
            for label in option("--cases").split(","):
                print(f"/* case {label} in {option('--in')} */")
                print("\n".join(clean(blocks.get(label, ["  // not found"]))))
            continue
        if option("--functions"):
            for name in option("--functions").split(","):
                if name not in index:
                    print(f"/* {name}: not found in {path} */")
                    continue
                start, end = index[name]
                print(f"/* {name} ({path}:{start + 1}) */")
                print("\n".join(clean(lines[start:end])))
            continue
        body = clean(lines)
        print(f"/* {path}: {len(body)} lines */")
        print("\n".join(body))


if __name__ == "__main__":
    main()
