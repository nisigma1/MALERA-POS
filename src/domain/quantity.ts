// REAL quantities retain the existing decimal UI contract. Compute their decimal
// value exactly before converting back; reject an unrepresentable result.
function decimal(value:number):{units:bigint;scale:number} {
 if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('Sasia është jashtë kufirit të lejuar.');
 const [digits,exponent='0']=value.toString().toLowerCase().split('e');
 const [whole,fraction='']=digits!.split('.');let units=BigInt(whole!+fraction),scale=fraction.length-Number(exponent);
 if(scale<0){units*=10n**BigInt(-scale);scale=0;}return {units,scale};
}
function result(units:bigint,scale:number):number {
 const sign=units<0n?'-':'',digits=(units<0n?-units:units).toString().padStart(scale+1,'0');
 const n=Number(sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits));
 const converted=decimal(n),common=Math.max(scale,converted.scale);
 if(units*10n**BigInt(common-scale)!==converted.units*10n**BigInt(common-converted.scale))throw Error('Sasia nuk mund të ruhet saktë.');return n;
}
export function exactQuantity(a:number,b:number,subtract=false):number {
 const left=decimal(a),right=decimal(b),scale=Math.max(left.scale,right.scale);
 return result(left.units*10n**BigInt(scale-left.scale)+(subtract?-1n:1n)*right.units*10n**BigInt(scale-right.scale),scale);
}
export function exactQuantityCost(quantity:number,costCents:number):number {
 const q=decimal(quantity),value=q.units*BigInt(costCents),denominator=10n**BigInt(q.scale);
 if(value%denominator!==0n)throw Error('Kosto e sasisë përmban pjesë të centit.');const cents=value/denominator;
 if(cents<0n||cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Shuma tejkalon kufirin e lejuar.');return Number(cents);
}
