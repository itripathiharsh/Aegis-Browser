import React from 'react';
import { BookmarkToggleIcon, HistoryIcon } from './BrowserIcons';
import { SearchIcon } from './Icons';
import type { OmniboxSuggestion } from '../utils/suggestions';

interface SuggestionDropdownProps {
  suggestions: OmniboxSuggestion[];
  onSelect: (suggestion: OmniboxSuggestion) => void;
  onFill: (text: string) => void;
  variant?: 'topbar' | 'home';
}

export const SuggestionDropdown: React.FC<SuggestionDropdownProps> = ({
  suggestions,
  onSelect,
  onFill,
  variant = 'home',
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div
      className="suggestions-panel"
      data-variant={variant}
      role="listbox"
      aria-label="Search and history suggestions"
    >
      {suggestions.map((item) => (
        <div key={item.id} className="suggestion-row">
          <button
            type="button"
            className="suggestion-main"
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item)}
          >
            <span className="suggestion-icon" data-kind={item.kind}>
              {item.kind === 'search' ? (
                <SearchIcon size={15} />
              ) : item.kind === 'bookmark' ? (
                <BookmarkToggleIcon size={15} filled />
              ) : (
                <HistoryIcon size={15} />
              )}
            </span>
            <span className="suggestion-text">
              <span className="suggestion-title">{item.title}</span>
              <span className="suggestion-subtitle">{item.subtitle}</span>
            </span>
          </button>
          <button
            type="button"
            className="suggestion-fill-btn"
            aria-label={`Insert ${item.title} into search box`}
            title="Fill search bar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFill(item.fillText)}
          >
            ↖
          </button>
        </div>
      ))}
    </div>
  );
};
