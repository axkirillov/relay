VERSION ?= dev

.PHONY: build ui test smoke fmt vet clean

build: ui
	go build -ldflags "-X main.version=$(VERSION)" -o relay .

ui:
	cd ui && pnpm install --silent && node build.mjs

test:
	go test ./...

# End-to-end: drives the binary over stdio as an MCP client would.
smoke: build
	bash scripts/smoke.sh

fmt:
	go fmt ./...

vet:
	go vet ./...

clean:
	rm -f relay
