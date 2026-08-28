#!/usr/bin/env bash
# Genera el mp4 de prueba para el test de range requests + autoplay del
# spike M-1. Requiere ffmpeg. H.264 baseline (compatible de sobra con un
# decodificador de tele) + AAC, faststart para que el seek no exija
# descargar el fichero entero.
set -euo pipefail
cd "$(dirname "$0")/.."

ffmpeg -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -g 30 \
  -c:a aac -b:a 96k -movflags +faststart \
  public/test-video.mp4

echo "listo: public/test-video.mp4"
