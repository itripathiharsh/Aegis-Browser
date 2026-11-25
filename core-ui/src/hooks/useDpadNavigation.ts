import { useEffect } from 'react';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function findSpatialNextIndex(
  currentIndex: number,
  rects: RectBox[],
  dir: Direction
): number {
  const cur = rects[currentIndex];
  if (!cur) return currentIndex;
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;

  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < rects.length; i++) {
    if (i === currentIndex) continue;
    const r = rects[i];
    const rx = r.left + r.width / 2;
    const ry = r.top + r.height / 2;
    const dx = rx - cx;
    const dy = ry - cy;

    let primary = 0;
    let secondary = 0;
    if (dir === 'right') {
      if (dx <= 4) continue;
      primary = dx;
      secondary = Math.abs(dy);
    } else if (dir === 'left') {
      if (dx >= -4) continue;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (dir === 'down') {
      if (dy <= 4) continue;
      primary = dy;
      secondary = Math.abs(dx);
    } else {
      if (dy >= -4) continue;
      primary = -dy;
      secondary = Math.abs(dx);
    }

    // Strongly prefer items aligned along the navigation axis for predictable TV remote movement
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx >= 0 ? bestIdx : currentIndex;
}

interface UseDpadOptions {
  onBack: () => void;
  onExitDownToWebContent?: () => void;
}

export function useDpadNavigation({ onBack, onExitDownToWebContent }: UseDpadOptions) {
  useEffect(() => {
    const clearDpadMarker = () => {
      document
        .querySelectorAll('[data-dpad-focused="true"]')
        .forEach((el) => el.removeAttribute('data-dpad-focused'));
    };

    const getNavigableElements = (): HTMLElement[] => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const scopeRoot: ParentNode = dialog ?? document;
      const raw = Array.from(
        scopeRoot.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'
        )
      );
      return raw.filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.preventDefault();
        onBack();
        return;
      }

      const dirMap: Record<string, Direction | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const dir = dirMap[e.key];
      if (!dir) return;

      const active = document.activeElement as HTMLElement | null;
      if (active && active.tagName === 'INPUT') {
        const inputEl = active as HTMLInputElement;
        if (dir === 'left' && (inputEl.selectionStart ?? 0) > 0) return;
        if (
          dir === 'right' &&
          (inputEl.selectionEnd ?? 0) < inputEl.value.length
        ) {
          return;
        }
      }

      const items = getNavigableElements();
      if (items.length === 0) return;

      const curIndex = active ? items.indexOf(active) : -1;
      if (curIndex === -1) {
        e.preventDefault();
        items[0].focus();
        clearDpadMarker();
        items[0].setAttribute('data-dpad-focused', 'true');
        return;
      }

      const rects = items.map((el) => el.getBoundingClientRect());
      const nextIndex = findSpatialNextIndex(curIndex, rects, dir);

      if (
        nextIndex === curIndex &&
        dir === 'down' &&
        !document.querySelector('[role="dialog"]') &&
        onExitDownToWebContent
      ) {
        onExitDownToWebContent();
        return;
      }

      if (nextIndex !== curIndex) {
        e.preventDefault();
        clearDpadMarker();
        const target = items[nextIndex];
        target.focus();
        target.setAttribute('data-dpad-focused', 'true');
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    const onPointerDown = () => clearDpadMarker();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onBack, onExitDownToWebContent]);
}
