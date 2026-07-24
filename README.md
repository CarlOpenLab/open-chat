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

Copy `apps/server/config/providers.example.toml` to `apps/server/config/providers.toml`, then configure each upstream provider:

```toml
[[providers]]
name = "openrouter"
base_url = "https://openrouter.ai/api/v1"
api_key = "replace-with-your-key"
api = "chat/completions"

[[providers.models]]
id = "openai/gpt-4o-mini"
name = "GPT-4o Mini"
```

`api` controls the upstream protocol and supports `"chat/completions"` (the default) or `"responses"`. The gateway normalizes both protocols behind its public `/api/chat/completions` endpoint.

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

Chat completion endpoint compatible with OpenAI API format.

**Request Body:**

```json
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true,
  "model": "gpt-3.5-turbo",
  "temperature": 0.7
}
```

**Response:**

- Streaming: `text/event-stream` with SSE format
- Non-streaming: JSON response

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
