import { describe, expect, it } from 'vitest';
import { findSpatialNextIndex, type RectBox } from './useDpadNavigation';

describe('findSpatialNextIndex (D-Pad TV Remote spatial nav)', () => {
  const layout: RectBox[] = [
    { left: 20, top: 20, width: 100, height: 48 },   // 0: Back
    { left: 140, top: 20, width: 320, height: 48 },  // 1: Omnibox
    { left: 480, top: 20, width: 120, height: 48 },  // 2: Shields
    { left: 20, top: 140, width: 220, height: 96 },  // 3: Bookmark 1
    { left: 260, top: 140, width: 220, height: 96 }, // 4: Bookmark 2
  ];

  it('navigates horizontally and vertically to the nearest aligned focusable control', () => {
    expect(findSpatialNextIndex(0, layout, 'right')).toBe(1);
    expect(findSpatialNextIndex(1, layout, 'right')).toBe(2);
    expect(findSpatialNextIndex(2, layout, 'left')).toBe(1);
    expect(findSpatialNextIndex(0, layout, 'down')).toBe(3);
    expect(findSpatialNextIndex(1, layout, 'down')).toBe(4);
    expect(findSpatialNextIndex(4, layout, 'up')).toBe(1);
  });

  it('stays on boundary control when no control exists in direction', () => {
    expect(findSpatialNextIndex(0, layout, 'left')).toBe(0);
    expect(findSpatialNextIndex(3, layout, 'down')).toBe(3);
  });
});
