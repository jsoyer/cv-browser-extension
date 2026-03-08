# cv-browser-extension

A Manifest V3 Chrome/Firefox browser extension for the CV management pipeline.
Detects job postings on LinkedIn, Indeed, and Welcome to the Jungle, then triggers
the full tailoring pipeline via [cv-api](https://github.com/jsoyer/cv-api) with a
single click.

## Features

- Detects job pages on LinkedIn, Indeed, and Welcome to the Jungle
- Injects an "Add to CV Pipeline" button near the Apply button
- Extracts company, position, and job description from the DOM
- Sends data to cv-api: creates the application, uploads the job description,
  and triggers the `tailor` Make target
- Popup showing recent applications and connection status
- Badge count showing active (applied) applications
- Follow-up reminders via browser notifications
- Options page for API URL, API key, and preferences

## Tech stack

- Manifest V3 (Chrome + Firefox compatible)
- TypeScript (strict mode)
- React 18 for popup and options pages
- Tailwind CSS v4
- Vite + `@vitejs/plugin-react`
- Vitest for testing

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env.local` if needed (settings are stored in
`chrome.storage.sync`, not env vars at runtime).

## Development

```bash
pnpm dev          # Watch mode — rebuilds on file change
```

Load the `dist/` directory as an unpacked extension in `chrome://extensions`
with Developer Mode enabled.

## Build

```bash
pnpm build        # Typecheck + build
pnpm build:only   # Skip typecheck (CI splits them)
```

## Testing

```bash
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:coverage     # With v8 coverage report
```

## Configuration

Open the extension options page (right-click the icon > Options) and set:

| Setting | Description |
|---|---|
| cv-api URL | Base URL of your cv-api instance (e.g. `http://localhost:8080`) |
| API Key | Value of the `X-API-Key` header configured in cv-api |
| Badge count | Show number of active applications on the icon |
| Follow-up notifications | Notify after 7 days of no updates |

## Supported sites

| Site | URL pattern |
|---|---|
| LinkedIn | `linkedin.com/jobs/view/*` |
| Indeed | `indeed.com/viewjob*`, `indeed.com/rc/clk*` |
| Welcome to the Jungle | `welcometothejungle.com/*/companies/*/jobs/*` |

## Directory structure

```
src/
  background/       # Manifest V3 service worker
  content/          # Content scripts (detector, extractor, injector)
  popup/            # React popup UI
  options/          # React options page
  lib/              # Shared types, API client, storage helpers, constants
  styles/           # Global CSS (Tailwind)
  manifest.json
tests/
  detector.test.ts
  extractor.test.ts
```

## License

MIT
