# WhatRes - WhatsApp Restaurant Management Platform

Multi-tenant SaaS for managing restaurant orders via WhatsApp. Built as an Nx monorepo.

## Tech Stack

- **Frontend:** Angular 18 (standalone components, signals)
- **Backend:** Express.js + Prisma ORM + PostgreSQL + Redis
- **Monorepo:** Nx 19.8, pnpm 9
- **AI:** OpenAI (gpt-4o-mini) for NLU order extraction
- **Payments:** iyzico (Turkish payment processor)
- **WhatsApp:** Meta Cloud API (per-tenant configuration)

## Project Structure

```
apps/api/          Express.js backend (port 3000)
apps/web/          Angular 18 frontend (port 4200)
apps/worker/       Background job processor
apps/print-bridge/ On-premises receipt printing (standalone)
libs/shared/       Shared DTOs and types (@whatres/shared)
libs/config/       Zod-validated env config (@whatres/config)
```

## Commands

```bash
pnpm install                  # Install dependencies
docker compose up -d          # Start PostgreSQL + Redis
pnpm start:api                # Dev API server
pnpm start:web                # Dev web server
pnpm db:migrate               # Prisma migrate dev
pnpm db:generate              # Generate Prisma client
pnpm db:seed                  # Seed database
pnpm db:studio                # Prisma Studio GUI
pnpm lint                     # Lint all projects
pnpm test                     # Run all tests
pnpm format                   # Format with Prettier
pnpm build:api                # Build API
pnpm build:web                # Build web app
```

## Code Conventions

### Backend (apps/api)
- **Services:** Class-based with singleton export: `export const fooService = new FooService()`
- **Routes:** Express Router, Zod validation with `safeParse`, `AppError` for errors
- **Response:** Always wrap in `ApiResponse<T>` (`{ success, data, error }`)
- **Logger:** Pino via `createLogger()`
- **Database:** Prisma client from `../db/prisma`, cuid IDs, `@@map("snake_case")`

### Frontend (apps/web)
- **Components:** Standalone with inline templates and styles
- **State:** Angular signals (`signal`, `computed`)
- **HTTP:** `HttpClient` + `AuthService.getAuthHeaders()` for auth headers
- **CSS Variables:** `--color-*`, `--spacing-*`, `--radius-*`, `--transition-*`, `--font-mono`

### Shared (libs/shared)
- DTOs in `libs/shared/src/lib/dto/*.dto.ts`
- Types in `libs/shared/src/lib/types/common.types.ts`
- All exports via barrel `libs/shared/src/index.ts`

## Multi-Tenant Pattern

- Every Prisma model has `tenantId` field, every query filters by it
- `X-Tenant-ID` header on API requests
- JWT payload includes `sub`, `email`, `tenantId`, `role`
- Auth middleware sets `req.tenantId` and `req.user`
- Roles: `OWNER > ADMIN > AGENT > STAFF`
- Use `requireRole(['OWNER', 'ADMIN'])` middleware for role guards

## Environment

- `.env` at project root (loaded by dotenv)
- Zod schema validates all vars in `libs/config/src/lib/env.schema.ts`
- Access config via `getConfig()` from `@whatres/config`
- `ENCRYPTION_KEY` required for WhatsApp credential encryption (AES-256-GCM)

## WhatsApp Integration

Per-tenant configuration via Settings page. Each tenant:
1. Enters Meta Cloud API credentials (Phone Number ID, WABA ID, Access Token, App Secret)
2. Gets a unique webhook URL: `/api/whatsapp/webhook/:tenantId`
3. Gets an auto-generated verify token for Meta dashboard
4. Credentials are encrypted at rest (AES-256-GCM)

Key files: `apps/api/src/services/whatsapp-config.service.ts`, `apps/api/src/routes/whatsapp.routes.ts`
