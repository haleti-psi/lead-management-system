# `@lms/shared` — Cross-cutting TypeScript

Code shared by `@lms/api` and `@lms/web`. Imported as `@lms/shared` (path alias configured in
each app's tsconfig and bundler).

## Contents

```
src/
├── enums/    # enum values — GENERATED in Stage 7 from the BRD §5.5 catalog (schema.sql).
│             #   Single source of truth; never redefine an enum locally in either app.
├── types/    # ApiEnvelope<T>, ApiError, ApiMeta, PaginationMeta (BRD §4.4 response contract)
└── errors/   # ERROR_CODES — the only permitted error codes (BRD §8.4 / error-taxonomy.md)
```

## Rules

- **Do not hand-author enum values** in `enums/` — they are regenerated from the data-model
  catalog. Editing them by hand causes drift between the apps and the database.
- Keep this package free of runtime/framework dependencies (only `zod` + types). It must be
  importable from both a Node (NestJS) and a browser (Vite) context.
- Build before the apps: `npm run build:shared` (the root `build` script does this in order).

## Build

```bash
npm run build -w @lms/shared   # tsc → dist/ (composite project)
```
