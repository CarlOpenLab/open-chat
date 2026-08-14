# Open Chat

A ChatGPT-like application with frontend-backend separation using Vue 3 and Express.js, powered by `@antdv-next/x-sdk`.

## Project Structure

```
open-chat/
├── apps/
│   ├── website/          # Vue 3 frontend application
│   │   ├── src/
│   │   │   ├── App.vue   # Main chat UI component
│   │   │   ├── main.ts   # Application entry point
│   │   │   └── style.css # Global styles
│   │   └── vite.config.ts
│   └── server/           # Express.js backend server
│       ├── src/
│       │   └── index.ts  # Server entry point
│       └── .env          # Environment configuration
└── packages/
    └── utils/
```

## Features

- 🎨 Modern chat UI with gradient design
- 💬 Real-time streaming responses
- 🔄 Auto-scroll to latest messages
- ⌨️ Enter to send messages
- 🎯 Loading indicators
- ❌ Error handling

## Setup

### 1. Install Dependencies

```bash
vp install
```

### 2. Configure Providers

Copy `apps/server/config/providers.example.toml` to `apps/server/config/providers.toml` (gateway settings only):

```toml
bind_addr = "127.0.0.1:8082"
cors_allowed_origins = ["http://localhost:3000"]
```

Providers (baseUrl / apiKey / models) are **not** configured on the server — it is a stateless proxy. Open the settings UI in the app (设置 → 模型服务) and add them there; they are stored in the browser (IndexedDB). Each chat request carries the forwarding target in its body, so the server never stores API keys. The only server-side secret is the optional Tavily key for web search (below).

### 3. Development

Run both frontend and backend servers:

```bash
vp dev
```

Or run them separately:

```bash
# Backend server only
vp run dev:server

# Frontend only
vp run dev:website
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Health check: http://localhost:3001/health

## API Endpoints

### POST /api/chat/completions

Chat endpoint — a **stateless proxy**: the request body carries the forwarding target (`provider: { baseUrl, apiKey, api }`), the server forwards it verbatim to `{baseUrl}/{api}` and pipes the upstream response (status, headers, body) back unchanged. When the request declares a `web_search` tool and a search provider is configured, the server runs the search agent loop instead: it intercepts the tool call, queries Tavily, and feeds results back to the model (emitting `event: web_search` SSE frames for the Sources UI).

**Request Body:**

```json
{
  "provider": {
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "sk-...",
    "api": "chat/completions"
  },
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true,
  "model": "gpt-3.5-turbo",
  "temperature": 0.7
}
```

**Response:**

- Streaming: `text/event-stream` with SSE format (upstream frames pass through)
- Non-streaming: JSON response
- Upstream 4xx/5xx errors are returned as-is, so clients see the upstream's real error

### GET /api/models

Returns only `{ search: { enabled, provider } }` — providers/models live in the browser (IndexedDB), not on the server.

## Technology Stack

### Frontend

- Vue 3 (Composition API)
- Vite
- `@antdv-next/x-sdk` - SDK for AI chat requests

### Backend

- Express.js
- CORS
- dotenv for environment variables

### SDK

- `@antdv-next/x-sdk` - Provides `OpenAIChatProvider`, `XRequest`, and `useXChat` for seamless chat integration

## Build

```bash
# Build frontend
vp run website#build

# Build backend
vp run server#build
```

## Production

1. Set your API key in `apps/server/.env`
2. Build both applications
3. Start the backend server:
   ```bash
   cd apps/server
   node dist/index.js
   ```
4. Serve the frontend from `apps/website/dist`

## Customization

### Change AI Model

Edit `apps/website/src/App.vue`:

```typescript
const provider = new OpenAIChatProvider<ChatMessage>({
  request: XRequest("/api/chat/completions", {
    params: {
      model: "gpt-4", // Change model here
      temperature: 0.7,
      stream: true,
    },
    streamTimeout: 60000,
  }),
});
```

### Change Theme

Edit the gradient colors in `apps/website/src/App.vue` styles.

## License

MIT
