import { Paperclip, ImageIcon, VideoIcon } from 'lucide-react';

function isVideo(type, name = '') {
  return String(type || '').startsWith('video/') || /\.(mp4|webm|mov|MOV)$/i.test(name);
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ComplaintAttachments({ evidence = [] }) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm mb-6">
      <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Paperclip className="w-4 h-4" />
        Attachments ({evidence.length})
      </h3>
      <ul className="space-y-2">
        {evidence.map((f) => {
          const video = isVideo(f.file_type, f.file_name);
          const Icon = video ? VideoIcon : ImageIcon;
          const size = formatSize(f.file_size);
          return (
            <li
              key={f.id || f.file_url}
              className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${video ? 'text-purple-500' : 'text-blue-500'}`} />
                <span className="text-sm text-slate-700 truncate">{f.file_name}</span>
                {size && <span className="text-xs text-slate-400 shrink-0">{size}</span>}
              </span>
              <a
                href={f.file_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-blue-600 hover:underline shrink-0"
              >
                Open
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
