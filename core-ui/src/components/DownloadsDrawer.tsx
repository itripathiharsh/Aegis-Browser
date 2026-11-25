import React from 'react';
import type { DownloadRecord } from '../adblock/types';
import { FolderIcon, TrashIcon } from './BrowserIcons';

interface DownloadsDrawerProps {
  records: DownloadRecord[];
  onOpenFile: (id: string) => void;
  onOpenSystemDownloads: () => void;
  onRemoveRecord: (id: string) => void;
  onClearCompleted: () => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatHost(url: string): string {
  if (url.startsWith('blob://')) return 'Generated file';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const DownloadsDrawer: React.FC<DownloadsDrawerProps> = ({
  records,
  onOpenFile,
  onOpenSystemDownloads,
  onRemoveRecord,
  onClearCompleted,
  onClose,
}) => {
  const hasFinished = records.some((r) => r.status !== 'downloading');

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="downloads-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="downloads-drawer-title" className="drawer-title">
            Downloads ({records.length})
          </h2>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="dl-toolbar">
          <button
            type="button"
            className="primary-btn dl-folder-btn"
            onClick={onOpenSystemDownloads}
          >
            <FolderIcon size={16} />
            <span>Open Downloads Folder</span>
          </button>
          {hasFinished && (
            <button type="button" className="secondary-btn" onClick={onClearCompleted}>
              Clear Finished
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="panel-card empty-state-card">
            <div className="row-title">No downloads yet</div>
            <div className="row-meta">
              Files and web exports you download are saved through Android Download Manager and can be opened right from here.
            </div>
          </div>
        ) : (
          <div className="list-stack">
            {records.map((rec) => {
              const pct =
                rec.totalBytes > 0
                  ? Math.min(100, Math.round((rec.downloadedBytes / rec.totalBytes) * 100))
                  : 0;
              const sizeLabel =
                rec.status === 'downloading' && rec.totalBytes > 0
                  ? `${formatBytes(rec.downloadedBytes)} / ${formatBytes(rec.totalBytes)} (${pct}%)`
                  : rec.totalBytes > 0
                    ? formatBytes(rec.totalBytes)
                    : 'Saving...';

              return (
                <div key={rec.id} className="panel-card dl-item-card">
                  <div className="dl-item-top">
                    <button
                      type="button"
                      className="dl-item-info dl-open-btn"
                      onClick={() => onOpenFile(rec.id)}
                    >
                      <span className="row-title dl-filename">{rec.fileName}</span>
                      <span className="row-meta">
                        {formatHost(rec.url)} • {sizeLabel}
                      </span>
                    </button>
                    <div className="dl-item-actions">
                      <span className="dl-status-pill" data-status={rec.status}>
                        {rec.status === 'downloading'
                          ? 'Downloading'
                          : rec.status === 'completed'
                            ? 'Open'
                            : 'Failed'}
                      </span>
                      <button
                        type="button"
                        className="icon-action-btn"
                        aria-label={`Remove ${rec.fileName}`}
                        onClick={() => onRemoveRecord(rec.id)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </div>
                  {rec.status === 'downloading' && (
                    <div className="dl-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="dl-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
