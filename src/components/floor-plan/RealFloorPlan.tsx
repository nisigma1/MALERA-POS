import { tableDisplayCode } from '../../presentation/tableIdentity';
import { FLOOR_PLAN_BY_CODE, FLOOR_VIEWBOX, type PhysicalSlot } from '../../presentation/floorPlan';
import type { TableSummary } from '../../domain/types';
import { TABLE_STATUS_LABELS } from '../../domain/definitions';
import { formatMoney } from '../../domain/money';
import { StatusBadge } from '../common/Controls';
import { FloorArtwork, FloorTile } from './FloorArtwork';
import { ReferenceFloorBackdrop } from './ReferenceFloorBackdrop';
import { REFERENCE_TABLES, referenceTableStyle } from '../../presentation/referenceFloor';

function Seats({ slot }: { slot: PhysicalSlot }) {
  if (slot.shape === 'stool') return null;
  const parallelSeats = ['M6', 'M7', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].includes(slot.id);
  let seats: { x: number; y: number }[];
  if (['M1', 'M2'].includes(slot.id))
    seats = [
      { x: 40, y: -24 },
      { x: 40, y: 24 },
    ];
  else if (slot.id === 'M3')
    seats = [
      { x: -40, y: -20 },
      { x: 40, y: -20 },
      { x: 0, y: 48 },
    ];
  else if (['M11', 'T1'].includes(slot.id))
    seats = [
      { x: -42, y: 0 },
      { x: 42, y: 0 },
    ];
  else if (['M8', 'M9'].includes(slot.id))
    seats = [
      { x: -35, y: 41 },
      { x: 35, y: 41 },
    ];
  else if (slot.id === 'M12')
    seats = [
      { x: -70, y: -31 },
      { x: -70, y: 31 },
    ];
  else if (slot.id === 'M13')
    seats = [
      { x: -27, y: -36 },
      { x: 27, y: -36 },
      { x: -27, y: 36 },
      { x: 27, y: 36 },
    ];
  else if (parallelSeats)
    seats = [
      { x: -20, y: -39 },
      { x: 20, y: -39 },
      { x: -20, y: 39 },
      { x: 20, y: 39 },
    ];
  else if (slot.shape === 'round') {
    // Keep a small, consistent gap between each diagonal chair and the table edge.
    const offset = (Math.max(slot.width, slot.height) / 2 + 14) / Math.SQRT2;
    seats = [
      { x: -offset, y: -offset },
      { x: offset, y: -offset },
      { x: -offset, y: offset },
      { x: offset, y: offset },
    ];
  } else
    seats = [
      { x: -slot.width / 2 - 15, y: -slot.height * 0.27 },
      { x: slot.width / 2 + 15, y: -slot.height * 0.27 },
      { x: -slot.width / 2 - 15, y: slot.height * 0.27 },
      { x: slot.width / 2 + 15, y: slot.height * 0.27 },
    ];
  return (
    <g>
      {seats.map((seat, i) => {
        const facing =
          parallelSeats || slot.id === 'M8' || slot.id === 'M9'
            ? seat.y > 0
              ? 0
              : 180
            : (Math.atan2(seat.y, seat.x) * 180) / Math.PI - 90;
        return (
          <g key={i} transform={'translate(' + seat.x + ' ' + seat.y + ') rotate(' + facing + ')'}>
            <FloorTile name="chair" x={-17} y={-15} width={34} height={30} />
          </g>
        );
      })}
    </g>
  );
}
export function RealFloorPlan({
  tables,
  selected,
  onSelect,
  disabled = false,
}: {
  tables: TableSummary[];
  selected?: string;
  onSelect: (id: string, button: HTMLButtonElement) => void;
  disabled?: boolean;
}) {
  return (
    <section className="real-floor-plan" aria-label="Plani i tavolinave të lokalit">
      <div className="floor-stage">
        <FloorArtwork />
        <ReferenceFloorBackdrop />
        {Object.values(FLOOR_PLAN_BY_CODE).map((slot) => (
          <svg
            key={slot.id}
            className="floor-position-art"
            viewBox="-100 -100 200 200"
            aria-hidden="true"
            style={{
              left: `${((slot.x - FLOOR_VIEWBOX.x) / FLOOR_VIEWBOX.width) * 100}%`,
              top: `${((slot.y - FLOOR_VIEWBOX.y) / FLOOR_VIEWBOX.height) * 100}%`,
            }}
          >
            <g data-floor-shape={slot.id} transform={`rotate(${slot.rotation})`}>
              {slot.shape === 'stool' && (
                <FloorTile name="stool" x={-28} y={26} width={56} height={24} />
              )}
              {(slot.id === 'M12' || slot.id === 'M13') && (
                <FloorTile
                  name="wood"
                  x={-slot.width / 2}
                  y={-slot.height / 2}
                  width={slot.width}
                  height={slot.height}
                />
              )}
              <Seats slot={slot} />
            </g>
          </svg>
        ))}
        {tables.map((table) => {
          const slot = FLOOR_PLAN_BY_CODE[table.code];
          if (!slot) return null;
          // The diagonal furniture remains rotated; its compact upright target keeps totals readable.
          const targetRotation = table.code === 'M13' ? 0 : slot.rotation;
          return (
            <button
              key={table.id}
              type="button"
              disabled={disabled}
              className="position floor-table"
              data-reference-table={Boolean(REFERENCE_TABLES[table.code]) || undefined}
              data-table-code={table.code}
              data-display-code={tableDisplayCode(table.code)}
              data-status={table.status}
              data-shape={slot.shape}
              data-rotation={slot.rotation}
              aria-pressed={table.id === selected}
              aria-label={`${tableDisplayCode(table.code)}, ${TABLE_STATUS_LABELS[table.status]}${table.activeOrderTotalCents === null ? '' : `, ${formatMoney(table.activeOrderTotalCents)}`}`}
              style={referenceTableStyle(slot, targetRotation)}
              onClick={(event) => onSelect(table.id, event.currentTarget)}
            >
              <span
                className="floor-table-label"
                style={{ transform: `rotate(${-targetRotation}deg)` }}
              >
                <strong>{tableDisplayCode(table.code)}</strong>
                <StatusBadge
                  dot={false}
                  tone={
                    table.status === 'ACTIVE'
                      ? 'info'
                      : table.status === 'RESERVED'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {TABLE_STATUS_LABELS[table.status]}
                </StatusBadge>
                {table.activeOrderTotalCents !== null && (
                  <span className="position-total">
                    <span>{formatMoney(table.activeOrderTotalCents).replace(' €', '')}</span>{' '}
                    <span>€</span>
                  </span>
                )}
                {table.status === 'RESERVED' && (
                  <span className="position-reserved">Rezervuar</span>
                )}
                {!table.enabled && <span className="sr-only">Joaktive</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
