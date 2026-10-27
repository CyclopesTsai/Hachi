Self-signed certificate for `localhost` / `127.0.0.1`, used only by the HTTP client
unit tests to exercise TLS verification. The private key is a throwaway test key —
it protects nothing. Regenerate with:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout localhost-key.pem \
      -out localhost-cert.pem -days 36500 -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

`chain-root.pem` → `chain-intermediate.pem` → `chain-leaf.pem` (+ `chain-leaf-key.pem`) is a
throwaway three-level chain for the TLS diagnosis tests (decision 132): the intermediate and
leaf carry AIA "CA Issuers" URLs on `ca.hachi.test`. Only the leaf key is kept.

`sct-leaf.pem` is github.com's public certificate (issued 2026-09-01, ECDSA P-256), kept
only because it embeds two Certificate Transparency SCTs; the SCT parsing tests read it
(decision 142). No key goes with it.

`ccadb/*.csv` are 12-row excerpts of CCADB's public TLS reports (Apple, Chrome, Microsoft,
Mozilla; downloaded 2026-10-22 from `https://ccadb.my.salesforce-sites.com/ccadb/Report?Name=<Program>TLSServerAuthenticationCSV`)
for the CCADB parser and root program tests (issue #7): they include TWCA CYBER Root CA
(not in Apple's list) and roots with each program's limits.

`mtls/` holds throwaway certificates for the client certificate (mTLS) tests (decision 147):
a test CA (`ca.pem`) with a server certificate for `localhost` / `127.0.0.1` and a client
certificate (PEM key, the key encrypted with `secret`, `client.p12` with AES and
`client-legacy.p12` with RC2-40 / 3DES, both with the passphrase `secret`), plus `stranger.pem`
from another CA (`other-ca.pem`). System Node's OpenSSL 3 cannot read the legacy `.p12`
(Electron's BoringSSL can): only the E2E test uses it. Regenerate with `sh make.sh` in that
folder; the CA keys are deleted afterwards.
