# Pintu (拼图) — Long-Image Stitching Tool: v1 Design

**Date:** 2026-06-10
**Status:** Approved

## Overview

Pintu is an anonymous, one-shot web tool for long-image stitching (长图拼接): users upload screenshots or photos, arrange and trim them, and download a single stitched image. The UI is Chinese. No accounts, no saved projects — images touch the server only during the stitch request and are discarded immediately after.

v1 ships **manual stitching only** (edge-to-edge concatenation with per-image trim). The architecture leaves a clean seam for automatic overlap detection (auto-merging scrolling screenshots) in a later release. Other collage modes (grid, freeform canvas) are future scope, not part of this design.

## Decisions Made

| Decision | Choice |
| --- | --- |
| v1 mode | Long-image stitching, manual trim; auto overlap detection later |
| Processing | Server-side (sharp); client shows preview only |
| Backend | Node.js + Fastify + sharp |
| Frontend | Vue 3 + Vite SPA |
| State model | Anonymous one-shot; no DB, no auth, no persistence |
| Deployment | Single Docker container on user's VPS, behind existing nginx/caddy |
| UI language | Chinese |

## Architecture

Approach: **synchronous API + client-side preview.** The browser builds a live preview from local thumbnails; original files are uploaded only when the user clicks 生成, stitched in a single request, and streamed back.

```
pintu/
├── frontend/          # Vue 3 + Vite SPA (Chinese UI)
│   └── src/
│       ├── components/   # UploadZone, ImageList, ImageCard, TrimControls,
│       │                 # StitchPreview, ExportPanel
│       ├── composables/  # useImages (state), useStitchRequest (API call)
│       └── App.vue       # single-page tool, no router in v1
├── server/            # Node.js + Fastify + sharp
│   └── src/
│       ├── routes/stitch.js   # POST /api/stitch — the one endpoint
│       ├── lib/stitcher.js    # pure stitching logic (sharp pipeline)
│       └── index.js           # serves API + built frontend static files
├── Dockerfile         # multi-stage: build frontend → copy into server image
└── docker-compose.yml # one service
```

Key decisions:

- **Fastify** for built-in multipart support (`@fastify/multipart`), JSON-schema validation, and stream-friendly responses.
- **One container serves everything** — the Node server serves the built SPA and the API. No CORS, one deploy unit.
- **`lib/stitcher.js` is a pure module**: buffers + layout in, output buffer out. It knows nothing about HTTP. Future auto overlap detection plugs in as a `lib/overlap-detector.js` step that adjusts trim values before stitching — no API or frontend redesign needed.
- **Nothing stateful**: uploads are processed within the request and discarded. No database, no Redis, no cleanup jobs.

## Data Flow

### Frontend

1. User drops/selects images → instant local thumbnails via `URL.createObjectURL`. Originals stay in browser memory as `File` objects.
2. User arranges: drag to reorder; per-image trim via drag handles on each image's leading/trailing edges (stored as pixel offsets against natural size).
3. Live preview: trimmed images stacked as CSS-cropped `<img>` elements — pixel-faithful to the output for simple concatenation.
4. Global options: direction (纵向/横向), spacing (px), background/spacing color, output format (PNG/JPG) and JPG quality.
5. 生成长图 → one `multipart/form-data` POST → server streams the image back → browser downloads and displays the result.

### API Contract — `POST /api/stitch`

```
multipart fields:
  images[]: files, in order (order = stitch order)
  layout:   JSON string {
    direction: "vertical" | "horizontal",
    spacing: number,            // px between images, default 0
    background: "#rrggbb",      // spacing/letterbox color, default #ffffff
    items: [{ trimStart: n, trimEnd: n }],  // px cropped from each image's
                                            // leading/trailing edge, by index
    output: { format: "png" | "jpeg", quality: 1-100 }
  }

response: 200 image/png or image/jpeg (Content-Disposition: attachment)
```

### Server Pipeline (`lib/stitcher.js`)

1. Read each image's metadata with sharp; apply `extract` for trims.
2. Vertical: output width = max of trimmed widths; narrower images centered over the background color. **No upscaling** — screenshots stay crisp. Horizontal is the mirror case (output height = max height, vertical centering).
3. Single `sharp.composite()` over a background canvas of the computed size → encode → stream to the response.

### Limits (enforced server-side, mirrored in the UI)

- Max 30 images per request
- 20 MB per file, 200 MB total
- Output dimension cap: 65,000 px on either axis
- Request timeout ~60 s; multipart body limits set to match

## Error Handling

### Client-side (prevent before sending)

- Non-image and oversize files rejected at selection, with Chinese toasts (e.g., "文件过大，单张最大 20MB").
- Trim handles clamped so `trimStart + trimEnd` < image extent — an image can't be trimmed to nothing.
- 生成 disabled until ≥2 images; upload progress bar; clear retry on failure.

### Server-side (defend everything anyway)

- `layout` validated with Fastify JSON schema: unknown fields rejected, numbers range-checked, `items` length must equal file count.
- Corrupt/undecodable image → `422 { error: "INVALID_IMAGE", index: n }` so the UI highlights the offending file.
- Output exceeding the dimension cap → `413` including the computed size.
- Any sharp failure → generic `500`; details go to server logs only. No stack traces or paths leak to clients.
- Multipart limits enforced at the parser via `@fastify/multipart` config, so oversized requests fail early without buffering.

## Testing

- **`lib/stitcher.js` unit tests (vitest)** — test images generated in-test with sharp (small solid-color rectangles); assert output dimensions and sampled pixel colors for: vertical/horizontal stitch, trims, spacing + background color, width normalization/centering, dimension-cap rejection, corrupt-buffer rejection.
- **Route integration tests** — Fastify `inject()` against `POST /api/stitch`: happy path, schema rejections, mismatched `items` length, oversize handling.
- **Frontend** — component tests for trim-clamping and the layout-JSON builder; drag-and-drop verified manually in v1.

## Future Scope (explicitly out of v1)

- Auto overlap detection for scrolling screenshots (plugs into `lib/stitcher.js` seam)
- Grid collage and freeform canvas modes
- i18n beyond Chinese
- Accounts / saved projects (would require revisiting the stateless model)
