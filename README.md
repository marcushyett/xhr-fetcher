# XHR Fetcher

A RESTful API that captures page HTML, XHR/fetch requests, JavaScript files, and network resources using a headless browser (Playwright).

## Features

- Captures full page HTML after JavaScript execution
- Records all XHR and fetch requests with headers and response bodies
- Captures JavaScript files and their content
- Records stylesheets and sub-documents
- Collects cookies, console messages, and page errors
- Supports custom wait conditions (selectors, timeouts)
- Optional API key authentication
- **API Detection** (`/analyze`): Intelligently detects data sources:
  - JSON/GraphQL/XML APIs with schema inference
  - Next.js and Nuxt.js embedded data extraction
  - Automatic analytics/tracking filtering

## Authentication

The API supports optional API key authentication. If the `API_KEY` environment variable is set, all requests (except `/health`) require authentication.

**Providing the API key:**

```bash
# Using Authorization header (Bearer token)
curl -H "Authorization: Bearer your-api-key" \
  "https://your-app.fly.dev/fetch?url=https://example.com"

# Using x-api-key header
curl -H "x-api-key: your-api-key" \
  "https://your-app.fly.dev/fetch?url=https://example.com"
```

**Behavior:**
- If `API_KEY` is not set: All requests are allowed (open access)
- If `API_KEY` is set: Requests without a valid key receive `401 Unauthorized`
- The `/health` endpoint is always accessible (for load balancer checks)

## API Endpoints

### POST /fetch

Fetch a URL and capture all network activity.

**Request Body:**
```json
{
  "url": "https://example.com",
  "waitUntil": "networkidle",
  "timeout": 60000,
  "networkIdleTimeout": 10000,
  "waitForSelector": "#content",
  "additionalWaitMs": 2000
}
```

**Parameters:**
- `url` (required): The URL to fetch
- `waitUntil` (optional): When to consider navigation complete. Options: `load`, `domcontentloaded`, `networkidle` (default)
- `timeout` (optional): Maximum overall time to wait in ms (default: 60000, max: 360000)
- `networkIdleTimeout` (optional): Time to wait for network idle before falling back (default: 10000, max: 360000). If the page doesn't reach network idle within this time, the API will continue with whatever has loaded. This is useful for pages with continuous network activity (analytics, websockets, etc.)
- `waitForSelector` (optional): CSS selector to wait for before returning
- `additionalWaitMs` (optional): Extra time to wait after page load (default: 0)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "loadTimeMs": 1234,
  "networkIdleReached": true,
  "html": "<!DOCTYPE html>...",
  "title": "Example Domain",
  "xhrRequests": [...],
  "scripts": [...],
  "stylesheets": [...],
  "documents": [...],
  "allNetworkRequests": [...],
  "cookies": [...],
  "console": [...],
  "errors": [...]
}
```

The `networkIdleReached` field indicates whether the page reached network idle state or if the API fell back after the timeout.

### GET /fetch?url=...

Simple GET endpoint for quick testing. Supports all parameters as query strings:

```
/fetch?url=https://example.com&networkIdleTimeout=30000&timeout=120000
```

**Query Parameters:**
- `url` (required): The URL to fetch
- `networkIdleTimeout` (optional): Network idle timeout in ms (default: 10000, max: 360000)
- `timeout` (optional): Overall timeout in ms (default: 60000, max: 360000)
- `waitUntil` (optional): `load`, `domcontentloaded`, or `networkidle`
- `waitForSelector` (optional): CSS selector to wait for
- `additionalWaitMs` (optional): Extra wait time in ms

### POST /analyze

Intelligently analyze a page to detect how it fetches data. Filters out analytics/tracking and identifies the primary data source.

**Request Body:**
```json
{
  "url": "https://example.com",
  "timeout": 60000,
  "networkIdleTimeout": 10000
}
```

**Parameters:**
- `url` (required): The URL to analyze
- `timeout` (optional): Maximum time in ms (default: 60000)
- `networkIdleTimeout` (optional): Network idle timeout in ms (default: 10000)
- `waitForSelector` (optional): CSS selector to wait for
- `additionalWaitMs` (optional): Extra wait time in ms

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/products",
  "finalUrl": "https://example.com/products",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "loadTimeMs": 3500,
  "networkIdleReached": true,

  "primaryDataSource": "json-api",
  "confidence": "high",

  "detectedAPIs": [
    {
      "url": "https://api.example.com/v1/products",
      "method": "GET",
      "category": "json-api",
      "schema": {
        "type": "object",
        "properties": {
          "products": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "integer" },
                "name": { "type": "string" }
              }
            }
          }
        }
      },
      "sample": {
        "products": [{ "id": 1, "name": "Widget" }]
      },
      "responseHeaders": { "content-type": "application/json" },
      "requestHeaders": { ... }
    }
  ],

  "embeddedData": null,
  "title": "Products"
}
```

**Data Source Categories:**
| Category | Description |
|----------|-------------|
| `json-api` | Standard JSON REST APIs |
| `graphql` | GraphQL endpoints |
| `xml-api` | XML/SOAP APIs (converted to JSON) |
| `html-api` | HTML fragment APIs (XHR returning HTML) |
| `nextjs-embedded` | Next.js `__NEXT_DATA__` embedded JSON |
| `nuxt-embedded` | Nuxt.js `__NUXT__` embedded data |
| `ssr-only` | Server-side rendered only (no client APIs) |

**Notes:**
- Analytics/tracking requests are automatically filtered out
- XML responses are converted to JSON
- HTML is only included in response for `ssr-only` pages
- JSON Schema is generated for each detected API

### GET /analyze?url=...

GET version of the analyze endpoint:

```
/analyze?url=https://example.com&networkIdleTimeout=15000
```

### GET /health

Health check endpoint.

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Start development server (non-headless browser)
npm run dev
```

The server runs on `http://localhost:3000` by default.

### Testing

```bash
# Using curl
curl -X POST http://localhost:3000/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Or use GET for quick tests
curl "http://localhost:3000/fetch?url=https://example.com"
```

## Deployment to Fly.io

### Prerequisites

1. Install the [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
2. Create a Fly.io account and login: `flyctl auth login`

### Initial Setup

```bash
# Create the app (only needed once)
flyctl apps create xhr-fetcher

# Set an API key for authentication (recommended)
flyctl secrets set API_KEY=your-secret-api-key

# Deploy the app
flyctl deploy
```

Without setting `API_KEY`, the API will be open to anyone. See [Authentication](#authentication) for details.

### GitHub Actions Deployment

The repository includes GitHub Actions for automatic deployment:

1. Get your Fly.io API token:
   ```bash
   flyctl tokens create deploy -x 999999h
   ```

2. Add the token to your GitHub repository secrets:
   - Go to Settings → Secrets and variables → Actions
   - Add `FLY_API_TOKEN` with your token value

3. Push to `main` branch to trigger deployment

### Configuration

The `fly.toml` is configured with:
- **Auto-scaling**: Scales to zero when idle, auto-starts on requests
- **Memory**: 1GB RAM (needed for Chromium)
- **Timeout**: 5 minutes for long-running requests
- **Region**: `iad` (US East) - change as needed

### Update fly.toml

Before deploying, update the `app` name in `fly.toml` to your unique app name:

```toml
app = "your-unique-app-name"
```

## Docker

Build and run locally with Docker:

```bash
# Build
docker build -t xhr-fetcher .

# Run
docker run -p 3000:8080 xhr-fetcher
```

## Architecture

- **Express.js**: HTTP server
- **Playwright**: Headless browser automation
- **TypeScript**: Type safety
- **Zod**: Request validation

The browser is kept running between requests for performance. On Fly.io, machines scale to zero after idle timeout and start fresh on new requests.
