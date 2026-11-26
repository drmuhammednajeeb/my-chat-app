(function(root){
 'use strict';
 function calculate(value){
  const password=String(value||'');
  if(!password)return {level:0,label:'لم تُدخل كلمة المرور بعد'};
  let score=password.length>=8?1:0;
  if(password.length>=10)score++;
  if(password.length>=14)score++;
  const classes=[/\p{Ll}/u.test(password),/\p{Lu}/u.test(password),/\p{N}/u.test(password),/[^\p{L}\p{M}\p{N}\s]/u.test(password)].filter(Boolean).length;
  if(classes>=2)score++;
  if(classes>=3)score++;
  if(classes>=4)score++;
  if(password.length<8)return {level:1,label:'ضعيفة'};
  if(score<=1)return {level:1,label:'ضعيفة'};
  if(score<=2)return {level:2,label:'متوسطة'};
  if(score<=4)return {level:3,label:'قوية'};
  return {level:4,label:'قوية جداً'};
 }
 root.BizmindPasswordStrength=Object.freeze({calculate});
})(globalThis);
