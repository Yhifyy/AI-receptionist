# VoiceDesk AI - MVP Test Plan

## Goal
Validate the core restaurant booking flow:
1. Inbound call
2. AI greets caller
3. AI understands booking intent
4. AI collects name, time, number of guests
5. Booking is saved to database
6. Confirmation is spoken

## Prerequisites

### 1. Required Accounts (get API keys)

| Service | Sign up | What you need |
|---------|---------|---------------|
| **Twilio** | https://console.twilio.com | Account SID, Auth Token, Phone Number |
| **Deepgram** | https://console.deepgram.com | API Key |
| **ElevenLabs** | https://elevenlabs.io | API Key |
| **OpenAI** | https://platform.openai.com | API Key |
| **ngrok** | https://ngrok.com | Free account + auth token |

### 2. Required Software
- Node.js 20+
- pnpm 8+
- Docker Desktop (for PostgreSQL + Redis)
- ngrok CLI

---

## Setup Steps

### Step 1: Install Dependencies

```bash
# From project root
pnpm install
```

### Step 2: Start Database Services

```bash
docker-compose -f docker-compose.mvp.yml up -d
```

Verify they're running:
```bash
docker ps
# Should see: voicedesk-postgres, voicedesk-redis
```

### Step 3: Configure Environment

```bash
# Copy the MVP env template
copy .env.mvp .env

# Edit .env and fill in your API keys:
# - TWILIO_ACCOUNT_SID
# - TWILIO_AUTH_TOKEN
# - TWILIO_PHONE_NUMBER
# - DEEPGRAM_API_KEY
# - ELEVENLABS_API_KEY
# - OPENAI_API_KEY
```

### Step 4: Setup Database

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Seed MVP demo data
pnpm --filter @voicedesk/database db:seed-mvp
```

### Step 5: Start ngrok Tunnel

Open a new terminal:
```bash
ngrok http 3001
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

Update your `.env`:
```bash
API_URL="https://abc123.ngrok-free.app"
```

### Step 6: Configure Twilio Webhooks

1. Go to https://console.twilio.com/phone-numbers
2. Click your phone number
3. Under "Voice Configuration":
   - **A call comes in:** Webhook
   - **URL:** `https://YOUR_NGROK_URL/api/calls/incoming`
   - **HTTP Method:** POST
4. Click "Save configuration"

### Step 7: Start the API Server

```bash
pnpm --filter @voicedesk/api dev
```

You should see:
```
🚀 VoiceDesk API running at http://0.0.0.0:3001
Redis connected
```

---

## Testing the Flow

### Test 1: Health Check

```bash
curl http://localhost:3001/health
# Should return: {"status":"ok","timestamp":"...","version":"1.0.0"}
```

### Test 2: Make a Test Call

1. Call your Twilio phone number from any phone
2. You should hear the AI greeting:
   > "Thank you for calling Demo Italian Kitchen..."

3. Say: **"I'd like to make a reservation"**
4. The AI should start collecting booking details:
   - Name
   - Date/Time
   - Number of guests

5. Complete the booking conversation

### Test 3: Verify Booking Was Saved

```bash
# Open Prisma Studio to view the database
pnpm db:studio
```

Or check via API (you'll need to authenticate first, or check directly in Prisma Studio):
- Look at the `Booking` table
- Look at the `Call` table for call logs

---

## Troubleshooting

### "ngrok tunnel not working"
- Make sure ngrok is running in a separate terminal
- Make sure the URL in `.env` matches the ngrok URL
- Restart the API server after changing `.env`

### "No audio / silence"
- Check ElevenLabs API key is valid
- Check the voice ID exists
- Look at API logs for TTS errors

### "AI doesn't understand me"
- Check Deepgram API key is valid
- Make sure you're speaking clearly
- Check API logs for STT errors

### "Call connects but hangs up immediately"
- Check Twilio webhook URL is correct
- Check API is running and reachable via ngrok
- Run `curl https://YOUR_NGROK_URL/health` to verify

### "Booking not saved"
- Check database is running: `docker ps`
- Check for errors in API logs
- Verify Prisma schema is pushed: `pnpm db:push`

---

## What's Being Tested

| Component | Status | Notes |
|-----------|--------|-------|
| Twilio webhooks | ✅ | Inbound call handling |
| Deepgram STT | ✅ | Speech to text |
| ElevenLabs TTS | ✅ | Text to speech |
| OpenAI GPT | ✅ | Conversation logic |
| PostgreSQL | ✅ | Booking storage |
| Redis | ✅ | Session management |

## What's NOT Being Tested (MVP scope)

- Stripe billing
- Dashboard UI
- Pinecone long-term memory
- n8n workflow triggers
- AWS deployment
- Call recordings
- Analytics

---

## MVP Environment Variables (Minimum Required)

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/voicedesk?schema=public"
REDIS_URL="redis://localhost:6379"

# Twilio
TWILIO_ACCOUNT_SID="AC..."
TWILIO_AUTH_TOKEN="..."
TWILIO_PHONE_NUMBER="+1..."

# AI Services
DEEPGRAM_API_KEY="..."
ELEVENLABS_API_KEY="..."
ELEVENLABS_VOICE_ID="21m00Tcm4TlvDq8ikWAM"
OPENAI_API_KEY="sk-..."

# App
NODE_ENV="development"
API_PORT=3001
API_URL="https://YOUR_NGROK.ngrok-free.app"
JWT_SECRET="mvp-testing-secret-change-in-production-32chars"
```

---

## Single Entrypoint Command

After all setup is complete, the single command to start everything:

```bash
# Terminal 1: Start databases
docker-compose -f docker-compose.mvp.yml up -d

# Terminal 2: Start ngrok (keep running)
ngrok http 3001

# Terminal 3: Start API
pnpm --filter @voicedesk/api dev
```

Then call your Twilio phone number.

---

## Expected Call Flow

```
1. Phone rings → Twilio receives call
2. Twilio POSTs to /api/calls/incoming
3. API returns TwiML with <Stream> to connect WebSocket
4. Twilio opens WebSocket to /api/calls/stream/:callSid
5. CallOrchestrator initializes:
   - Deepgram streaming connection
   - ElevenLabs TTS ready
   - ConversationEngine with tenant config
6. AI greeting is synthesized and played
7. Caller speaks → Deepgram transcribes → text sent to GPT
8. GPT responds → ElevenLabs synthesizes → audio sent to caller
9. Loop continues until booking is complete
10. Booking saved to PostgreSQL
11. Confirmation spoken
12. Call ends
```
