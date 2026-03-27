<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

# Vercel Deployment Guide

## Production Deployment Process

### Prerequisites
- Vercel CLI installed: `npm i -g vercel`
- Logged in: `vercel login`
- Project linked: `vercel link` (select `watchman-eight`)

### Deployment Steps

1. **Prepare Code**
   ```bash
   git add .
   git commit -m "feat: description of changes"
   git push origin main
   ```

2. **Build Verification**
   ```bash
   npm run build
   # Verify build succeeds without errors
   npm run preview
   # Test the production build locally
   ```

3. **Deploy to Vercel**
   ```bash
   vercel --prod
   ```

4. **Verify Deployment**
   - Check deployment URL provided by Vercel
   - Test all major functionality
   - Verify Supabase integration
   - Test PWA features

### Environment Variables Setup

Create a `.env.production` file in the `web/` directory with the following variables:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://pfjcxewlsqmfajrogvdo.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Application Configuration
VITE_APP_NAME=Neighbourhood Watch
VITE_APP_VERSION=1.0.0
VITE_API_BASE_URL=https://your-api-url.com

# Optional: Analytics and Monitoring
VITE_GOOGLE_ANALYTICS_ID=your_ga_id
VITE_SENTRY_DSN=your_sentry_dsn
```

**Important:** Never commit `.env.production` to version control. Add it to `.gitignore`.

### Post-Deployment Checklist

- [ ] Application loads successfully
- [ ] Authentication works (if implemented)
- [ ] Map functionality loads (Leaflet integration)
- [ ] Service worker registers correctly
- [ ] PWA installation works
- [ ] All API endpoints respond correctly
- [ ] Error handling displays properly
- [ ] Mobile responsiveness verified

### Troubleshooting

#### Common Issues

1. **Build Failures**
   - Check Node.js version compatibility
   - Verify all dependencies are installed
   - Check for TypeScript errors

2. **Environment Variables Not Loading**
   - Verify `.env.production` exists
   - Check Vercel dashboard environment variables
   - Ensure variables are prefixed with `VITE_`

3. **Supabase Connection Issues**
   - Verify Supabase project URL and keys
   - Check CORS settings in Supabase dashboard
   - Ensure RLS policies are configured correctly

4. **PWA Not Working**
   - Verify service worker registration
   - Check manifest.json configuration
   - Ensure HTTPS is enabled

### Performance Optimization

1. **Bundle Size**
   ```bash
   npm run build -- --mode production
   # Analyze bundle size
   npx vite-bundle-analyzer dist
   ```

2. **Image Optimization**
   - Use WebP format for images
   - Implement lazy loading
   - Compress assets

3. **Caching Strategy**
   - Configure proper cache headers
   - Use Vercel's edge network
   - Implement service worker caching

### Rollback Procedure

If deployment issues occur:

1. **Quick Rollback**
   ```bash
   vercel --prod --rollback
   ```

2. **Manual Rollback**
   - Go to Vercel dashboard
   - Navigate to Deployments
   - Select previous successful deployment
   - Promote to Production
