# GestAI

GestAI is a human-to-human conversational platform. A person creates an identity, another person opens a conversation with it, and the identity's owner (or an assigned operator) writes every reply manually. There is no automatic generative-AI reply.

## Included in this repository

### Client
- Email/password registration and login.
- Private conversations and a directory of public identities.
- Real-time message delivery through Cloudflare Durable Objects and WebSockets.
- Image, video, audio and document attachments stored privately in R2.
- Audio transcription through the optional Cloudflare Workers AI Whisper binding.
- Conversation list, message history and responsive mobile layout.

### Identity owner / operator
- Create public or private identities.
- Configure description, operator instructions and a context-capacity setting.
- Minimum configured context capacity: 100,000 tokens; selectable settings up to 2,000,000.
- Operator inbox for conversations assigned to the identity owner.
- Human-written replies and context handoff to another registered operator.
- Handoff snapshot includes the latest 100 messages and a seven-minute review deadline.

### Backend
- PBKDF2 password hashing and hashed bearer-session storage.
- Short-lived, one-use WebSocket tickets (session tokens are not put in socket URLs).
- D1 schema for users, sessions, identities, conversations, messages, handoffs and socket tickets.
- R2 objects are served only after conversation membership is checked.
- Upload size limit defaults to 25 MiB.

## Cloudflare deployment

The app is served by one Worker with static assets, so the frontend and API share the same origin.

1. Install Node.js 20+ and authenticate Wrangler:

   ```sh
   npm install
   npx wrangler login
   ```

2. Create the D1 database and R2 bucket:

   ```sh
   npx wrangler d1 create gestai-db
   npx wrangler r2 bucket create gestai-uploads
   ```

3. Copy the D1 `database_id` printed by Wrangler into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

4. Create the schema locally for development, or remotely for production:

   ```sh
   npm run db:init
   npm run db:remote
   ```

   Run the remote command only after the D1 database ID has been configured.

5. Build and deploy:

   ```sh
   npm install
   npm run build
   npm run cf:deploy
   ```

6. Open the `*.workers.dev` URL printed by Wrangler and register an account. Register as an operator if you want an operator role, or create an identity as a client account owner.

### Audio transcription

The Worker uses the Cloudflare Workers AI binding and the `@cf/openai/whisper` model. Enable Workers AI for the Cloudflare account and keep the `[ai]` binding in `wrangler.toml`. Audio files can then be transcribed into the message composer before sending. The transcript is editable by the user.

### Local development

The frontend can be previewed with Vite:

```sh
npm install
npm run dev
```

For API, D1, R2 and Durable Object development, use Wrangler after configuring the bindings:

```sh
npm run cf:dev
```

## Product and privacy notes

- GestAI must always disclose that the counterpart is a human operator.
- Handoff shares conversation history with another operator. Make that clear to the participants and obtain any consent required by your use case before transferring private content.
- Files are private to conversation participants. Configure retention and deletion policies before inviting real users.
- The context-capacity number is a product setting, not a live token counter or a promise that a person can absorb that many tokens. Humans review conversation history directly.
- The seven-minute handoff value is a review deadline, not a guarantee that a person can learn every detail in that time.
- This repository is an operational MVP foundation, not a finished commercial SaaS: payments, paid plan enforcement, email verification, password reset, account deletion, abuse reporting, moderation, rate limiting, operator scheduling/presence, and production observability still need to be added before a public launch.
