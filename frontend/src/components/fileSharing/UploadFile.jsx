import { useRef, useState } from "react";
import { UploadCloud, FolderUp } from "lucide-react";
import { useFileUpload } from "../../hooks/useFileUpload";
import { MAX_FILE_SIZE_MB } from "../../utils/constants";

const UploadFile = ({ groupId, uploadedBy, onUploaded }) => {
  const { uploadMany, progress, uploading, error } = useFileUpload(groupId, uploadedBy);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null); // { uploadedCount, skipped: [{name, reason}] }
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleFiles = async (fileList) => {
    const all = Array.from(fileList || []);
    if (!all.length) return;

    const valid = [];
    const skipped = [];
    for (const file of all) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        skipped.push({ name: file.webkitRelativePath || file.name, reason: `over ${MAX_FILE_SIZE_MB}MB` });
      } else {
        valid.push(file);
      }
    }

    setResult(null);
    if (!valid.length) {
      setResult({ uploadedCount: 0, skipped });
      return;
    }

    try {
      const saved = await uploadMany(valid);
      for (const file of saved) onUploaded?.(file);
      setResult({ uploadedCount: saved.length, skipped });
    } catch {
      // uploadMany already sets `error`; nothing else to do here.
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`rounded-xl2 border-2 border-dashed p-6 text-center transition-colors ${
        dragOver ? "border-brand bg-brand-soft" : "border-slate-line bg-paper"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* Folder upload: webkitdirectory is supported in all major browsers for a native folder picker. */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <UploadCloud className="w-8 h-8 text-brand mx-auto mb-2" />
      <p className="text-sm text-slate-ink font-medium">Drag files (or a .zip) here, or</p>
      <div className="flex items-center justify-center gap-4 mt-1">
        <button
          onClick={() => inputRef.current?.click()}
          className="text-sm text-brand font-semibold hover:underline"
        >
          browse files
        </button>
        <button
          onClick={() => folderInputRef.current?.click()}
          className="text-sm text-brand font-semibold hover:underline inline-flex items-center gap-1"
        >
          <FolderUp className="w-3.5 h-3.5" /> browse a folder
        </button>
      </div>
      <p className="text-xs text-slate-muted mt-2">Up to {MAX_FILE_SIZE_MB}MB per file. Multiple files, folders, and .zip archives are all supported.</p>

      {uploading && (
        <div className="mt-4">
          <div className="h-1.5 rounded-full bg-cloud overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-muted mt-1">{progress}% uploaded</p>
        </div>
      )}

      {!uploading && error && <p className="text-xs text-coral mt-2">{error}</p>}

      {!uploading && !error && result && (
        <div className="mt-2 text-xs">
          {result.uploadedCount > 0 && (
            <p className="text-emerald-600">
              {result.uploadedCount} file{result.uploadedCount > 1 ? "s" : ""} uploaded successfully.
            </p>
          )}
          {result.skipped.length > 0 && (
            <p className="text-coral mt-1">
              Skipped: {result.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default UploadFile;
