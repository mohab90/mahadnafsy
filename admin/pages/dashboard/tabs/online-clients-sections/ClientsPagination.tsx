
interface Props {
  totalPages: number;
  safePage: number;
  setCollOnlinePage: (n: number | ((p: number) => number)) => void;
}

export function ClientsPagination({ totalPages, safePage, setCollOnlinePage }: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-1 mt-4 flex-wrap">
      <button onClick={()=>setCollOnlinePage(1)} disabled={safePage===1} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">«</button>
      <button onClick={()=>setCollOnlinePage(p=>Math.max(1,p-1))} disabled={safePage===1} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">‹</button>
      {Array.from({length:totalPages},(_,i)=>i+1)
        .filter(p=>p===1||p===totalPages||Math.abs(p-safePage)<=2)
        .reduce<(number|'...')[]>((acc,p,idx,arr)=>{ if(idx>0&&(p as number)-(arr[idx-1] as number)>1)acc.push('...'); acc.push(p); return acc; },[])
        .map((p,i)=>p==='...'?<span key={`e${i}`} className="px-2 text-gray-400 text-xs">…</span>:
          <button key={p} onClick={()=>setCollOnlinePage(p as number)} className={`px-3 py-1 rounded-lg text-xs border font-bold transition ${safePage===p?'bg-teal-600 text-white border-teal-600':'hover:bg-gray-50'}`}>{p}</button>
        )}
      <button onClick={()=>setCollOnlinePage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">›</button>
      <button onClick={()=>setCollOnlinePage(totalPages)} disabled={safePage===totalPages} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">»</button>
    </div>
  );
}
