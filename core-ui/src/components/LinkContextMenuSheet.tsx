import React from 'react';
import type { PendingContextMenu } from '../adblock/types';
import {
  CopyIcon,
  DownloadIcon,
  IncognitoIcon,
  ShareIcon,
  TabGroupIcon,
} from './BrowserIcons';
import { PlusIcon } from './Icons';

interface LinkContextMenuSheetProps {
  menu: PendingContextMenu;
  onOpenNewTab: (url: string) => void;
  onOpenInGroup: (sourceTabId: string, url: string) => void;
  onOpenIncognito: (url: string) => void;
  onCopyLink: (url: string) => void;
  onShareLink: (url: string, title?: string) => void;
  onDownload: (url: string) => void;
  onDismiss: () => void;
}

function summarizeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

export const LinkContextMenuSheet: React.FC<LinkContextMenuSheetProps> = ({
  menu,
  onOpenNewTab,
  onOpenInGroup,
  onOpenIncognito,
  onCopyLink,
  onShareLink,
  onDownload,
  onDismiss,
}) => {
  const primaryUrl = menu.linkUrl || menu.imageUrl;
  if (!primaryUrl) return null;

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Link actions"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="bottom-sheet">
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-url-header">
          {menu.title && <div className="sheet-url-title">{menu.title}</div>}
          <div className="sheet-url-sub">{summarizeTarget(primaryUrl)}</div>
        </div>

        <div className="sheet-actions">
          {menu.linkUrl && (
            <>
              <button
                type="button"
                className="sheet-action-btn"
                onClick={() => {
                  onOpenNewTab(menu.linkUrl!);
                  onDismiss();
                }}
              >
                <PlusIcon size={18} />
                <span>Open in new tab</span>
              </button>

              <button
                type="button"
                className="sheet-action-btn"
                onClick={() => {
                  onOpenInGroup(menu.tabId, menu.linkUrl!);
                  onDismiss();
                }}
              >
                <TabGroupIcon size={18} />
                <span>Open in new tab in group</span>
              </button>

              <button
                type="button"
                className="sheet-action-btn"
                onClick={() => {
                  onOpenIncognito(menu.linkUrl!);
                  onDismiss();
                }}
              >
                <IncognitoIcon size={18} />
                <span>Open in Incognito tab</span>
              </button>
            </>
          )}

          <button
            type="button"
            className="sheet-action-btn"
            onClick={() => {
              onCopyLink(primaryUrl);
              onDismiss();
            }}
          >
            <CopyIcon size={18} />
            <span>{menu.linkUrl ? 'Copy link address' : 'Copy image address'}</span>
          </button>

          <button
            type="button"
            className="sheet-action-btn"
            onClick={() => {
              onShareLink(primaryUrl, menu.title ?? undefined);
              onDismiss();
            }}
          >
            <ShareIcon size={18} />
            <span>Share link</span>
          </button>

          {menu.imageUrl && (
            <button
              type="button"
              className="sheet-action-btn"
              onClick={() => {
                onDownload(menu.imageUrl!);
                onDismiss();
              }}
            >
              <DownloadIcon size={18} />
              <span>Download image</span>
            </button>
          )}

          {menu.linkUrl && (
            <button
              type="button"
              className="sheet-action-btn"
              onClick={() => {
                onDownload(menu.linkUrl!);
                onDismiss();
              }}
            >
              <DownloadIcon size={18} />
              <span>Download link</span>
            </button>
          )}
        </div>

        <button type="button" className="sheet-cancel-btn" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </div>
  );
};
