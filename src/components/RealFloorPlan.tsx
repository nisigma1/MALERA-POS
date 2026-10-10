import { FLOOR_PLAN_BY_CODE, FLOOR_VIEWBOX, type PhysicalSlot } from '../presentation/floorPlan';
import type { TableSummary } from '../domain/types';
import { TABLE_STATUS_LABELS } from '../domain/definitions';
import { formatMoney } from '../domain/money';
import { StatusBadge } from './ui';

function Seats({slot}: {slot:PhysicalSlot}) {
  if(slot.shape==='stool')return null;
  let seats: {x:number;y:number;rotation?:number}[];
  if(['M1','M2'].includes(slot.id))seats=[{x:40,y:-24,rotation:25},{x:40,y:24,rotation:-25}];
  else if(slot.id==='M3')seats=[{x:-40,y:-20},{x:40,y:-20},{x:0,y:48}];
  else if(['M11','T1'].includes(slot.id))seats=[{x:-42,y:0},{x:42,y:0}];
  else if(['M8','M9'].includes(slot.id))seats=[{x:-35,y:41},{x:35,y:41}];
  else if(slot.id==='M12')seats=[{x:-70,y:-31},{x:-70,y:31}];
  else if(slot.id==='M13')seats=[{x:-27,y:-36},{x:27,y:-36},{x:-27,y:36},{x:27,y:36}];
  else if(slot.shape==='round')seats=[{x:-48,y:-44,rotation:45},{x:48,y:-44,rotation:45},{x:-48,y:44,rotation:45},{x:48,y:44,rotation:45}];
  else seats=[{x:-slot.width/2-15,y:-slot.height*.27},{x:slot.width/2+15,y:-slot.height*.27},{x:-slot.width/2-15,y:slot.height*.27},{x:slot.width/2+15,y:slot.height*.27}];
  return <g fill="#a4ac9e" stroke="#465046" strokeWidth="2">{seats.map((seat,i)=><rect key={i} x="-11" y="-11" width="22" height="22" rx="3" transform={`translate(${seat.x} ${seat.y}) rotate(${seat.rotation??0})`}/>)}</g>;
}
export function RealFloorPlan({tables,selected,onSelect}: {tables:TableSummary[];selected?:string;onSelect:(id:string,button:HTMLButtonElement)=>void}) {
  return <section className="real-floor-plan" aria-label="Plani i konfirmuar i tavolinave FOX"><div className="floor-stage">
    <svg className="floor-scene" preserveAspectRatio="none" viewBox={`${FLOOR_VIEWBOX.x} ${FLOOR_VIEWBOX.y} ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}`} aria-hidden="true">
      {/* Original walls and openings share the same source coordinates as the tables. */}
      <path d="M118 327H1207V831H118Z" fill="#dbd6c9"/>
      <path d="M81 831H1266V1075H81Z" fill="#aeb5ad"/>
      <g fill="none" stroke="#354039" strokeWidth="5" strokeLinejoin="round">
        <path d="M118 831V327H1207V831H1266V1075H81V831H118"/>
        <path d="M118 705L240 831H713M785 831H1207"/>
        <path d="M703 341H282V431H703ZM791 327V341"/>
      </g>
      <path d="M282 341H703V431H282Z" fill="#c6aa7b" stroke="#655339" strokeWidth="3"/>
      <g fill="#848e80" stroke="#465046" strokeWidth="3">
        <path d="M132 342H263V411H190V605H132Z"/>
        <rect x="791" y="341" width="387" height="87" rx="7"/>
        <rect x="1111" y="637" width="75" height="170" rx="9"/>
      </g>
      <g fill="none" stroke="#465046" strokeWidth="2">
        <path d="M132 365H263M190 342V411M132 439H190M132 513H190M132 586H190M817 341V428M928 341V428M1038 341V428M1150 341V428M791 359H1178M1111 697H1186M1111 748H1186M1125 650H1172V794"/>
        <path d="M713 831V764A72 72 0 0 1 785 831"/>
      </g>
      <g fill="#dbd6c9" stroke="#354039" strokeWidth="3">{[88,256,445,636,850,1080,1260].map(x=><rect key={x} x={x-9} y="1065" width="18" height="20"/>)}</g>
    </svg>
      {Object.values(FLOOR_PLAN_BY_CODE).map(slot=><svg key={slot.id} className="floor-position-art" viewBox="-100 -100 200 200" aria-hidden="true" style={{left:`${(slot.x-FLOOR_VIEWBOX.x)/FLOOR_VIEWBOX.width*100}%`,top:`${(slot.y-FLOOR_VIEWBOX.y)/FLOOR_VIEWBOX.height*100}%`}}><g data-floor-shape={slot.id} transform={`rotate(${slot.rotation})`}>
        <Seats slot={slot}/>
        {slot.shape==='round' ? <ellipse rx={slot.width/2} ry={slot.height/2} fill="#c6aa7b" stroke="#655339" strokeWidth="3"/> : <rect x={-slot.width/2} y={-slot.height/2} width={slot.width} height={slot.height} rx={slot.shape==='stool'?10:2} fill="#c6aa7b" stroke="#655339" strokeWidth="3"/>}
      </g></svg>)}
    <span className="floor-bar-label" aria-hidden="true" style={{left:`${(493-FLOOR_VIEWBOX.x)/FLOOR_VIEWBOX.width*100}%`,top:`${(386-FLOOR_VIEWBOX.y)/FLOOR_VIEWBOX.height*100}%`}}>SHANKU</span>
    {tables.map(table=>{
      const slot=FLOOR_PLAN_BY_CODE[table.code]; if(!slot)return null;
      return <button key={table.id} type="button" className="position floor-table" data-table-code={table.code} data-status={table.status} data-shape={slot.shape} data-rotation={slot.rotation} aria-pressed={table.id===selected} aria-label={`${table.code}, ${TABLE_STATUS_LABELS[table.status]}${table.activeOrderTotalCents===null?'':`, ${formatMoney(table.activeOrderTotalCents)}`}`} style={{left:`${(slot.x-FLOOR_VIEWBOX.x)/FLOOR_VIEWBOX.width*100}%`,top:`${(slot.y-FLOOR_VIEWBOX.y)/FLOOR_VIEWBOX.height*100}%`,transform:`translate(-50%,-50%) rotate(${slot.rotation}deg)`}} onClick={event=>onSelect(table.id,event.currentTarget)}>
        <span className="floor-table-label" style={{transform:`rotate(${-slot.rotation}deg)`}}><strong>{table.code}</strong><StatusBadge tone={table.status==='ACTIVE'?'info':table.status==='FREE'?'success':'neutral'}>{TABLE_STATUS_LABELS[table.status]}</StatusBadge>
        {table.activeOrderTotalCents!==null&&<span className="position-total"><span>{formatMoney(table.activeOrderTotalCents).replace(' €','')}</span><span>€</span></span>}{!table.enabled&&<span className="sr-only">Joaktive</span>}</span>
      </button>;
    })}
  </div></section>;
}