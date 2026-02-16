# Database Analytics Chatbot (Vanilla SPA)

Single-page web app that sends analytics questions to an n8n webhook.

## Files

- `index.html` - Page structure
- `styles.css` - Responsive styles
- `app.js` - Form validation, fetch logic, fallback handling, rendering, retry/reset/copy

## Webhook URLs

- Primary: `http://localhost:5678/webhook/analytics-chat`
- Fallback: `http://localhost:5678/webhook-test/analytics-chat`

Fallback is used automatically if the primary request fails with:
- network error, or
- non-2xx HTTP response

## Request Payload

```json
{
  "message": "required string",
  "sessionId": "auto-generated each submit",
  "userId": "optional string"
}
```

## Response Handling

- Accepts only flat JSON objects (`key -> primitive/null`)
- Treats non-JSON or nested JSON as errors
- Renders key/value rows and provides copy buttons

## Run Locally

Option 1:
- Open `index.html` in a browser

Option 2 (recommended):

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.
