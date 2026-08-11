VERSION ?= dev

.PHONY: build test smoke fmt vet clean

build:
	go build -ldflags "-X main.version=$(VERSION)" -o relay .

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
