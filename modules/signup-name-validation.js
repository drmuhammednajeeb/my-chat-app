(function(root){
 'use strict';
 function normalize(value){return String(value||'').normalize('NFC').trim().replace(/\\s+/gu,' ')}
 function validate(value){
  const normalized=normalize(value),parts=normalized.split(' ');
  const validPart=/^[\\p{L}\\p{M}]+(?:[-'’][\\p{L}\\p{M}]+)*$/u;
  return {normalized,valid:parts.length>=2&&parts.length<=3&&parts.every(part=>validPart.test(part))};
 }
 root.BizmindSignupName=Object.freeze({normalize,validate});
})(globalThis);
