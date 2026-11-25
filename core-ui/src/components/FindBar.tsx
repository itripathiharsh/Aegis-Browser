import React, { useEffect, useRef } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from './BrowserIcons';
import { StopIcon } from './Icons';

interface FindBarProps {
  query: string;
  activeOrdinal: number;
  totalMatches: number;
  onQueryChange: (q: string) => void;
  onFindNext: (forward: boolean) => void;
  onClose: () => void;
}

export const FindBar: React.FC<FindBarProps> = ({
  query,
  activeOrdinal,
  totalMatches,
  onQueryChange,
  onFindNext,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="find-bar" role="search" aria-label="Find in page">
      <input
        ref={inputRef}
        type="text"
        className="find-bar-input"
        placeholder="Find in page..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onFindNext(!e.shiftKey);
          } else if (e.key === 'Escape') {
            onClose();
          }
        }}
      />
      <span className="find-bar-count" aria-live="polite">
        {query ? `${activeOrdinal}/${totalMatches}` : ''}
      </span>
      <button
        type="button"
        className="find-bar-btn"
        aria-label="Previous match"
        disabled={totalMatches === 0}
        onClick={() => onFindNext(false)}
      >
        <ChevronUpIcon size={16} />
      </button>
      <button
        type="button"
        className="find-bar-btn"
        aria-label="Next match"
        disabled={totalMatches === 0}
        onClick={() => onFindNext(true)}
      >
        <ChevronDownIcon size={16} />
      </button>
      <button
        type="button"
        className="find-bar-btn"
        aria-label="Close find bar"
        onClick={onClose}
      >
        <StopIcon size={16} />
      </button>
    </div>
  );
};
