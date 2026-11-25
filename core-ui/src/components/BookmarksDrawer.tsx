import React, { useMemo, useState } from 'react';
import type { BookmarkItem, SearchEngineId } from '../adblock/types';
import { resolveOmniboxInput } from '../utils/urlResolver';
import { BookmarkToggleIcon, TrashIcon } from './BrowserIcons';
import { PlusIcon } from './Icons';

interface BookmarksDrawerProps {
  bookmarks: BookmarkItem[];
  currentUrl: string;
  currentTitle: string;
  searchEngine?: SearchEngineId;
  onOpenBookmark: (url: string) => void;
  onAddBookmark: (title: string, url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onClose: () => void;
}

function formatHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({
  bookmarks,
  currentUrl,
  currentTitle,
  searchEngine = 'duckduckgo',
  onOpenBookmark,
  onAddBookmark,
  onRemoveBookmark,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const isRealPage =
    currentUrl.startsWith('http://') || currentUrl.startsWith('https://');
  const currentAlreadyBookmarked = bookmarks.some((b) => b.url === currentUrl);

  const visibleBookmarks = useMemo(() => {
    const clean = bookmarks.filter(
      (b) => !b.url.startsWith('nivrok://player') && !b.url.startsWith('aegis://player')
    );
    const q = query.trim().toLowerCase();
    if (!q) return clean;
    return clean.filter(
      (b) =>
        b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    );
  }, [bookmarks, query]);

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const normalizedUrl = resolveOmniboxInput(url.trim(), searchEngine);
    onAddBookmark(title.trim() || formatHost(normalizedUrl), normalizedUrl);
    setTitle('');
    setUrl('');
    setShowManualForm(false);
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
            Bookmarks ({visibleBookmarks.length})
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="secondary-btn"
              aria-expanded={showManualForm}
              onClick={() => setShowManualForm((prev) => !prev)}
            >
              <PlusIcon size={14} />
              <span>{showManualForm ? 'Close' : 'Add'}</span>
            </button>
            <button type="button" className="secondary-btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        {isRealPage && !currentAlreadyBookmarked && (
          <button
            type="button"
            className="panel-card bookmark-current-btn"
            onClick={() =>
              onAddBookmark(currentTitle || formatHost(currentUrl), currentUrl)
            }
          >
            <span className="bookmark-current-icon">
              <BookmarkToggleIcon size={16} />
            </span>
            <span className="bookmark-current-copy">
              <span className="row-title">Bookmark current page</span>
              <span className="row-meta">{currentTitle || formatHost(currentUrl)}</span>
            </span>
          </button>
        )}

        {showManualForm && (
          <form className="panel-card" onSubmit={handleSaveManual}>
            <label htmlFor="bm-title" className="sr-only">
              Site Name
            </label>
            <input
              id="bm-title"
              className="text-input"
              placeholder="Name (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label htmlFor="bm-url" className="sr-only">
              Website URL
            </label>
            <input
              id="bm-url"
              className="text-input"
              placeholder="Website URL (e.g., github.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <button type="submit" className="primary-btn">
              Add Bookmark
            </button>
          </form>
        )}

        {bookmarks.length > 3 && (
          <div className="drawer-search-wrap">
            <input
              type="search"
              className="drawer-search-input"
              placeholder="Search bookmarks..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search bookmarks"
            />
          </div>
        )}

        {visibleBookmarks.length === 0 ? (
          <div className="panel-card empty-state-card">
            <div className="row-title">No bookmarks yet</div>
            <div className="row-meta">
              Tap the bookmark icon in the address bar on any webpage to save it here.
            </div>
          </div>
        ) : (
          <div className="list-stack">
            {visibleBookmarks.map((bm) => (
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
                  <span className="row-meta">{formatHost(bm.url)}</span>
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  aria-label={`Delete bookmark ${bm.title}`}
                  onClick={() => onRemoveBookmark(bm.id)}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
