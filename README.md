# Product Master

Internal product catalog, UPC registry, and cost master for e-commerce operations.

## Stack
- **Next.js 14** (React framework)
- **Supabase** (database + authentication)
- **Vercel** (hosting)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill in your Supabase credentials:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run locally
```bash
npm run dev
```
Open http://localhost:3000

## Deploy to Vercel
1. Push this repo to GitHub
2. Connect repo in Vercel dashboard
3. Add the two environment variables in Vercel project settings
4. Deploy

## Users
Users are managed in Supabase Auth → Authentication → Users.
Add or remove users there — no code changes needed.
