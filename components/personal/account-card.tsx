"use client";
import { useEffect, useRef, useState } from "react";
import type { AccountView } from "@/lib/personal-finance/accounts";
import { displayMoney } from "@/lib/personal-finance/accounts";

export default function AccountCard({account,isDefault,disabled,onManage}:{account:AccountView;isDefault:boolean;disabled:boolean;
  onManage:(account:AccountView,operation:string,fields?:Record<string,unknown>)=>void}) {
  const [history,setHistory]=useState<{id:string;kind:string;amount_minor:string;effective_date:string}[]>([]);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [error,setError]=useState("");
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [announcement,setAnnouncement]=useState("");
  const historyRequest=useRef(0);
  const historyLoading=useRef(false);
  const historyButton=useRef<HTMLButtonElement>(null);
  const historySection=useRef<HTMLElement>(null);
  const moreButton=useRef<HTMLButtonElement>(null);
  const focusPage=useRef(false);
  useEffect(()=>{if(focusPage.current){focusPage.current=false;historySection.current?.focus();}},[history]);
  const historyId=`history-${account.id}`;
  async function showHistory(cursor?:string){
    if(historyLoading.current)return;
    const request=++historyRequest.current;
    historyLoading.current=true;
    setHistoryBusy(true);setError("");
    setHistoryOpen(true);setAnnouncement("Tarix yuklanmoqda…");
    if(!cursor){setHistory([]);setNextCursor(null);}
    try{
      const response=await fetch(`/api/personal/accounts/${account.id}/postings${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,{cache:"no-store"});
      const body=await response.json();if(!response.ok || !Array.isArray(body.postings))throw new Error(body.error||"Tarix olinmadi.");
      if(request!==historyRequest.current)return;
      focusPage.current=Boolean(cursor&&document.activeElement===moreButton.current);
      setHistory(old=>cursor?Array.from(new Map([...old,...body.postings].map(post=>[post.id,post])).values()):body.postings);
      setNextCursor(body.nextCursor??null);
      setAnnouncement(body.postings.length?`${body.postings.length} ta yozuv yuklandi.`:"Yozuv yo‘q.");
    }catch(e){if(request===historyRequest.current){setError(e instanceof Error?e.message:"Tarix olinmadi.");setAnnouncement("Tarix yuklanmadi.");}}
    finally{if(request===historyRequest.current){historyLoading.current=false;setHistoryBusy(false);}}
  }
  function closeHistory(){
    ++historyRequest.current;historyLoading.current=false;setHistoryBusy(false);setHistoryOpen(false);setAnnouncement("");historyButton.current?.focus();
  }
  return <article className="personal-card"><h2>{account.name}</h2>
    <p className="personal-balance">{displayMoney(account.balanceMinor,account.scale)} <small>{account.currencyCode}</small></p>
    <p>{account.status==="archived"?"Arxiv":isDefault?"Asosiy":"Faol"}{!account.includeInTotal&&" · Jamiga kirmaydi"}</p>
    <details><summary aria-label={`${account.name}: boshqarish`}>Boshqarish</summary>
      <form key={account.version} onSubmit={event=>{
        event.preventDefault();const values=new FormData(event.currentTarget);
        onManage(account,"update",{name:values.get("name"),icon:values.get("icon"),color:values.get("color"),includeInTotal:values.get("include")==="on"});
      }}><fieldset disabled={disabled||account.status==="archived"}>
        <div className="field"><label htmlFor={`name-${account.id}`}>Hisob nomi</label><input id={`name-${account.id}`} name="name" minLength={2} maxLength={80} required defaultValue={account.name}/></div>
        <div className="field"><label htmlFor={`icon-${account.id}`}>Belgi</label><select id={`icon-${account.id}`} name="icon" defaultValue={account.icon}><option value="cash">Naqd</option><option value="card">Karta</option><option value="bank">Bank</option><option value="wallet">Hamyon</option></select></div>
        <div className="field"><label htmlFor={`color-${account.id}`}>Rang</label><input id={`color-${account.id}`} name="color" type="color" defaultValue={account.color}/></div>
        <label className="personal-check"><input name="include" type="checkbox" defaultChecked={account.includeInTotal}/> Jamiga qo‘shish</label>
        <button className="button" type="submit">Saqlash</button>
      </fieldset></form>
      <div className="personal-actions">{account.status==="active"?<>
        {!isDefault&&<button className="button" disabled={disabled} onClick={()=>onManage(account,"default")}>Asosiy qilish</button>}
        <button className="button" disabled={disabled} onClick={()=>onManage(account,"archive")}>Arxivlash</button>
      </>:<button className="button" disabled={disabled} onClick={()=>onManage(account,"unarchive")}>Arxivdan olish</button>}</div>
      <p className="muted">Arxiv tarixni o‘chirmaydi. Arxivdagi pul alohida ko‘rsatiladi.</p>
    </details>
    <button ref={historyButton} className="button" aria-label={`${account.name}: tarix`} aria-expanded={historyOpen} aria-controls={historyId} aria-disabled={historyBusy} onClick={()=>{if(!historyBusy)void showHistory();}}>Tarix</button>
    {error&&<p role="alert">{error}</p>}
    <p role="status" className="sr-only">{announcement}</p>
    <section ref={historySection} tabIndex={-1} id={historyId} hidden={!historyOpen} aria-label={`${account.name} tarixi`} aria-busy={historyBusy}>
      {!historyBusy&&!history.length&&!error&&<p>Yozuv yo‘q.</p>}
      <ol>{history.map(post=><li key={post.id}>{post.effective_date} · {post.kind==="opening"?"Boshlang‘ich":post.kind} · {displayMoney(post.amount_minor,account.scale)} {account.currencyCode}</li>)}</ol>
      {nextCursor&&<button ref={moreButton} className="button" aria-disabled={historyBusy} onClick={()=>void showHistory(nextCursor)}>Yana</button>}
      {error&&!history.length&&<button className="button" disabled={historyBusy} onClick={()=>void showHistory()}>Qayta urinish</button>}
      <button className="button" onClick={closeHistory}>Yopish</button>
    </section>
  </article>;
}
