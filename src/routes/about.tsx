import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8">About Data FlowAI</h1>

        <div className="space-y-6">
          <Card className="p-6 bg-slate-800 border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-3">🚀 What is Data FlowAI?</h2>
            <p className="text-slate-300">
              Data FlowAI is an intelligent file processing platform that extracts and analyzes data from documents automatically. 
              Upload your files (PDF, Excel, CSV, etc.) and let AI do the heavy lifting.
            </p>
          </Card>

          <Card className="p-6 bg-slate-800 border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-3">⚡ Key Features</h2>
            <ul className="text-slate-300 space-y-2">
              <li>✅ Fast & Reliable file processing</li>
              <li>✅ Support for multiple file formats</li>
              <li>✅ Real-time progress tracking</li>
              <li>✅ Automatic retry on failures</li>
              <li>✅ Comprehensive monitoring dashboard</li>
              <li>✅ Scalable architecture</li>
            </ul>
          </Card>

          <Card className="p-6 bg-slate-800 border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-3">🏗️ Architecture</h2>
            <p className="text-slate-300 mb-3">
              Built with modern technologies for optimal performance and scalability:
            </p>
            <ul className="text-slate-300 space-y-2">
              <li>• <strong>Frontend:</strong> React 19 with TailwindCSS</li>
              <li>• <strong>Backend:</strong> Express.js with TypeScript</li>
              <li>• <strong>Database:</strong> PostgreSQL with Drizzle ORM</li>
              <li>• <strong>Worker:</strong> Background job processor</li>
              <li>• <strong>Deployment:</strong> Vercel ready</li>
            </ul>
          </Card>

          <Card className="p-6 bg-slate-800 border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-3">📚 Getting Started</h2>
            <ol className="text-slate-300 space-y-2">
              <li>1. Go to home page</li>
              <li>2. Upload your file</li>
              <li>3. Wait for processing (real-time updates)</li>
              <li>4. Download or view results</li>
              <li>5. Check dashboard for history</li>
            </ol>
          </Card>

          <div className="flex gap-4">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <a href="/">← Back to Upload</a>
            </Button>
            <Button variant="outline">
              <a href="/dashboard">View Dashboard →</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/about")({ component: AboutPage });
