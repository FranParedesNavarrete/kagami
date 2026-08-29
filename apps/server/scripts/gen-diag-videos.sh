#!/usr/bin/env bash
# Genera los dos mp4 de prueba del diagnostico de range requests de M1
# (ROADMAP.md, primera tarea de M1). Requiere ffmpeg. Mismo contenido en
# los dos (testsrc2, con su patron en movimiento reconocible a ojo si la
# reproduccion esta congelada o no); la comprobacion exacta de si un
# salto realmente movio la reproduccion la hace la pagina de diagnostico
# leyendo video.currentTime, no un timecode quemado (el build de ffmpeg
# disponible no trae el filtro drawtext/freetype).
#
# faststart.mp4: atomo moov al principio (-movflags +faststart).
# plain.mp4:     moov al final, que es el comportamiento por defecto del
#                muxer mp4 de ffmpeg sin ese flag — sirve para descartar
#                esta causa clasica de que el salto no funcione antes de
#                culpar al servidor (ver docs/spike-range.md).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data/diag-range

gen() {
	local out="$1"
	shift
	ffmpeg -y \
		-f lavfi -i "testsrc2=size=1280x720:rate=30:duration=30" \
		-f lavfi -i "sine=frequency=440:duration=30" \
		-c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -g 30 \
		-c:a aac -b:a 96k \
		"$@" \
		"data/diag-range/$out"
	echo "listo: data/diag-range/$out"
}

gen faststart.mp4 -movflags +faststart
gen plain.mp4

echo
echo "Comprobacion rapida de donde quedo el atomo moov (primeros 200KB):"
# node -e, no `grep -abo`: BusyBox (Alpine, donde corre esto dentro del
# build de Docker) no soporta -a ni -b, solo GNU grep los tiene — node
# ya es parte de la imagen de build, no anade nada nuevo.
for f in faststart plain; do
	node -e '
		const fs = require("node:fs");
		const buf = fs.readFileSync(process.argv[1]).subarray(0, 200000);
		const pos = buf.indexOf("moov");
		if (pos === -1) {
			console.log("  " + process.argv[2] + ".mp4: moov NO esta en los primeros 200KB (al final del fichero, como se espera de \"plain\")");
		} else {
			console.log("  " + process.argv[2] + ".mp4: moov encontrado a ~" + pos + " bytes (dentro de los primeros 200KB)");
		}
	' "data/diag-range/$f.mp4" "$f"
done
