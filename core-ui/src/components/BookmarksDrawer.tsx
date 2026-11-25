import React, { useState } from 'react';
import type { BookmarkItem } from '../adblock/types';

interface BookmarksDrawerProps {
  bookmarks: BookmarkItem[];
  currentUrl: string;
  currentTitle: string;
  onOpenBookmark: (url: string) => void;
  onAddBookmark: (title: string, url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onClose: () => void;
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({
  bookmarks,
  currentUrl,
  currentTitle,
  onOpenBookmark,
  onAddBookmark,
  onRemoveBookmark,
  onClose,
}) => {
  const [title, setTitle] = useState(
    currentUrl.startsWith('aegis://') ? '' : currentTitle
  );
  const [url, setUrl] = useState(
    currentUrl.startsWith('aegis://') ? '' : currentUrl
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAddBookmark(title.trim() || url.trim(), url.trim());
    setTitle('');
    setUrl('');
  };

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bookmarks-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="bookmarks-drawer-title" className="drawer-title">
            Bookmarks
          </h2>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <form className="panel-card" onSubmit={handleSave}>
          <span className="row-title">Save Bookmark</span>
          <label htmlFor="bm-title" className="sr-only">
            Bookmark Title
          </label>
          <input
            id="bm-title"
            className="text-input"
            placeholder="Title (e.g., Privacy News)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="bm-url" className="sr-only">
            Bookmark URL
          </label>
          <input
            id="bm-url"
            className="text-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="primary-btn">
            Save to Speed Dial
          </button>
        </form>

        <div className="list-stack">
          {bookmarks.map((bm) => (
            <div key={bm.id} className="row-item">
              <button
                type="button"
                className="row-item-main"
                onClick={() => {
                  onOpenBookmark(bm.url);
                  onClose();
                }}
              >
                <span className="row-title">{bm.title}</span>
                <span className="row-meta">{bm.url}</span>
              </button>
              <button
                type="button"
                className="secondary-btn"
                aria-label={`Delete bookmark ${bm.title}`}
                onClick={() => onRemoveBookmark(bm.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
