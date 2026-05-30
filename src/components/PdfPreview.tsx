import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";

export function PdfPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = !!file && /^image\//i.test(file.type);

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
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-3.5 w-3.5 text-lime shrink-0" />
          <span className="truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-white/5"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
          <a
            href={url}
            download={file.name}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-white/5"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
      {isImage ? (
        <div className="h-[calc(100%-2.75rem)] bg-black/30 flex items-center justify-center p-3">
          <img src={url} alt={file.name} className="max-h-full max-w-full object-contain rounded-lg" loading="lazy" />
        </div>
      ) : (
        <object data={url} type="application/pdf" className="w-full h-[calc(100%-2.75rem)] bg-white">
          <div className="h-full flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Inline preview is not available on this device.</p>
            <div className="flex gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5"
              >
                <ExternalLink className="h-4 w-4" /> Open preview
              </a>
              <a
                href={url}
                download={file.name}
                className="inline-flex items-center gap-1 rounded-lg bg-lime px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Download className="h-4 w-4" /> Download file
              </a>
            </div>
          </div>
        </object>
      )}
    </div>
  );
}
