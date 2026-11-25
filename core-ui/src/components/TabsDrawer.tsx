import React, { useMemo } from 'react';
import type { TabInfo } from '../adblock/types';
import { IncognitoIcon, UndoIcon } from './BrowserIcons';
import { PlusIcon, StopIcon } from './Icons';

interface TabsDrawerProps {
  tabs: TabInfo[];
  activeTabId: string;
  canReopenClosedTab: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onNewIncognitoTab: () => void;
  onReopenClosedTab: () => void;
  onAddTabToGroup: (sourceTabId: string) => void;
  onUngroupTab: (tabId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onToggleDesktopMode: (tab: TabInfo) => void;
  onClose: () => void;
}

type DrawerSection =
  | { kind: 'group'; groupId: string; title: string; color: string; tabs: TabInfo[] }
  | { kind: 'single'; tab: TabInfo };

export const TabsDrawer: React.FC<TabsDrawerProps> = ({
  tabs,
  activeTabId,
  canReopenClosedTab,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewIncognitoTab,
  onReopenClosedTab,
  onAddTabToGroup,
  onUngroupTab,
  onCloseGroup,
  onToggleDesktopMode,
  onClose,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const sections = useMemo<DrawerSection[]>(() => {
    const out: DrawerSection[] = [];
    const seenGroups = new Set<string>();

    for (const tab of tabs) {
      if (tab.groupId) {
        if (seenGroups.has(tab.groupId)) continue;
        seenGroups.add(tab.groupId);
        const groupTabs = tabs.filter((t) => t.groupId === tab.groupId);
        out.push({
          kind: 'group',
          groupId: tab.groupId,
          title: tab.groupTitle || 'Tab Group',
          color: tab.groupColor || '#3B82F6',
          tabs: groupTabs,
        });
      } else {
        out.push({ kind: 'single', tab });
      }
    }
    return out;
  }, [tabs]);

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
          <button type="button" className="secondary-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="tabs-action-bar">
          <button type="button" className="primary-btn" style={{ flex: 1 }} onClick={onNewTab}>
            <PlusIcon size={15} />
            <span>New Tab</span>
          </button>
          <button
            type="button"
            className="secondary-btn tabs-incognito-btn"
            onClick={onNewIncognitoTab}
          >
            <IncognitoIcon size={15} />
            <span>Incognito</span>
          </button>
        </div>

        {canReopenClosedTab && (
          <button
            type="button"
            className="panel-card reopen-tab-banner"
            onClick={() => {
              onReopenClosedTab();
              onClose();
            }}
          >
            <UndoIcon size={16} />
            <span>Reopen recently closed tab</span>
          </button>
        )}

        {activeTab && !activeTab.url.startsWith('aegis://') && (
          <div className="panel-card">
            <div className="toggle-row">
              <div>
                <div className="row-title">Desktop Site</div>
                <div className="row-meta">Request full desktop layout</div>
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
          {sections.map((section) => {
            if (section.kind === 'group') {
              return (
                <div
                  key={section.groupId}
                  className="tab-group-card"
                  style={{ '--group-accent': section.color } as React.CSSProperties}
                >
                  <div className="tab-group-card-head">
                    <span className="tab-group-card-title">
                      <span className="tab-group-dot" />
                      <span>
                        {section.title} ({section.tabs.length})
                      </span>
                    </span>
                    <div className="tab-group-card-actions">
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => {
                          onAddTabToGroup(section.tabs[0].id);
                          onClose();
                        }}
                      >
                        + Tab
                      </button>
                      <button
                        type="button"
                        className="text-link-btn"
                        style={{ color: 'var(--danger-text)' }}
                        onClick={() => onCloseGroup(section.groupId)}
                      >
                        Close all
                      </button>
                    </div>
                  </div>

                  <div className="list-stack">
                    {section.tabs.map((tab) => {
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
                            <span className="row-meta">{tab.url}</span>
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            title="Remove from group"
                            onClick={() => onUngroupTab(tab.id)}
                          >
                            Ungroup
                          </button>
                          <button
                            type="button"
                            className="icon-action-btn"
                            aria-label={`Close tab ${tab.title}`}
                            onClick={() => onCloseTab(tab.id)}
                          >
                            <StopIcon size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const tab = section.tab;
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className="row-item"
                data-active={isActive ? 'true' : 'false'}
                data-incognito={tab.incognito ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="row-item-main"
                  onClick={() => {
                    onSelectTab(tab.id);
                    onClose();
                  }}
                >
                  <span className="row-title">
                    {tab.incognito ? '🕵 ' : ''}
                    {tab.title || 'Untitled Tab'}
                  </span>
                  <span className="row-meta">
                    {tab.incognito ? 'Incognito • ' : ''}
                    {tab.url} • {tab.blockedCount} blocked
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  aria-label={`Close tab ${tab.title}`}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <StopIcon size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
