/* Message attachment DOM renderer; explicit dependencies, classic-script compatible. */
(function(root){
 "use strict";
 async function render({message,bubble,client,voicePlayer,document,$,isCurrent,toast,console:logger=console}={}){
  if(!message?.attachment_path||!bubble||!client||typeof isCurrent!=="function")return false;
  const {data:signed,error:signedError}=await client.storage.from("chat-media").createSignedUrl(message.attachment_path,3600);
  if(!isCurrent())return false;
  if(signedError){const failed=document.createElement("span");failed.textContent="تعذر فتح المرفق";bubble.append(failed);return true}
  if(message.attachment_type?.startsWith("image/")){
   const img=document.createElement("img");img.src=signed.signedUrl;img.alt="مرفق";img.loading="lazy";
   img.onclick=()=>{$("lightboxImage").src=img.src;$("lightbox").classList.remove("hidden")};bubble.append(img);return true;
  }
  if(message.attachment_type?.startsWith("video/")){
   const video=document.createElement("video");video.className="message-video";video.controls=true;video.preload="metadata";video.playsInline=true;video.src=signed.signedUrl;video.setAttribute("aria-label","مرفق فيديو");bubble.append(video);return true;
  }
  if(message.attachment_type?.startsWith("audio/")){
   const player=voicePlayer.createPlayer({messageId:message.id,src:signed.signedUrl,refreshUrl:async()=>{const {data:renewed,error}=await client.storage.from("chat-media").createSignedUrl(message.attachment_path,3600);if(error)throw error;if(!isCurrent())return null;return renewed.signedUrl},onError:error=>{logger.warn("Audio player error:",error?.message||error);toast("تعذر تشغيل الرسالة الصوتية. أعد تحميل المحادثة وحاول مجدداً")}});
   bubble.append(player);return true;
  }
  const a=document.createElement("a");a.href=signed.signedUrl;a.target="_blank";a.rel="noopener noreferrer";a.textContent="فتح المرفق";a.style.color="var(--accent)";bubble.append(a);return true;
 }
 root.BizmindMessageAttachments=Object.freeze({render});
})(typeof window!=="undefined"?window:globalThis);
