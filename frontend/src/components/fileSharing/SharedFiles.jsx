import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import FileCard from "./FileCard";
import FilePreview from "./FilePreview";
import { getUserById } from "../../services/userDirectory";
import { formatFileSize } from "../../utils/helperFunctions";

const SharedFiles = ({ files = [], currentUserId, canDeleteAll = false, onDelete, onDownload }) => {
  const [previewFile, setPreviewFile] = useState(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      const uploader = f.uploadedByUser?.name || getUserById(f.uploadedBy)?.name || "";
      return `${f.name} ${f.type} ${uploader}`.toLowerCase().includes(q);
    });
  }, [files, query]);

  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  if (files.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-slate-muted">No files shared yet. Upload the first one to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-paper border border-slate-line rounded-full px-3.5 py-2">
        <Search className="w-4 h-4 text-slate-muted shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files by name, type or uploader…"
          className="flex-1 bg-transparent outline-none text-sm"
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear file search">
            <X className="w-4 h-4 text-slate-muted" />
          </button>
        )}
      </div>

      <p className="text-xs text-slate-muted">
        {visible.length} of {files.length} file{files.length === 1 ? "" : "s"} · {formatFileSize(totalSize)} total
      </p>

      {visible.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          uploaderName={file.uploadedByUser?.name || getUserById(file.uploadedBy)?.name}
          onPreview={setPreviewFile}
          onDownload={onDownload}
          onDelete={onDelete}
          canDelete={canDeleteAll || String(file.uploadedBy) === String(currentUserId)}
        />
      ))}

      {visible.length === 0 && (
        <p className="text-sm text-slate-muted text-center py-6">No files match “{query}”.</p>
      )}

      {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} onDownload={onDownload} />}
    </div>
  );
};

export default SharedFiles;
