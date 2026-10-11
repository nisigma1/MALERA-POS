import { tableDisplayCode } from '../src/domain/tableLabels';
import { describe, expect, it } from 'vitest';
import { CANONICAL_FLOOR_CODES, FLOOR_PLAN_BY_CODE, inspectFloorMapping, PHYSICAL_SLOTS } from '../src/presentation/floorPlan';

it('shows 12 Brenda, 11 Jashtë and 4 Shanku codes without changing identities',()=>{
 const labels=CANONICAL_FLOOR_CODES.map(tableDisplayCode);
 expect(new Set(labels).size).toBe(27);
 expect(labels.filter(code=>/^B\d+$/.test(code))).toHaveLength(12);
 expect(labels.filter(code=>/^J\d+$/.test(code))).toHaveLength(11);
 expect(labels.filter(code=>/^SH\d+$/.test(code))).toHaveLength(4);
 expect(tableDisplayCode('M13')).toBe('J11');
 expect(tableDisplayCode('UNKNOWN')).toBe('UNKNOWN');
});
describe('original floor-plan structural transcription', () => {
  it('retains every physical position, including the diagonal and the small terrace table', () => {
    expect(PHYSICAL_SLOTS).toHaveLength(27);
    expect(new Set(PHYSICAL_SLOTS.map(slot=>slot.id)).size).toBe(27);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='MAIN')).toHaveLength(12);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='BAR')).toHaveLength(4);
    expect(PHYSICAL_SLOTS.filter(slot=>slot.area==='TERRACE')).toHaveLength(11);
    expect(PHYSICAL_SLOTS.find(slot=>slot.id==='R11')?.rotation).toBe(45);
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
    expect(FLOOR_PLAN_BY_CODE.M13).toMatchObject({x:173,y:915,area:'TERRACE',shape:'rect',rotation:45});
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

