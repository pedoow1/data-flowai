import { useCallback, useRef, useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { logEvent } from "@/lib/auth";

const MAX_SIZE = 10 * 1024 * 1024;

const PDF_TYPES  = ["application/pdf"];
const IMG_TYPES  = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const VALID_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

function isAccepted(f: File): boolean {
  const lc = f.name.toLowerCase();
  return (
    [...PDF_TYPES, ...IMG_TYPES].includes(f.type) ||
    VALID_EXTS.some((ext) => lc.endsWith(ext))
  );
}

export function FileUploader({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [drag,  setDrag]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const validate = (files: File[]) => {
    setError(null);
    const ok: File[] = [];
    for (const f of files) {
      if (!isAccepted(f)) {
        setError(`"${f.name}" must be a PDF or image (PNG, JPG, WEBP).`);
        logEvent("upload-error", `Unsupported type: ${f.name}`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        setError(`"${f.name}" exceeds 10 MB limit.`);
        logEvent("upload-error", `Too large: ${f.name}`);
        continue;
      }
      if (f.size === 0) {
        setError(`"${f.name}" appears to be corrupted.`);
        logEvent("upload-error", `Empty: ${f.name}`);
        continue;
      }
      ok.push(f);
    }
    if (ok.length) { onFiles(ok); logEvent("upload", `${ok.length} file(s) accepted`); }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (disabled) return;
    validate(Array.from(e.dataTransfer.files));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !disabled && ref.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center transition-all
          ${drag ? "border-lime bg-lime/[0.06] scale-[1.01]" : "border-border hover:border-lime/40 hover:bg-white/[0.02]"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input
          ref={ref}
          type="file"
          multiple
          accept=".pdf,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => e.target.files && validate(Array.from(e.target.files))}
        />
        <div className="flex flex-col items-center gap-4">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${drag ? "bg-lime text-primary-foreground" : "bg-lime/10 text-lime border border-lime/20"}`}>
            <Upload className="h-7 w-7" />
          </div>
          <div>
            <p className="text-base font-semibold">
              {drag ? "Drop to upload" : "Drag & drop files here"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              or <span className="text-lime">click to browse</span> · Batch upload supported · Max 10 MB
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> PDF · PNG · JPG · WEBP
          </div>
        </div>
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
