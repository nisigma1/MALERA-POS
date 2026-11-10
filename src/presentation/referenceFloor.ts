import type { CSSProperties } from 'react';
import { FLOOR_VIEWBOX, type PhysicalSlot } from './floorPlan';

export const REFERENCE_FLOOR_FRAME = { x: 295, y: 108, width: 890, height: 783 } as const;

// Centers and visible footprints in the supplied 1672 × 941 image.
// These offsets are applied only in the reference view. Table IDs and the base plan stay authoritative.
export const REFERENCE_TABLES: Readonly<Record<string, readonly [number, number, number, number]>> =
  {
    M1: [388.5, 263.5, 63, 63],
    M2: [388.5, 355.5, 63, 63],
    M3: [386.5, 465, 64, 64],
    M4: [541.5, 399.5, 69, 69],
    M5: [716, 399.5, 72, 72],
    M6: [534, 553, 78, 55],
    M7: [716.5, 553, 79, 56],
    M8: [941, 257.5, 64, 53],
    M9: [1100, 257.5, 64, 53],
    M10: [909.5, 405.5, 69, 69],
    M11: [1095.5, 382, 79, 57],
    M12: [1065.5, 519.5, 65, 53],
    M13: [350.5, 599, 63, 56],
    SH1: [501, 254, 54, 49],
    SH2: [592, 255, 55, 50],
    SH3: [685, 255, 55, 50],
    SH4: [779, 255, 55, 50],
    T1: [1002, 653, 72, 55],
    T2: [465, 722.5, 67, 67],
    T3: [751.5, 723, 67, 67],
    T4: [1019, 722, 67, 67],
    T5: [355, 834, 74, 52],
    T6: [507, 834, 75, 52],
    T7: [658.5, 834, 75, 52],
    T8: [815, 834.5, 75, 52],
    T9: [968, 834.5, 76, 52],
    T10: [1127, 834.5, 77, 52],
  };

export function referenceTableStyle(slot: PhysicalSlot, targetRotation: number): CSSProperties {
  const left = ((slot.x - FLOOR_VIEWBOX.x) / FLOOR_VIEWBOX.width) * 100;
  const top = ((slot.y - FLOOR_VIEWBOX.y) / FLOOR_VIEWBOX.height) * 100;
  const style = {
    left: left + '%',
    top: top + '%',
    transform: 'translate(-50%,-50%) rotate(' + targetRotation + 'deg)',
  };
  const face = REFERENCE_TABLES[slot.id];
  if (!face) return style;
  const [cx, cy, width, height] = face;
  const frame = REFERENCE_FLOOR_FRAME;
  return {
    ...style,
    '--reference-shift-x': ((cx - frame.x) / frame.width) * 100 - left + 'cqw',
    '--reference-shift-y': ((cy - frame.y) / frame.height) * 100 - top + 'cqh',
    '--reference-face-width': (width / frame.width) * 100 + 'cqw',
    '--reference-face-height': (height / frame.height) * 100 + 'cqh',
  } as CSSProperties;
}
