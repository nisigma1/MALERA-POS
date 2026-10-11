// Coordinates traced from docs/references/fox-original-floor-plan.png.
// Physical slot IDs are review annotations, never DB codes or order identifiers.
export type PhysicalSlot = {
  id: string; area: 'MAIN' | 'BAR' | 'TERRACE'; x: number; y: number;
  width: number; height: number; shape: 'round' | 'rect' | 'stool'; rotation: number;
};
const slot = (id: string, area: PhysicalSlot['area'], x: number, y: number, width: number, height: number, shape: PhysicalSlot['shape'], rotation = 0): PhysicalSlot => ({ id, area, x, y, width, height, shape, rotation });
export const PHYSICAL_SLOTS: readonly PhysicalSlot[] = [
  slot('B01','MAIN',226,469,60,60,'round'),
  slot('B02','MAIN',226,558,60,60,'round'),
  slot('B03','MAIN',204,668,60,60,'round'),
  slot('B04','MAIN',405,600,75,75,'round'),
  slot('B05','MAIN',613,600,75,75,'round'),
  slot('B06','MAIN',400,763,46,63,'rect'),
  slot('B07','MAIN',608,763,47,65,'rect'),
  slot('B08','MAIN',875,462,69,46,'rect'),
  slot('B09','MAIN',1084,462,69,46,'rect'),
  slot('B10','MAIN',865,610,64,64,'round'),
  slot('B11','MAIN',1075,585,50,50,'round'),
  slot('B12','MAIN',1062,724,71,109,'rect'),
  slot('R11','TERRACE',150,890,100,42,'rect',45),
  ...[354,457,561,666].map((x,i) => slot(`S0${i+1}`,'BAR',x,455,46,32,'stool')),
  slot('R01','TERRACE',995,858,44,44,'round'),
  slot('R02','TERRACE',315,945,65,65,'round'),
  slot('R03','TERRACE',672,945,65,65,'round'),
  slot('R04','TERRACE',1027,945,65,65,'round'),
  ...[148,351,550,758,965,1199].map((x,i) => slot(`R${String(i+5).padStart(2,'0')}`,'TERRACE',x,1040,35,49,'rect')),
];
export const CANONICAL_FLOOR_CODES = [
  ...Array.from({length:13},(_,i)=>`M${i+1}`),
  ...Array.from({length:4},(_,i)=>`SH${i+1}`),
  ...Array.from({length:10},(_,i)=>`T${i+1}`),
] as const;
// Original sketch geometry + the owner's explicit official numbering in Prompt 3.6D.
// Presentation only: no coordinates or physical review IDs enter order/database logic.
export const FLOOR_VIEWBOX = { x: 72, y: 315, width: 1204, height: 780 } as const;
const officialPhysicalIds: Readonly<Record<string,string>> = {
  M1:'B01',M2:'B02',M3:'B03',M4:'B04',M5:'B05',M6:'B06',M7:'B07',
  M8:'B08',M9:'B09',M10:'B10',M11:'B11',M12:'B12',M13:'R11',
  SH1:'S01',SH2:'S02',SH3:'S03',SH4:'S04',
  T1:'R01',T2:'R02',T3:'R03',T4:'R04',T5:'R05',T6:'R06',T7:'R07',T8:'R08',T9:'R09',T10:'R10',
};
export const FLOOR_PLAN_BY_CODE: Readonly<Record<string, PhysicalSlot & {physicalSlotId:string}>> = Object.fromEntries(CANONICAL_FLOOR_CODES.map(code=>{
  const physicalSlotId=officialPhysicalIds[code];
  const physical=PHYSICAL_SLOTS.find(item=>item.id===physicalSlotId);
  if(!physicalSlotId||!physical)throw new Error(`Missing confirmed physical slot for ${code}`);
  return [code,{...physical,id:code,physicalSlotId}];
}));
export const FLOOR_MAPPING_CONFIDENCE: Readonly<Record<string, 'CONFIRMED' | 'AMBIGUOUS'>> = Object.fromEntries(CANONICAL_FLOOR_CODES.map(code=>[code,'CONFIRMED']));
export function inspectFloorMapping(dbCodes: readonly string[]) {
  const mapped = Object.keys(FLOOR_PLAN_BY_CODE);
  return {
    physicalCount: PHYSICAL_SLOTS.length,
    mappedCount: mapped.length,
    ambiguousCodes: dbCodes.filter(code=>FLOOR_MAPPING_CONFIDENCE[code]!=='CONFIRMED'),
    physicallyConfirmed: dbCodes.length===27 && new Set(dbCodes).size===27 && dbCodes.every(code=>Boolean(FLOOR_PLAN_BY_CODE[code])&&FLOOR_MAPPING_CONFIDENCE[code]==='CONFIRMED'),
    missingCodes: dbCodes.filter(code => !FLOOR_PLAN_BY_CODE[code]),
    unknownCodes: mapped.filter(code => !dbCodes.includes(code)),
    duplicatePhysicalSlots: mapped.filter((code,index) => mapped.slice(0,index).some(prior => FLOOR_PLAN_BY_CODE[prior]?.physicalSlotId === FLOOR_PLAN_BY_CODE[code]?.physicalSlotId)),
    complete: dbCodes.length === 27 && new Set(dbCodes).size === 27 && dbCodes.every(code=>CANONICAL_FLOOR_CODES.includes(code)) && mapped.length === 27 && dbCodes.every(code => Boolean(FLOOR_PLAN_BY_CODE[code])) && new Set(mapped.map(code=>FLOOR_PLAN_BY_CODE[code]?.id)).size === 27,
  };
}
