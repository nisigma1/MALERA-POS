import { useId } from 'react';
import indoor from '../assets/duo-reference-interior.png';
import terrace from '../assets/duo-reference-terrace.png';
import { REFERENCE_FLOOR_FRAME, REFERENCE_TABLES } from '../presentation/referenceFloor';

export function ReferenceFloorBackdrop() {
  const { x, y, width, height } = REFERENCE_FLOOR_FRAME;
  const id = useId();
  const detail = id + '-detail';
  const tabletop = id + '-tabletop';
  const interior = id + '-interior';
  const b5Rim = id + '-b5-rim';
  const [b4X, b4Y, b4Width] = REFERENCE_TABLES.M4!;
  const [b5X, b5Y, b5Width] = REFERENCE_TABLES.M5!;
  const b5Scale = b5Width / b4Width;

  return <svg className="floor-reference-art" viewBox={[0,0,width,height].join(' ')}
    preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <filter id={detail} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feConvolveMatrix order="3" kernelMatrix="0 -.14 0 -.14 1.56 -.14 0 -.14 0"
          edgeMode="duplicate" preserveAlpha="true"/>
      </filter>
      <clipPath id={b5Rim}>
        <circle cx={b5X-x} cy={b5Y-y} r={b5Width/2+.75}/>
      </clipPath>
      <radialGradient id={tabletop}>
        <stop offset="0" stopColor="#1a1a1c"/>
        <stop offset=".65" stopColor="#19191b"/>
        <stop offset="1" stopColor="#19191b" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <g filter={`url(#${detail})`}>
      <image id={interior} href={indoor} x="0" y="0" width={width} height="519"/>
      <image href={terrace} x="0" y="519" width={width} height="264"/>
      {/* Match B4's rim, clipped to the original B5 tabletop. */}
      <g clipPath={`url(#${b5Rim})`}>
        <use href={`#${interior}`}
          transform={`translate(${b5X-x} ${b5Y-y}) scale(${b5Scale}) translate(${x-b4X} ${y-b4Y})`}/>
      </g>
    </g>
    {/* Mask the old raster label marks within each tabletop's original face. */}
    <g fill={`url(#${tabletop})`}>
      {Object.entries(REFERENCE_TABLES).map(([code,[cx,cy,w,h]]) =>
        <ellipse key={code} cx={cx-x} cy={cy-y} rx={w*.4} ry={h*.38}/>)}
    </g>
  </svg>;
}
