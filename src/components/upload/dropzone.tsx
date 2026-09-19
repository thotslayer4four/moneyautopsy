"use client";

import { useCallback, useId, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { MAX_UPLOAD_LABEL } from "@/lib/upload";

const ACCEPTED = [".pdf", ".csv"];

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((ext) => name.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Dropzone({
  file,
  onFileSelected,
  error,
}: {
  file: File | null;
  onFileSelected: (file: File | null) => void;
  error?: string | null;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const selected = files?.[0];
      if (!selected) return;
      if (!isAccepted(selected)) {
        onFileSelected(null);
        return;
      }
      onFileSelected(selected);
    },
    [onFileSelected]
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-describedby={error ? errorId : undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-surface px-6 py-12 text-center transition-colors duration-200",
          isDragging
            ? "border-accent bg-accent-wash"
            : "border-border-strong hover:border-foreground-muted hover:bg-foreground/[0.03]",
          error && !isDragging && "border-destructive"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <IconTile icon={file ? FileText : Upload} />
        {file ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-all text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-foreground-muted">
              {formatBytes(file.size)} · <span className="pointer-coarse:hidden">Click</span>
              <span className="hidden pointer-coarse:inline">Tap</span> to replace
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              <span className="pointer-coarse:hidden">Drop your statement here</span>
              <span className="hidden pointer-coarse:inline">Choose your statement</span>
            </p>
            <p className="text-xs text-foreground-muted">
              <span className="pointer-coarse:hidden">or click to browse · </span>PDF or CSV, up to {MAX_UPLOAD_LABEL}
            </p>
          </div>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
