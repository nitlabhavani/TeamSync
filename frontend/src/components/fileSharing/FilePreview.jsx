import { X, Download } from "lucide-react";
import { formatFileSize } from "../../utils/helperFunctions";

const FilePreview = ({ file, onClose, onDownload }) => {
  if (!file) return null;
  const isImage = file.type === "image" && file.url;
  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-paper rounded-xl2 w-full max-w-lg shadow-panel animate-popIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-line">
          <p className="text-sm font-semibold text-slate-ink truncate pr-4">{file.name}</p>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center">
            <X className="w-4 h-4 text-slate-muted" />
          </button>
        </div>
        <div className="p-8 flex flex-col items-center justify-center bg-cloud/60 min-h-[220px]">
          {isImage ? (
            <img src={file.url} alt={file.name} className="max-h-72 rounded-lg object-contain" />
          ) : (
            <p className="text-sm text-slate-muted text-center">
              Preview isn't available for this file type.
              <br />
              {formatFileSize(file.size)}
            </p>
          )}
        </div>
        <div className="px-5 py-4 flex justify-end">
          <button
            onClick={() => onDownload?.(file)}
            className="flex items-center gap-2 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-deep transition-colors"
          >
            <Download className="w-4 h-4" /> Download
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilePreview;
