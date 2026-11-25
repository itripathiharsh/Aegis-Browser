import React, { useEffect, useRef } from 'react';
import type { AppUpdateState } from '../adblock/types';
import { formatBytes } from '../utils/semver';
import { ShieldIcon } from './Icons';

interface UpdateModalProps {
  update: AppUpdateState;
  onUpdateNow: () => void;
  onCancelDownload: () => void;
  onRetryInstall: () => void;
  onLater: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  update,
  onUpdateNow,
  onCancelDownload,
  onRetryInstall,
  onLater,
}) => {
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryBtnRef.current?.focus();
  }, []);

  const isDownloading = update.status === 'downloading';
  const isAwaitingPerm = update.status === 'awaiting_permission';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDownloading) onLater();
      }}
    >
      <div className="update-modal">
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ color: 'var(--color-action)' }}>
              <ShieldIcon size={24} />
            </span>
            <div>
              <h2 id="update-modal-title" className="drawer-title">
                Update Available
              </h2>
              <p className="row-meta">
                {update.releaseTitle || `Aegis Browser ${update.latestVersion ?? ''}`}
              </p>
            </div>
          </div>
          <span className="version-badge">
            {update.latestVersion ?? 'New'}
          </span>
        </div>

        <div className="version-badges">
          <span className="row-meta">
            Installed: <strong>v{update.installedVersion}</strong>
          </span>
          {update.assetSizeBytes > 0 && (
            <span className="row-meta">
              APK Size: <strong>{formatBytes(update.assetSizeBytes)}</strong>
            </span>
          )}
        </div>

        <div className="changelog-box" tabIndex={0} aria-label="Release notes">
          {update.changelog ||
            'Includes latest network ad-blocking rules, stability improvements, and playback fixes.'}
        </div>

        {isDownloading && (
          <div className="panel-card" aria-live="polite">
            <div className="section-head">
              <span className="row-title">
                Downloading {update.assetName || 'update.apk'}...
              </span>
              <span className="shields-count">{update.progressPercent}%</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={update.progressPercent}
            >
              <div
                className="progress-fill"
                style={{ width: `${Math.max(4, update.progressPercent)}%` }}
              />
            </div>
            <span className="row-meta">
              {formatBytes(update.downloadedBytes)}
              {update.assetSizeBytes > 0
                ? ` / ${formatBytes(update.assetSizeBytes)}`
                : ''}
            </span>
          </div>
        )}

        {update.message &&
          (update.status === 'error' || isAwaitingPerm) && (
            <div
              className="status-banner"
              data-tone={update.status === 'error' ? 'blocked' : undefined}
              role="alert"
            >
              {update.message}
            </div>
          )}

        <div className="modal-actions">
          {isDownloading ? (
            <>
              <button
                ref={primaryBtnRef}
                type="button"
                className="secondary-btn"
                onClick={onCancelDownload}
              >
                Cancel Download
              </button>
              <button type="button" className="secondary-btn" onClick={onLater}>
                Hide
              </button>
            </>
          ) : isAwaitingPerm ? (
            <>
              <button
                ref={primaryBtnRef}
                type="button"
                className="primary-btn"
                onClick={onRetryInstall}
              >
                Retry Install
              </button>
              <button type="button" className="secondary-btn" onClick={onLater}>
                Later
              </button>
            </>
          ) : (
            <>
              <button
                ref={primaryBtnRef}
                type="button"
                className="primary-btn"
                onClick={onUpdateNow}
              >
                Update Now
              </button>
              <button type="button" className="secondary-btn" onClick={onLater}>
                Later
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
