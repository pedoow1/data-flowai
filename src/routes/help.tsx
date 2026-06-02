import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Clock, AlertCircle, CheckCircle } from "lucide-react";

function HelpPage() {
  const faqs = [
    {
      question: "What file formats are supported?",
      answer: "We support PDF, Excel (.xlsx, .xls), CSV, JSON, and image files (JPG, PNG).",
      icon: HelpCircle,
    },
    {
      question: "How long does processing take?",
      answer: "Most files process within 10-30 seconds depending on size and complexity.",
      icon: Clock,
    },
    {
      question: "What happens if a job fails?",
      answer: "The system automatically retries failed jobs up to 3 times with exponential backoff.",
      icon: AlertCircle,
    },
    {
      question: "Can I download results?",
      answer: "Yes! Once processing completes, you can view and download results in multiple formats.",
      icon: CheckCircle,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2">Help & FAQ</h1>
        <p className="text-slate-400 mb-8">Find answers to common questions</p>

        <div className="space-y-4 mb-8">
          {faqs.map((faq, index) => {
            const Icon = faq.icon;
            return (
              <Card key={index} className="p-6 bg-slate-800 border-slate-700">
                <div className="flex gap-3 mb-2">
                  <Icon className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" />
                  <h3 className="text-lg font-semibold text-white">{faq.question}</h3>
                </div>
                <p className="text-slate-300 ml-9">{faq.answer}</p>
              </Card>
            );
          })}
        </div>

        <Card className="p-6 bg-slate-800 border-slate-700 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Need More Help?</h2>
          <p className="text-slate-300 mb-4">Contact our support team:</p>
          <ul className="text-slate-300 space-y-2">
            <li>📧 Email: support@data-flowai.com</li>
            <li>💬 Discord: Join our community</li>
            <li>📚 Docs: Full documentation</li>
          </ul>
        </Card>

        <div className="flex gap-4">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <a href="/">← Back to Upload</a>
          </Button>
          <Button variant="outline">
            <a href="/about">Learn More →</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/help")({ component: HelpPage });
