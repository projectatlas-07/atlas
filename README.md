# Atlas

Mobile-first, online-first ERP foundation for brick manufacturing operations.

## Setup

1. Copy `.env.example` to `.env.local` and add the Supabase public URL and anon key.
2. Apply the SQL migration in `supabase/migrations` to the target Supabase project.
3. Install dependencies and run the development server.

## Structure

- `src/app`: application shell and global styles
- `src/components`: shared UI building blocks
- `src/features`: isolated business features
- `src/lib`: infrastructure clients
- `src/types`: shared domain types
- `supabase/migrations`: database schema changes
