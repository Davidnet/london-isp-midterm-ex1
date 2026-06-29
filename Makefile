# Build a self-contained, deployable copy of the site into output/.
# Static p5.js app, no bundler: we copy only the files the app actually loads
# and rewrite index.html to use the minified libraries.
#
#   make          # build output/
#   make serve    # build + serve over http (loadSound/loadFont need http)
#   make clean    # remove output/

OUT := output

# Minified libraries (already vendored alongside the non-min sources).
LIBS := \
	libraries/p5/p5.min.js \
	libraries/p5/addons/p5.sound.min.js

# The 7 font files the app loads in src/sketch.js, plus the OFL licenses
# (required when redistributing OFL fonts).
FONTS := \
	fonts/hanken-grotesk/HankenGrotesk-Regular.ttf \
	fonts/hanken-grotesk/HankenGrotesk-SemiBold.ttf \
	fonts/hanken-grotesk/HankenGrotesk-Bold.ttf \
	fonts/hanken-grotesk/HankenGrotesk-ExtraBold.ttf \
	fonts/hanken-grotesk/OFL.txt \
	fonts/spline-sans-mono/SplineSansMono-Regular.ttf \
	fonts/spline-sans-mono/SplineSansMono-Medium.ttf \
	fonts/spline-sans-mono/SplineSansMono-SemiBold.ttf \
	fonts/spline-sans-mono/OFL.txt

# Audio samples loaded in preload() (sample1..sample6). demo.wav and list.json
# are not referenced anywhere in src/, so they are intentionally omitted.
ASSETS := \
	assets/sample1.wav \
	assets/sample2.wav \
	assets/sample3.wav \
	assets/sample4.wav \
	assets/sample5.wav \
	assets/sample6.wav

# Application source (copied verbatim).
SRC := $(shell find src -type f -name '*.js')

.PHONY: build serve clean

build: clean
	@echo ">> building $(OUT)/"
	@for f in $(LIBS) $(FONTS) $(ASSETS) $(SRC); do \
		mkdir -p "$(OUT)/$$(dirname $$f)"; \
		cp "$$f" "$(OUT)/$$f"; \
	done
	@# Copy index.html, rewriting the two library <script> tags to the min builds.
	@sed \
		-e 's#libraries/p5/p5.js#libraries/p5/p5.min.js#' \
		-e 's#libraries/p5/addons/p5.sound.js#libraries/p5/addons/p5.sound.min.js#' \
		index.html > "$(OUT)/index.html"
	@echo ">> done. $(OUT)/ size: $$(du -sh $(OUT) | cut -f1)"

serve: build
	@cd $(OUT) && python3 -m http.server

clean:
	@rm -rf $(OUT)
