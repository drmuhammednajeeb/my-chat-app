/* Text and sticker message content DOM renderer. */
(function(root){
 "use strict";
 function render({content,bubble,decodeSticker,document}={}){
  if(content==null||!bubble||!document||typeof decodeSticker!=="function")return false;
  const value=String(content),sticker=decodeSticker(value);
  if(sticker){const visual=document.createElement("div");visual.className="message-sticker";visual.textContent=sticker;visual.setAttribute("role","img");visual.setAttribute("aria-label","ملصق");bubble.append(visual);return "sticker"}
  const text=document.createElement("div");text.className="message-content";text.textContent=value;bubble.append(text);return "text";
 }
 root.BizmindMessageContent=Object.freeze({render});
})(typeof window!=="undefined"?window:globalThis);
