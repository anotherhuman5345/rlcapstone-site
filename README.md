# rlcapstone.ai

Educational website for a series of end-to-end AI capstone projects. Plain static
HTML/CSS — no build step, no framework, no Node toolchain.

## Structure

- `index.html` — project index
- `projects/` — one write-up page per project
- `css/style.css` — single stylesheet, light/dark via `prefers-color-scheme`
- `_headers` — security headers applied by Cloudflare Pages
- `404.html` — served by Cloudflare Pages for unknown paths

## Local preview

Any static file server works, e.g.:

```powershell
python -m http.server 8788
```

## Deployment

Hosted on Cloudflare Pages, connected to this repository. Build settings:

- Build command: *(none)*
- Output directory: `/`

Custom domain: `rlcapstone.ai` (registered and DNS-managed on Cloudflare).

## Disclaimer

All content is educational. Nothing here is medical or professional advice; see
`disclaimer.html`.
