import React from 'react';
import type { TabInfo } from '../adblock/types';

interface TabsDrawerProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onToggleDesktopMode: (tab: TabInfo) => void;
  onClose: () => void;
}

export const TabsDrawer: React.FC<TabsDrawerProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleDesktopMode,
  onClose,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tabs-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="tabs-drawer-title" className="drawer-title">
            Tabs ({tabs.length})
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="primary-btn" onClick={onNewTab}>
              + New Tab
            </button>
            <button type="button" className="secondary-btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        {activeTab && !activeTab.url.startsWith('aegis://') && (
          <div className="panel-card">
              <div className="toggle-row">
                <div>
                  <div className="row-title">Desktop Site</div>
                  <div className="row-meta">Request desktop pages</div>
                </div>
                <button
                  type="button"
                  className="toggle-switch"
                  aria-label="Toggle Desktop Site"
                  aria-pressed={activeTab.desktopMode}
                  onClick={() => onToggleDesktopMode(activeTab)}
                />
              </div>
          </div>
        )}

        <div className="list-stack">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className="row-item"
                data-active={isActive ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="row-item-main"
                  onClick={() => {
                    onSelectTab(tab.id);
                    onClose();
                  }}
                >
                  <span className="row-title">{tab.title || 'Untitled Tab'}</span>
                  <span className="row-meta">
                    {tab.url} • {tab.blockedCount} blocked
                  </span>
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  aria-label={`Close tab ${tab.title}`}
                  onClick={() => onCloseTab(tab.id)}
                >
                  Close
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
