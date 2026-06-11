# `@lms/web` — Frontend (React 18 + Vite PWA)

React 18 + TypeScript + Vite + Tailwind + **shadcn/ui** (Radix primitives), installable as a PWA.
Server state via TanStack Query; forms via React Hook Form + Zod; i18n via i18next.

## Structure (`docs/architecture.md` §3)

```
src/
├── main.tsx                # entry (StrictMode; QueryClient/router/i18n wired in Stage 7)
├── app/                    # App shell, providers, routes
├── components/
│   └── ui/                 # shadcn/ui primitives + shared components (DataTable, EntityForm,
│                           #   MaskedField, StatusChip, EmptyState/LoadingSkeleton/ErrorState, ...)
├── lib/{api,auth}/         # apiClient (typed envelope + correlation + auth cookie), auth context
├── hooks/  types/  utils/
└── index.css               # Tailwind layers
```

## Conventions (`docs/guidelines/ui.md`)

- Consume the uniform API envelope via `lib/api` `apiClient`; map `VALIDATION_ERROR.fields`
  to inline form errors (`EntityForm`).
- **Masking:** render PII through `MaskedField`; never log or render unmasked PAN/mobile/Aadhaar.
- Every data view implements the mandatory states: loading / empty / error / data.
- Accessibility: **WCAG 2.1 AA**; mobile-first / PWA; all copy via i18next keys.
- Reuse shared components from `components/ui` (`docs/contracts/shared-utilities.md`) — don't recreate.

## Run / build / test

```bash
npm install                  # from repo root
npm run dev  -w @lms/web      # or: npm run dev:web   (http://localhost:5173)
npm run build -w @lms/web     # tsc -b && vite build → dist/
npm run test -w @lms/web      # vitest + Testing Library
```

`VITE_API_BASE_URL` points the client at the API (`.env.example`). The production image serves
the built static assets via nginx on port 8080 (`Dockerfile` + `nginx.conf`).
