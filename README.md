# GestAI

GestAI is a human-operated conversational simulation: one person uses the client interface, while another person plays the assistant role from an operator console.

> **Transparency first:** GestAI is staffed by people, not an autonomous AI service. Participants must be told that responses are written by human operators.

## Prototype 0.1

- Responsive dark chat interface.
- Client-side demonstration conversation.
- Switchable operator console and incoming-message queue.
- Human-written operator replies.
- Operator availability toggle and simulated 502 state.
- Visual handoff state with a seven-minute preparation concept.
- Session details panel with a clearly labelled conceptual 100k context setting.

The prototype currently runs in one browser and shares state between the two demo panels. It does not yet provide accounts, real-time multi-user transport, persistent storage, actual uploads, transcription, video processing, or a real token counter.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: Vite

## Planned architecture

- Cloudflare Pages: frontend hosting.
- Cloudflare Workers: authenticated API and session orchestration.
- Durable Objects: live conversation coordination and operator presence.
- D1: users, identities, conversations, messages, plans and audit events.
- R2: uploaded media and documents with access-controlled URLs.

## Product rules

- Clearly disclose that the counterpart is a human operator.
- Obtain consent before transferring conversation history or attachments to a replacement operator.
- Keep private files access-controlled and define retention/deletion controls.
- Distinguish configured context capacity from actual token counts and provider limits.
