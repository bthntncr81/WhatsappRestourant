# WhatRes - Nx Monorepo

A full-stack multi-tenant monorepo powered by Nx with Angular frontend, Express.js API, and shared TypeScript libraries.

## 📁 Project Structure

```
whatres/
├── apps/
│   ├── web/            # Angular 18 frontend (port 4200)
│   ├── api/            # Express.js API (port 3000)
│   │   └── prisma/     # Prisma schema & migrations
│   ├── worker/         # Background job processor
│   └── print-bridge/   # Receipt printing service (runs on-premises)
├── libs/
│   ├── shared/         # Shared DTOs and types
│   └── config/         # Environment config loader with Zod validation
├── docker-compose.yml
└── package.json
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm 9+
- Docker & Docker Compose

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Redis** on port `6379`

### 3. Configure Environment

```bash
cp .env.example .env
cp .env.example apps/api/.env
```

Edit `.env` with your settings if needed.

### 4. Run Database Migrations

```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Run the Applications

**API Server (Express.js)**
```bash
pnpm start:api
# or
npx nx serve api
```
API runs at: http://localhost:3000

**Web App (Angular)**
```bash
pnpm start:web
# or
npx nx serve web
```
Web app runs at: http://localhost:4200

**Worker**
```bash
pnpm start:worker
# or
npx nx serve worker
```

**Print Bridge** (runs on-premises at the restaurant location)
```bash
cd apps/print-bridge
pnpm install
cp .env.example .env
# Edit .env with: API_URL, TENANT_ID, API_TOKEN
pnpm dev
```

## 🔐 Authentication

### Multi-Tenant Architecture

- Each user can belong to multiple tenants (workspaces)
- Tenant context is passed via `X-Tenant-ID` header
- JWT tokens include user, tenant, and role information

### Roles (RBAC)

| Role | Description |
|------|-------------|
| `OWNER` | Full access, can manage tenant settings |
| `ADMIN` | Administrative access |
| `AGENT` | Standard user access |
| `STAFF` | Limited access |

### API Endpoints

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/auth/register` | POST | Register new tenant + owner | No |
| `/api/auth/login` | POST | Login, returns JWT | No |
| `/api/auth/me` | GET | Get current user info | Yes |
| `/api/health` | GET | Health check | No |
| `/api/health/ready` | GET | Readiness probe | No |
| `/api/health/live` | GET | Liveness probe | No |

### Example: Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123",
    "name": "Admin User",
    "tenantName": "My Company",
    "tenantSlug": "my-company"
  }'
```

### Example: Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }'
```

### Example: Get Profile

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-Tenant-ID: YOUR_TENANT_ID"
```

## 🛠 Development

### Available Scripts

```bash
# Start applications
pnpm start:api          # Start API server
pnpm start:web          # Start web app
pnpm start:worker       # Start worker

# Build
pnpm build:api          # Build API
pnpm build:web          # Build web app
pnpm build:worker       # Build worker

# Code quality
pnpm lint               # Lint all projects
pnpm format             # Format code with Prettier
pnpm format:check       # Check formatting
pnpm test               # Run tests
```

### Prisma Commands

```bash
cd apps/api

# Generate Prisma client
npx prisma generate

# Create migration
npx prisma migrate dev --name migration_name

# Reset database
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

### Nx Commands

```bash
# Run specific target
npx nx serve api
npx nx serve web
npx nx build shared

# Run target for all projects
npx nx run-many -t build
npx nx run-many -t lint

# Visualize dependency graph
npx nx graph
```

## 🏗 Architecture

### Apps

- **web**: Angular 18 standalone application with routing, auth, and shell layout
- **api**: Express.js server with Prisma, JWT auth, Pino logging, and Zod validation
- **worker**: Node.js application for background jobs (queue processing)
- **print-bridge**: On-premises service for printing receipts (uses Puppeteer for PDF generation)

### Libs

- **shared**: Common DTOs, types, and interfaces used across apps
- **config**: Centralized configuration loading with Zod schema validation

### Database Schema

```prisma
model Tenant {
  id          String       @id
  name        String
  slug        String       @unique
  memberships Membership[]
}

model User {
  id           String       @id
  email        String       @unique
  passwordHash String
  name         String
  memberships  Membership[]
}

model Membership {
  id       String     @id
  tenantId String
  userId   String
  role     MemberRole // OWNER, ADMIN, AGENT, STAFF
}
```

## 🖨️ Print System

### Overview

The print system consists of:
1. **API** creates print jobs when orders are confirmed
2. **Print Bridge** polls for pending jobs and generates PDFs

### Print Job Types

| Type | Description |
|------|-------------|
| `KITCHEN` | Kitchen receipt with items, options, and notes |
| `COURIER` | Delivery receipt with customer info and address |

### Print Bridge Configuration

The print-bridge service runs on-premises at each restaurant location.

```bash
cd apps/print-bridge
cp .env.example .env
```

Configure `.env`:
```
API_URL=https://your-api.com/api
TENANT_ID=your-tenant-id
API_TOKEN=your-jwt-token
POLL_INTERVAL=5000
OUTPUT_DIR=./printed
```

### Running Print Bridge

```bash
cd apps/print-bridge
pnpm install
pnpm dev
```

The service will:
- Poll the API every 5 seconds for pending print jobs
- Generate PDF receipts using Puppeteer
- Save receipts to the `printed/` folder
- Mark jobs as complete/failed

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orders/:id/confirm` | POST | Confirm order and create print jobs |
| `/api/orders/:id/reprint` | POST | Create reprint job (KITCHEN/COURIER) |
| `/api/print-jobs/pending` | GET | Get pending jobs (for print-bridge) |
| `/api/print-jobs/:id/claim` | POST | Claim job for processing |
| `/api/print-jobs/:id/complete` | POST | Mark job as done/failed |

## 🔧 Configuration

Environment variables are validated using Zod. See `.env.example` for all available options:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 3000 | API server port |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `JWT_SECRET` | - | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | 7d | JWT expiration time |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `LOG_LEVEL` | debug | Logging level |

## 🐳 Docker

### Development Infrastructure

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v
```

## 🔒 Security Features

- **Password Hashing**: bcrypt with 12 rounds
- **Rate Limiting**: 10 requests per 15 minutes for auth endpoints
- **JWT Authentication**: Secure token-based authentication
- **RBAC**: Role-based access control
- **Zod Validation**: Input validation on all endpoints

## 📦 Tech Stack

- **Frontend**: Angular 18, RxJS, SCSS, Signals
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT, bcrypt
- **Validation**: Zod
- **Logging**: Pino
- **Cache/Queue**: Redis
- **Build System**: Nx
- **Package Manager**: pnpm

## 📄 License

MIT
