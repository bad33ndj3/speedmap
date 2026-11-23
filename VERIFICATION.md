# Verification

- `node --test tests/*.test.mjs` — passed: two deterministic engine tests, no real speed test traffic.
- `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' 'https://cdn.jsdelivr.net/npm/@cloudflare/speedtest@1.17.0/dist/speedtest.js'` — HTTP 200, JavaScript content type.
- `python3 -m http.server 18765 --bind 127.0.0.1` — served locally.
- Orca browser at 393 × 852 mobile viewport — initial layout inspected; no horizontal overflow detected. Synthetic image upload, adding a spot, reloading, synthetic pointer dragging, mocked result events for both providers, report fallback, quota error preservation, JSON import and export download were checked.
- Not checked: actual iPhone Safari, a real Cloudflare measurement, and a deployed GitHub Pages subpath. Local mobile emulation and relative paths do not prove those cases.
- Design update: Orca browser checked at 393 × 852 and 1440 × 900; no horizontal overflow on mobile. The desktop QR dialog opened and closed, included the local-address warning, and the mobile button was hidden. macOS Vision decoded the rendered QR screenshot to the displayed local address. A physical phone scan and deployed address remain untested.
- `node --test tests/*.test.mjs` — three tests passed, including removal of query strings and fragments from QR addresses.

- Synthetic image and spot: rotation persisted after reload. Comparison showed the selected labels and the expected differences; the mobile table fit without horizontal scrolling.
