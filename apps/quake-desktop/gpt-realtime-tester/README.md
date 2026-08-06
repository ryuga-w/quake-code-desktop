# Azure Realtime Voice Lab

Local-only browser lab for validating an Azure GPT Realtime deployment before
embedding it in QuakeCode. The browser never receives the Azure API key; this
Node server holds it and proxies the authenticated upstream WebSocket.

## Run it

1. Rotate any key that was ever written to a file, prototype, or chat.
2. Copy `.env.example` to `.env.local`.
3. Set the endpoint, deployment name, and the newly rotated key in `.env.local`.
4. Run `npm run realtime:lab` from the repository root.
5. Open `http://127.0.0.1:3001` and allow microphone access.

`AZURE_REALTIME_API_MODE=v1` is the current Azure OpenAI v1 route. If a
deployment still requires the old preview transport, set `legacy` and supply
the matching API version. The page shows Azure's returned error without ever
printing the API key.

## What this lab covers

- microphone capture with `AudioWorklet` and PCM16/24 kHz conversion;
- server VAD, live user/assistant transcripts, playback, interrupt, and text
  prompts;
- a localhost-only WebSocket proxy with bounded message sizes;
- no raw audio persistence and no API key field in the browser.

It is deliberately isolated from QuakeCode's tools and approval flow. Once
the connection is stable, the same gateway and Voice Dock UX can be embedded
in the desktop app.

Official Azure references:

- [Realtime overview](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio)
- [WebSocket transport](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets)
- [WebRTC transport](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc)
