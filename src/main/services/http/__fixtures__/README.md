Self-signed certificate for `localhost` / `127.0.0.1`, used only by the HTTP client
unit tests to exercise TLS verification. The private key is a throwaway test key —
it protects nothing. Regenerate with:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout localhost-key.pem \
      -out localhost-cert.pem -days 36500 -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

`chain-root.pem` → `chain-intermediate.pem` → `chain-leaf.pem` (+ `chain-leaf-key.pem`) is a
throwaway three-level chain for the TLS diagnosis tests (decision 132): the intermediate and
leaf carry AIA "CA Issuers" URLs on `ca.hachi.test`. Only the leaf key is kept.
