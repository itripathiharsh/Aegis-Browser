import React, { useMemo, useState } from 'react';
import type { HistoryEntry } from '../adblock/types';
import { TrashIcon } from './BrowserIcons';

interface HistoryDrawerProps {
  entries: HistoryEntry[];
  saveHistoryEnabled: boolean;
  onNavigate: (url: string) => void;
  onDeleteItem: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function formatVisitedAt(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getBucketLabel(ms: number): 'Today' | 'Yesterday' | 'Earlier' {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 86_400_000;
  if (ms >= todayMs) return 'Today';
  if (ms >= yesterdayMs) return 'Yesterday';
  return 'Earlier';
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  entries,
  saveHistoryEnabled,
  onNavigate,
  onDeleteItem,
  onClearAll,
  onClose,
}) => {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.host.toLowerCase().includes(q) ||
            e.url.toLowerCase().includes(q)
        )
      : entries;

    const buckets: Array<{ label: string; items: HistoryEntry[] }> = [];
    for (const item of filtered) {
      const label = getBucketLabel(item.visitedAtMs);
      const last = buckets[buckets.length - 1];
      if (!last || last.label !== label) {
        buckets.push({ label, items: [item] });
      } else {
        last.items.push(item);
      }
    }
    return buckets;
  }, [entries, query]);

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="history-drawer-title" className="drawer-title">
            History ({entries.length})
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {entries.length > 0 && (
              <button type="button" className="danger-btn" onClick={onClearAll}>
                Clear All
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        {!saveHistoryEnabled && (
          <div className="panel-card notice-banner">
            History recording is paused in Settings. Existing items stay here until cleared.
          </div>
        )}

        <div className="drawer-search-wrap">
          <input
            type="search"
            className="drawer-search-input"
            placeholder="Search visited sites or URLs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search browsing history"
          />
        </div>

        {grouped.length === 0 ? (
          <div className="panel-card empty-state-card">
            <div className="row-title">
              {entries.length === 0 ? 'No browsing history yet' : 'No matching history entries'}
            </div>
            <div className="row-meta">
              {entries.length === 0
                ? 'Pages you visit appear here automatically and train Start page Recommendations.'
                : 'Try a different keyword or domain.'}
            </div>
          </div>
        ) : (
          <div className="history-groups">
            {grouped.map((group) => (
              <div key={group.label} className="history-group">
                <div className="history-group-label">{group.label}</div>
                <div className="list-stack">
                  {group.items.map((item) => (
                    <div key={item.id} className="row-item">
                      <button
                        type="button"
                        className="row-item-main"
                        onClick={() => {
                          onNavigate(item.url);
                          onClose();
                        }}
                      >
                        <span className="row-title">{item.title || item.host}</span>
                        <span className="row-meta">
                          {item.host} • {formatVisitedAt(item.visitedAtMs)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        aria-label={`Delete ${item.title || item.host} from history`}
                        onClick={() => onDeleteItem(item.id)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
