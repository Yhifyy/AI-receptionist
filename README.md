# VoiceDesk AI - AI Receptionist SaaS Platform

A production-ready AI-powered receptionist platform that handles phone calls for businesses using natural language processing, speech recognition, and voice synthesis.

## Features

- **Real-time Voice Pipeline**: Low-latency (<1.5s) call handling with Twilio Media Streams, Deepgram STT, and ElevenLabs TTS
- **Intelligent Conversation Engine**: GPT-4o powered conversations with intent classification and state management
- **Customer Memory System**: Personalized interactions using Redis, PostgreSQL, and Pinecone vector embeddings
- **Smart Call Routing**: VIP detection, sentiment analysis, and automatic human handoff
- **Revenue Optimization**: Built-in upselling, conversion scripts, and A/B testing
- **Multi-tenant SaaS**: Isolated data, custom configurations, and Stripe billing integration
- **Industry Modules**: Restaurant bookings with n8n workflow automation (expandable to Salon, Hotel, Retail)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           External Services                              │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌───────────┐   │
│  │ Twilio  │  │ Deepgram │  │ElevenLabs│  │  OpenAI  │  │  Stripe   │   │
│  └────┬────┘  └────┬─────┘  └────┬────┘  └────┬─────┘  └─────┬─────┘   │
└───────┼────────────┼─────────────┼───────────┼───────────────┼─────────┘
        │            │             │           │               │
┌───────┴────────────┴─────────────┴───────────┴───────────────┴─────────┐
│                         VoiceDesk API (Fastify)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Call         │  │ Conversation │  │   Memory     │  │  Billing   │  │
│  │ Orchestrator │  │   Engine     │  │   System     │  │  Service   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────────────┐
│                            Data Layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  PostgreSQL  │  │    Redis     │  │   Pinecone   │  │     S3     │  │
│  │  (Prisma)    │  │   (Cache)    │  │  (Vectors)   │  │(Recordings)│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js, Fastify, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| Cache | Redis |
| Vector DB | Pinecone |
| Frontend | Next.js 14, Tailwind CSS, React Query |
| Telephony | Twilio Voice + Media Streams |
| Speech-to-Text | Deepgram Nova-2 |
| Text-to-Speech | ElevenLabs Turbo v2 |
| LLM | OpenAI GPT-4o |
| Automation | n8n (self-hosted) |
| Billing | Stripe |
| Infrastructure | AWS (ECS, RDS, ElastiCache, S3) |
| IaC | Terraform |

## Project Structure

```
voicedesk-ai/
├── apps/
│   ├── api/                    # Fastify API server
│   │   └── src/
│   │       ├── modules/        # Feature modules
│   │       │   ├── calls/      # Call handling
│   │       │   ├── conversation/ # LLM engine
│   │       │   ├── memory/     # Customer memory
│   │       │   ├── routing/    # Smart routing
│   │       │   ├── billing/    # Stripe integration
│   │       │   └── analytics/  # Metrics
│   │       ├── industries/     # Industry-specific
│   │       │   └── restaurant/
│   │       └── integrations/   # External services
│   │           ├── twilio/
│   │           ├── deepgram/
│   │           ├── elevenlabs/
│   │           └── openai/
│   ├── dashboard/              # Next.js admin UI
│   └── n8n-workflows/          # Automation workflows
├── packages/
│   ├── database/               # Prisma schema
│   ├── shared-types/           # TypeScript types
│   └── ai-prompts/             # Prompt templates
├── infrastructure/
│   ├── terraform/              # AWS infrastructure
│   └── docker/                 # Container configs
└── docs/
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- API keys for: Twilio, Deepgram, ElevenLabs, OpenAI, Stripe

### Local Development

1. **Clone and install dependencies**:
   ```bash
   git clone <repository>
   cd voicedesk-ai
   pnpm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Start infrastructure**:
   ```bash
   docker-compose up -d postgres redis n8n
   ```

4. **Initialize database**:
   ```bash
   pnpm db:generate
   pnpm db:push
   pnpm --filter @voicedesk/database db:seed
   ```

5. **Start development servers**:
   ```bash
   pnpm dev
   ```

   - API: http://localhost:3001
   - Dashboard: http://localhost:3000
   - n8n: http://localhost:5678

### Testing Calls

1. Configure a Twilio phone number with webhook:
   - Voice URL: `https://your-domain.com/api/calls/incoming`
   - Status callback: `https://your-domain.com/api/calls/status`

2. Use ngrok for local testing:
   ```bash
   ngrok http 3001
   ```

## Deployment

### AWS Deployment (Terraform)

1. **Configure AWS credentials**:
   ```bash
   aws configure
   ```

2. **Initialize Terraform**:
   ```bash
   cd infrastructure/terraform
   terraform init
   ```

3. **Deploy**:
   ```bash
   terraform plan -var-file="prod.tfvars"
   terraform apply -var-file="prod.tfvars"
   ```

### Docker Deployment

```bash
# Build images
docker build -f infrastructure/docker/Dockerfile.api -t voicedesk-api .
docker build -f infrastructure/docker/Dockerfile.dashboard -t voicedesk-dashboard .

# Push to registry
docker push your-registry/voicedesk-api:latest
docker push your-registry/voicedesk-dashboard:latest
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register new tenant
- `GET /api/auth/me` - Get current user

### Calls
- `GET /api/calls` - List calls
- `GET /api/calls/:id` - Get call details
- `GET /api/calls/:id/transcript` - Get transcript
- `POST /api/calls/incoming` - Twilio webhook

### Tenants
- `GET /api/tenants/current` - Get tenant info
- `PATCH /api/tenants/current` - Update settings
- `GET /api/tenants/current/customers` - List customers
- `GET /api/tenants/current/menu` - Get menu items
- `GET /api/tenants/current/bookings` - Get bookings

### Analytics
- `GET /api/analytics/overview` - Dashboard metrics
- `GET /api/analytics/trends/daily` - Daily trends
- `GET /api/analytics/usage` - Usage statistics

### Billing
- `GET /api/billing/plans` - Available plans
- `GET /api/billing/subscription` - Current subscription
- `POST /api/billing/subscription` - Create subscription
- `POST /api/billing/portal` - Stripe portal URL

## Pricing Tiers

| Tier | Price | Minutes | Features |
|------|-------|---------|----------|
| Starter | $99/mo | 500 | Basic AI, 1 number |
| Growth | $299/mo | 2,000 | Custom voice, integrations |
| Pro | $599/mo | 5,000 | Multiple numbers, A/B testing |
| Enterprise | Custom | Unlimited | White-label, SLA |

## Key Differentiators vs Competitors

1. **Lower Latency**: End-to-end response in <1.5s vs industry 2-3s
2. **Deep Personalization**: Full customer memory with semantic search
3. **Revenue Focus**: Built-in upselling engine and conversion optimization
4. **Self-Improving**: Automated prompt optimization via A/B testing
5. **Industry Depth**: Vertical-specific features, not generic chatbot

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Submit a pull request

## License

Proprietary - All rights reserved

## Support

- Documentation: https://docs.voicedesk.ai
- Email: support@voicedesk.ai
