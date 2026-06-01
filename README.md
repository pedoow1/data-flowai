# Data FlowAI 🚀

A powerful AI-driven data extraction and processing platform. Upload files (PDF, Excel, etc.), extract data automatically, and monitor processing in real-time.

## Features

✨ **Key Features:**
- 📤 File upload with validation
- 🔄 Asynchronous job processing
- 📊 Real-time status monitoring
- 🎯 Support for multiple file types (PDF, Excel, etc.)
- 🔁 Automatic retry logic with exponential backoff
- 📈 Comprehensive dashboard
- 🔐 User-based job tracking
- 💪 Scalable worker architecture

## Tech Stack

- **Frontend:** React 19 + TanStack Router + TailwindCSS
- **Backend:** Express + Node.js
- **Database:** PostgreSQL + Drizzle ORM
- **Worker:** Background job processor
- **Deployment:** Vercel
- **Package Manager:** Bun

## Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Bun (recommended) or npm

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/pedoow1/data-flowai.git
cd data-flowai
```

2. **Install dependencies**
```bash
bun install
# or
npm install
```

3. **Setup environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/data_flowai
RUN_WORKER=true
```

4. **Create database and run migrations**
```bash
bun run db:push
# or
npm run db:push
```

5. **Start development server**
```bash
bun run dev
# or
npm run dev
```

Visit http://localhost:5173

## API Endpoints

### 1. Upload & Extract
**POST** `/api/extract`

```bash
curl -X POST http://localhost:5173/api/extract \
  -F "file=@document.pdf" \
  -F "userId=user-123"
```

**Response:**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadId": "123e4567-e89b-12d3-a456-426614174000",
  "message": "File uploaded and job queued"
}
```

### 2. Check Job Status
**GET** `/api/status?jobId=<jobId>`

```bash
curl http://localhost:5173/api/status?jobId=550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "output": {
    "type": "pdf",
    "extractedText": "...",
    "pageCount": 5
  },
  "error": null,
  "createdAt": "2026-06-01T14:30:00Z",
  "completedAt": "2026-06-01T14:30:05Z"
}
```

### 3. List User Jobs
**GET** `/api/jobs?userId=<userId>&status=<status>&limit=20`

```bash
curl http://localhost:5173/api/jobs?userId=user-123&status=completed
```

### 4. Worker Statistics
**GET** `/api/worker-stats`

```bash
curl http://localhost:5173/api/worker-stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "pending": 2,
    "processing": 1,
    "completed": 45,
    "failed": 1,
    "total": 49
  },
  "timestamp": "2026-06-01T14:35:00Z"
}
```

## Database Schema

### Jobs Table
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  upload_id UUID,
  type TEXT NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL,
  output JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## Architecture

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ Upload File
       ▼
┌──────────────────┐
│  /api/extract    │ ◄─────┐
├──────────────────┤       │
│ Validate File    │       │
│ Create Upload    │       │
│ Create Job       │       │
└────────┬─────────┘       │
         │                 │
         ▼                 │
    ┌─────────┐            │ Poll Status
    │ Database│            │
    │  (Jobs) │ ◄──────────┤
    └────┬────┘            │
         │                 │
         ▼                 │
┌──────────────────┐       │
│  Job Worker      │       │
├──────────────────┤       │
│ Fetch Pending    │       │
│ Process Files    │       │
│ Update Status    │───────┘
└──────────────────┘
```

## Development

### Project Structure
```
├── shared/
│   └── schema.ts          # Drizzle ORM schemas
├── server/
│   ├── api/               # API endpoints
│   │   ├── extract.ts
│   │   ├── status.ts
│   │   ├── jobs.ts
│   │   └── worker-stats.ts
│   ├── jobs/
│   │   └── processor.ts    # Job processing logic
│   ├── workers/
│   │   └── job-processor.ts # Background worker
│   └── db.ts              # Database connection
├── src/
│   ├── routes/            # React Router pages
│   │   ├── __root.tsx
│   │   ├── index.tsx      # Main upload page
│   │   └── dashboard.tsx  # Monitoring dashboard
│   └── components/        # UI components
├── migrations/            # Database migrations
└── package.json
```

### Commands

```bash
# Development
bun run dev                # Start dev server

# Database
bun run db:push           # Push schema to DB
bun run db:migrate        # Create migrations

# Production
bun run build             # Build for production
bun run preview           # Preview production build

# Linting
bun run lint              # Run ESLint
bun run format            # Format code with Prettier
```

## Deployment

### Vercel

The project is configured for Vercel deployment. Just connect your GitHub repo:

```bash
# Push to GitHub
git push origin main

# Vercel will automatically deploy
# Set environment variables in Vercel Dashboard
```

## Job Processing

### How It Works

1. **File Upload:** User uploads file via `/api/extract`
2. **Job Creation:** Job is created in database with `pending` status
3. **Background Worker:** Worker picks up pending jobs every 5 seconds
4. **Processing:** Worker processes file based on type (PDF, Excel, etc.)
5. **Status Update:** Job status changed to `processing`, then `completed` or `failed`
6. **Result Storage:** Extracted data stored in `output` field
7. **Client Poll:** Frontend polls `/api/status` to get real-time updates

### Retry Logic

- Jobs have `max_attempts` (default: 3)
- Failed jobs automatically retry with exponential backoff
- After max attempts, job marked as `failed`

### File Types Supported

- 📄 PDF (text extraction, page counting)
- 📊 Excel (sheet detection, data structure analysis)
- 📝 CSV, JSON
- 🖼️ Images (OCR-ready)

## Performance Tips

- Set `max_attempts` based on file complexity
- Adjust worker polling interval (default: 5s)
- Use database indexes for job queries
- Monitor worker stats via `/api/worker-stats`

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## License

MIT License - see LICENSE file

## Support

- 📧 Email: support@data-flowai.com
- 🐛 Issues: GitHub Issues
- 💬 Discussions: GitHub Discussions

## Roadmap

- [ ] WebSocket real-time updates
- [ ] Email notifications on job completion
- [ ] Advanced OCR for images
- [ ] Webhook support for external integrations
- [ ] API rate limiting and quotas
- [ ] Advanced scheduling for batch jobs
- [ ] S3/Cloud storage integration
- [ ] Multi-language support

---

Made with ❤️ by the Data FlowAI team
