#!/bin/bash
# The app's code reader (src/…/Decoder.java) on camera-like frames, on the JVM: no phone needed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CP="$HERE/libs/zxing-core-3.5.3.jar"
javac -nowarn -encoding UTF-8 -classpath "$CP" -d "$WORK" "$HERE/src/com/equiprite/mobile/Decoder.java" "$HERE/test/DecoderTest.java"
java -Dstdout.encoding=UTF-8 -classpath "$CP:$WORK" DecoderTest
