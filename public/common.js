(() => {
  const TZ='Europe/Istanbul';
  const formatDateTime=(value,opts={})=>{try{return new Intl.DateTimeFormat('tr-TR',{timeZone:TZ,dateStyle:'short',timeStyle:'short',...opts}).format(new Date(value));}catch{return String(value||'');}};
  const formatDate=(value,opts={})=>{try{return new Intl.DateTimeFormat('tr-TR',{timeZone:TZ,dateStyle:'short',...opts}).format(new Date(value));}catch{return String(value||'');}};
  let reporting=false,last='';
  async function report(payload){
    if(reporting)return; const key=`${payload.message||''}|${payload.filename||''}|${payload.line||''}`; if(key===last)return; last=key;reporting=true;
    try{await fetch('/api/client-errors',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({...payload,page:location.pathname})});}catch{}finally{setTimeout(()=>{reporting=false;},500);}
  }
  window.addEventListener('error',e=>{if(e.target!==window)return;report({message:e.message,error_name:e.error?.name||'Error',stack:e.error?.stack||'',filename:e.filename||'',line:e.lineno||null,column:e.colno||null});});
  window.addEventListener('unhandledrejection',e=>{const r=e.reason;report({message:r?.message||String(r||'Unhandled promise rejection'),error_name:r?.name||'UnhandledRejection',stack:r?.stack||''});});
  window.ETCommon={TZ,formatDateTime,formatDate,report};
})();
