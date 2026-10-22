#!/usr/bin/env python3
"""Survey licence notices in a downloaded source tree, file by file.

Usage: licence_survey.py DIRECTORY [--ext .h,.cpp,.ino,.c]

Prints one line per source file: its size, whether it carries the MIT
permission text or another recognisable licence marker, and its first
copyright line. Ends with the files that carry no notice at all, which are
the ones that must not be ported without permission.
"""
import os
import re
import sys

MARKERS = [
    ("MIT", r"Permission is hereby granted, free of charge"),
    ("GPL", r"GNU General Public License"),
    ("LGPL", r"GNU Lesser General Public License"),
    ("Apache", r"Apache License"),
    ("BSD", r"Redistribution and use in source and binary forms"),
    ("SPDX", r"SPDX-License-Identifier:\s*\S+"),
    ("public domain", r"public domain"),
]


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = sys.argv[1]
    extensions = (".h", ".hpp", ".cpp", ".ino", ".c", ".cc")
    if "--ext" in sys.argv:
        extensions = tuple(sys.argv[sys.argv.index("--ext") + 1].split(","))
    bare = []
    for directory, _, names in sorted(os.walk(root)):
        for name in sorted(names):
            if not name.endswith(extensions):
                continue
            path = os.path.join(directory, name)
            with open(path, errors="replace") as handle:
                text = handle.read()
            found = [label for label, pattern in MARKERS if re.search(pattern, text, re.I)]
            copyright_line = re.search(r"^.*copyright.*$", text, re.I | re.M)
            owner = re.sub(r"^[\s/*#-]+", "", copyright_line.group(0)).strip()[:70] if copyright_line else ""
            relative = os.path.relpath(path, root)
            print(f"{relative:<56} {len(text):>7}  {'+'.join(found) or 'NONE':<10} {owner}")
            if not found:
                bare.append(relative)
    print(f"\n{len(bare)} file(s) with no licence notice:")
    for relative in bare:
        print(f"  {relative}")


if __name__ == "__main__":
    main()
