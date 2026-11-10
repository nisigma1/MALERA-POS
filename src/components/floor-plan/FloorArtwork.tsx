import { useId } from 'react';
import atlas from '../../assets/duo-floor-atlas.png';
import { FLOOR_VIEWBOX } from '../../presentation/floorPlan';

// The atlas contains only material and furniture crops from the supplied reference.
const tiles = {
  stone: [0, 0, 215, 102],
  terrace: [220, 0, 107, 148],
  bar: [332, 0, 415, 108],
  sofaTop: [128, 152, 298, 91],
  sofaRight: [430, 152, 73, 180],
  chair: [508, 152, 29, 23],
  stool: [542, 152, 43, 19],
  light: [589, 152, 27, 31],
  potLeft: [620, 152, 44, 69],
  potRight: [668, 152, 40, 69],
  potInside: [712, 152, 39, 48],
  lightCorner: [755, 152, 30, 38],
  wood: [789, 152, 60, 49],
  sofaLeftCap: [0, 152, 124, 74],
  sofaLeftSide: [0, 229, 54, 209],
} as const;

export function FloorTile({
  name,
  x,
  y,
  width,
  height,
}: {
  name: keyof typeof tiles;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={tiles[name].join(' ')}
      preserveAspectRatio="none"
      overflow="hidden"
    >
      <image href={atlas} width="860" height="440" />
    </svg>
  );
}

const inside = 'M81 327H1266V831H81Z';
const outside = 'M81 831H1266V1075H81Z';
const perimeter = 'M81 327H1266V1075H81Z';
const divider = 'M81 705L240 831H713M785 831H1266';
const door = 'M713 831V764A72 72 0 0 1 785 831';

function StonePattern({
  id,
  name,
  width,
  height,
}: {
  id: string;
  name: 'terrace';
  width: number;
  height: number;
}) {
  const tile = <FloorTile name={name} x={0} y={0} width={width} height={height} />;
  return (
    <pattern id={id} width={width * 2} height={height * 2} patternUnits="userSpaceOnUse">
      {tile}
      <g transform={'translate(' + width * 2 + ' 0) scale(-1 1)'}>{tile}</g>
      <g transform={'translate(0 ' + height * 2 + ') scale(1 -1)'}>{tile}</g>
      <g transform={'translate(' + width * 2 + ' ' + height * 2 + ') scale(-1 -1)'}>{tile}</g>
    </pattern>
  );
}

export function FloorArtwork() {
  const id = useId();
  const terrace = id + '-terrace';
  const edgeShade = id + '-edges';
  const leftSeat = id + '-left-seat';
  const { x, y, width, height } = FLOOR_VIEWBOX;

  return (
    <svg
      className="floor-scene"
      preserveAspectRatio="none"
      viewBox={[x, y, width, height].join(' ')}
      aria-hidden="true"
    >
      <defs>
        <StonePattern id={terrace} name="terrace" width={147} height={210} />
        <radialGradient id={edgeShade} cx=".54" cy=".48" r=".76">
          <stop offset=".50" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".48" />
        </radialGradient>
        <clipPath id={leftSeat}>
          <path d="M88 341H247V413H160V606H88Z" />
        </clipPath>
      </defs>

      {/* Walls, openings and the deck share the original floor coordinates. */}
      <FloorTile name="stone" x={81} y={327} width={1185} height={504} />
      <path d={outside} fill={'url(#' + terrace + ')'} />
      <path d={inside} fill={'url(#' + edgeShade + ')'} />
      <path d={outside} fill={'url(#' + edgeShade + ')'} />
      <path d={perimeter} fill="none" stroke="#08090c" strokeWidth="10" strokeLinejoin="round" />
      <path d={perimeter} fill="none" stroke="#62636a" strokeWidth="3" strokeLinejoin="round" />

      <g clipPath={'url(#' + leftSeat + ')'}>
        <FloorTile name="sofaLeftSide" x={88} y={403} width={72} height={204} />
        <FloorTile name="sofaLeftCap" x={88} y={341} width={160} height={74} />
      </g>
      <FloorTile name="bar" x={273} y={329} width={532} height={105} />
      <FloorTile name="sofaTop" x={850} y={339} width={391} height={92} />
      <FloorTile name="sofaRight" x={1157} y={635} width={97} height={175} />
      <FloorTile name="potInside" x={1205} y={439} width={56} height={53} />
      <FloorTile name="lightCorner" x={83} y={726} width={39} height={43} />

      <path d={divider} fill="none" stroke="#dddcd6" strokeWidth="2.5" />
      <path d={door} fill="none" stroke="#dddcd6" strokeWidth="2" />
      <FloorTile name="potLeft" x={83} y={916} width={62} height={73} />
      <FloorTile name="potRight" x={1209} y={915} width={54} height={74} />
      {[88, 256, 445, 636, 850, 1080, 1260].map((px) => (
        <FloorTile key={px} name="light" x={px - 13} y={1052} width={27} height={32} />
      ))}
    </svg>
  );
}
