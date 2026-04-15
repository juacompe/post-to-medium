TITLE ?= Hello from Playwright
URL   ?= https://blog.odd-e.com/sudy-dthiim-extraordinary-team/
LIMIT ?=

chrome:
	/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
		--remote-debugging-port=9222 \
		--user-data-dir=/tmp/chrome-debug

post:
	npm run post-title -- "$(TITLE)"

cp:
	npm run cross-post -- "$(URL)" $(LIMIT)

potential-publish:
	npm run potential-publish

publish:
	npm run publish
