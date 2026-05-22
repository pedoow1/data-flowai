import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

export function PdfPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (!file || !url) {
    return (
      <div className="glass rounded-2xl h-[480px] lg:h-[640px] flex flex-col items-center justify-center text-center p-8">
        <FileText className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Your PDF preview will appear here once you upload a file.</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl overflow-hidden h-[480px] lg:h-[640px]">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5 text-lime" />
        <span className="truncate">{file.name}</span>
      </div>
      <iframe src={url} title={file.name} className="w-full h-[calc(100%-2.25rem)] bg-white" />
    </div>
  );
}
