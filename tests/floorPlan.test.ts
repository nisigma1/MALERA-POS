import { describe, expect, it } from 'vitest';
import { CANONICAL_FLOOR_CODES, FLOOR_PLAN_BY_CODE, inspectFloorMapping, PHYSICAL_SLOTS } from '../src/presentation/floorPlan';

it('retains stable storage identifiers behind the owner-facing labels',()=>{
 expect(CANONICAL_FLOOR_CODES).toEqual(['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','M13','SH1','SH2','SH3','SH4','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10']);
});
describe('original floor-plan structural transcription', () => {
  it('retains every physical position, including the diagonal and the small terrace table', () => {
    expect(PHYSICAL_SLOTS).toHaveLength(27);
    expect(new Set(PHYSICAL_SLOTS.map(slot=>slot.id)).size).toBe(27);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='MAIN')).toHaveLength(12);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='BAR')).toHaveLength(4);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='TERRACE')).toHaveLength(11);
    expect(PHYSICAL_SLOTS.find(slot=>slot.id==='B13')?.rotation).toBe(45);
    expect(PHYSICAL_SLOTS.find(slot=>slot.id==='R01')).toMatchObject({x:995,y:858});
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='TERRACE' && slot.y===1040)).toHaveLength(6);
  });
  it('maps every canonical code to its confirmed original-sketch physical slot', () => {
    const result = inspectFloorMapping(CANONICAL_FLOOR_CODES);
    expect(Object.keys(FLOOR_PLAN_BY_CODE)).toHaveLength(27);
    expect(result.missingCodes).toEqual([]);
    expect(result.unknownCodes).toEqual([]);
    expect(result.duplicatePhysicalSlots).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.physicallyConfirmed).toBe(true);
    expect(result.ambiguousCodes).toEqual([]);
    CANONICAL_FLOOR_CODES.forEach((code,index)=>{
      const physical=PHYSICAL_SLOTS[index];
      if(!physical)throw new Error(`Missing source position for ${code}`);
      expect(FLOOR_PLAN_BY_CODE[code]).toEqual({...physical,id:code,physicalSlotId:physical.id});
    });
    expect(FLOOR_PLAN_BY_CODE.M13).toMatchObject({x:173,y:803,area:'TERRACE',shape:'rect',rotation:45});
    expect(FLOOR_PLAN_BY_CODE.T1).toMatchObject({x:995,y:858,shape:'round'});
    expect(['T2','T3','T4'].map(code=>FLOOR_PLAN_BY_CODE[code]?.shape)).toEqual(['round','round','round']);
    expect(['T5','T6','T7','T8','T9','T10'].map(code=>FLOOR_PLAN_BY_CODE[code]?.shape)).toEqual(Array(6).fill('rect'));
  });
  it('rejects duplicate or unknown DB codes as a complete canonical map', () => {
    expect(inspectFloorMapping(Array(27).fill('M1')).complete).toBe(false);
    expect(inspectFloorMapping([...CANONICAL_FLOOR_CODES.slice(1),'UNKNOWN']).complete).toBe(false);
    expect(CANONICAL_FLOOR_CODES).toHaveLength(27);
    expect(new Set(CANONICAL_FLOOR_CODES).size).toBe(27);
  });
});

