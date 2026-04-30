import { useRef, useState } from "react";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

interface UploadCircularProps {
  variant: "empty" | "header";
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadCircular({ variant, onFile, disabled }: UploadCircularProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const hidden = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      onChange={handleChange}
      disabled={disabled}
      className="upload-circular__input"
    />
  );

  if (variant === "header") {
    return (
      <>
        <button
          type="button"
          className="upload-circular__header-btn"
          onClick={pickFile}
          disabled={disabled}
        >
          Upload circular
        </button>
        {hidden}
      </>
    );
  }

  return (
    <div
      className={`upload-circular__dropzone ${dragOver ? "upload-circular__dropzone--over" : ""} ${disabled ? "upload-circular__dropzone--disabled" : ""}`}
      onClick={() => !disabled && pickFile()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          pickFile();
        }
      }}
    >
      <h3 className="upload-circular__title">Upload your weekly circular</h3>
      <p className="upload-circular__hint">
        Drop a PDF or photo here, or click to choose a file
      </p>
      <p className="upload-circular__formats">PDF, JPG, PNG, WEBP &middot; up to 25 MB</p>
      {hidden}
    </div>
  );
}
