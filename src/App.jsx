import { useState, useEffect, useCallback, useMemo } from "react";
import { storage } from "./firebase.js";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 9);
const DAYS = ["월","화","수","목","금","토","일"];
const ADMIN_PW = "0923";
const COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#f43f5e","#06b6d4","#84cc16","#a855f7"];
const WK_LABELS = ["2주 전","지난 주","이번 주","다음 주","다다음 주"];

function getBaseMonday() {
  const d = new Date(); d.setHours(0,0,0,0);
  const dow = d.getDay(); d.setDate(d.getDate()-(dow===0?6:dow-1)); return d;
}
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function toYMD(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function getDOW(ymd) { const d=new Date(ymd+"T00:00:00"),w=d.getDay(); return w===0?6:w-1; }
function addMonths(n) { const d=new Date(); d.setMonth(d.getMonth()+n); return toYMD(d); }

const sel = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500";

// Firebase 기반 storage 헬퍼 (window.storage 대신)
const store = {
  async get(key) {
    try { return await storage.get(key); } catch { return null; }
  },
  async set(key, value) {
    return await storage.set(key, value);
  }
};

export default function App() {
  const todayStr = toYMD(new Date());
  const nowH = new Date().getHours();

  const [weekOffset,setWeekOffset] = useState(0);
  const monday = useMemo(()=>addDays(getBaseMonday(),weekOffset*7),[weekOffset]);
  const dates = useMemo(()=>Array.from({length:7},(_,i)=>addDays(monday,i)),[monday]);

  const [tab,setTab] = useState("general");
  const [adminAuthed,setAdminAuthed] = useState(false);
  const [adminPw,setAdminPw] = useState("");
  const [adminPwErr,setAdminPwErr] = useState(false);

  const [teams,setTeams] = useState([]);
  const [data,setData] = useState({});
  const [fss,setFss] = useState([]);
  const [syncing,setSyncing] = useState(false);
  const [modal,setModal] = useState(null);

  const loadTeams = async () => { const r=await store.get("teams"); return r?.value?JSON.parse(r.value):[]; };
  const saveTeams = async (t) => { await store.set("teams",JSON.stringify(t)); setTeams(t); };
  const loadFss = async () => { const r=await store.get("fixedSchedules"); return r?.value?JSON.parse(r.value):[]; };
  const saveFss = async (v) => { await store.set("fixedSchedules",JSON.stringify(v)); setFss(v); };

  const sync = useCallback(async (mon) => {
    setSyncing(true);
    const ds = Array.from({length:7},(_,i)=>addDays(mon,i));
    const [t,fs,...rows] = await Promise.all([
      loadTeams(), loadFss(),
      ...ds.map(async d => {
        const ymd=toYMD(d);
        const r=await store.get(`resv:${ymd}`);
        return [ymd, r?.value?JSON.parse(r.value):{}];
      })
    ]);
    setTeams(t); setFss(fs); setData(Object.fromEntries(rows)); setSyncing(false);
  },[]);

  // Firebase 실시간 구독 (teams, fixedSchedules)
  useEffect(()=>{
    const u1 = storage.subscribe("teams", val => { if(val) setTeams(JSON.parse(val)); });
    const u2 = storage.subscribe("fixedSchedules", val => { if(val) setFss(JSON.parse(val)); });
    return ()=>{ u1?.(); u2?.(); };
  },[]);

  useEffect(()=>{
    sync(monday);
    // 실시간 구독: 현재 주 날짜들
    const unsubs = Array.from({length:7},(_,i)=>addDays(monday,i)).map(d=>{
      const ymd=toYMD(d);
      return storage.subscribe(`resv:${ymd}`, val=>{
        setData(p=>({...p,[ymd]:val?JSON.parse(val):{}}));
      });
    });
    return ()=>unsubs.forEach(u=>u?.());
  },[monday]);

  const handleAdminLogin=()=>{ if(adminPw===ADMIN_PW){setAdminAuthed(true);setAdminPwErr(false);setAdminPw("");}else setAdminPwErr(true); };

  const createTeam=async(n,c,p)=>await saveTeams([...teams,{id:uid(),name:n,color:c,password:p,createdAt:Date.now()}]);
  const updateTeam=async(id,u)=>await saveTeams(teams.map(t=>t.id===id?{...t,...u}:t));
  const deleteTeam=async(id)=>await saveTeams(teams.filter(t=>t.id!==id));

  const doReserve=async(ymd,hour,team,fixed,endDate)=>{
    if(fixed){
      await saveFss([...fss,{id:uid(),teamId:team.id,teamName:team.name,teamColor:team.color,dayOfWeek:getDOW(ymd),hour,startDate:ymd,endDate,cancelledDates:[],at:Date.now()}]);
    } else {
      const r=await store.get(`resv:${ymd}`); let day=r?.value?JSON.parse(r.value):{};
      day[hour]={teamId:team.id,teamName:team.name,teamColor:team.color,fixed:false,at:Date.now()};
      await store.set(`resv:${ymd}`,JSON.stringify(day));
      setData(p=>({...p,[ymd]:{...p[ymd],[hour]:day[hour]}}));
    }
  };

  const doCancel=async(ymd,hour)=>{
    const r=await store.get(`resv:${ymd}`); let day=r?.value?JSON.parse(r.value):{};
    delete day[hour]; await store.set(`resv:${ymd}`,JSON.stringify(day));
    setData(p=>{const d={...p[ymd]};delete d[hour];return{...p,[ymd]:d};});
  };

  const cancelFsDay=async(id,ymd)=>await saveFss(fss.map(f=>f.id===id?{...f,cancelledDates:[...(f.cancelledDates||[]),ymd]}:f));
  const deleteFs=async(id)=>await saveFss(fss.filter(f=>f.id!==id));

  const getRes=useCallback((d,h)=>{
    const ymd=toYMD(d); const reg=data[ymd]?.[h];
    if(reg) return {...reg,_type:"regular"};
    const dow=getDOW(ymd);
    const fs=fss.find(f=>f.dayOfWeek===dow&&f.hour===h&&ymd>=f.startDate&&ymd<=f.endDate&&!f.cancelledDates?.includes(ymd));
    if(fs) return {...fs,fixed:true,_type:"fixed"};
    return null;
  },[data,fss]);

  const wkRange=`${monday.getMonth()+1}/${monday.getDate()} ~ ${addDays(monday,6).getMonth()+1}/${addDays(monday,6).getDate()}`;
  const defaultDayIdx=useMemo(()=>{ if(weekOffset!==0)return 0; const i=dates.findIndex(d=>toYMD(d)===todayStr); return i>=0?i:0; },[weekOffset,dates,todayStr]);

  // ── UI는 artifact 버전과 동일 ──
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100" style={{fontFamily:"system-ui,sans-serif",colorScheme:"dark"}}>
      <div className="border-b border-gray-800">
        <div className="max-w-4xl mx-auto flex px-4">
          {[["general","일반"],["admin","관리자 🔒"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab===k?"border-indigo-400 text-indigo-300":"border-transparent text-gray-500 hover:text-gray-300"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-4">
        {tab==="general"?(
          <>
            <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-bold text-indigo-400">동아리방 예약</h1>
                <p className="text-xs text-gray-500 mt-0.5">{WK_LABELS[weekOffset+2]} · {syncing?"동기화 중…":"실시간 연동"}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-1">
                  {[-2,-1,0,1,2].map(o=>(
                    <button key={o} onClick={()=>setWeekOffset(o)} className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${weekOffset===o?"bg-indigo-700 text-white":"bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{WK_LABELS[o+2]}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={weekOffset<=-2} onClick={()=>setWeekOffset(o=>o-1)} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed">◀</button>
                  <span className="text-xs text-gray-400 text-center" style={{minWidth:140}}>{wkRange}</span>
                  <button disabled={weekOffset>=2} onClick={()=>setWeekOffset(o=>o+1)} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
                  <button onClick={()=>sync(monday)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-500">↺</button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div style={{minWidth:480}}>
                <div className="grid gap-px bg-gray-800" style={{gridTemplateColumns:"52px repeat(7,1fr)"}}>
                  <div className="bg-gray-950 h-12"/>
                  {dates.map((d,i)=>{ const isToday=toYMD(d)===todayStr; return (
                    <div key={i} className={`${isToday?"bg-indigo-950":"bg-gray-900"} flex flex-col items-center justify-center h-12`}>
                      <span className={`text-xs ${i>=5?"text-red-400":"text-gray-500"}`}>{DAYS[i]}</span>
                      <span className={`text-sm font-semibold ${isToday?"text-indigo-300":"text-gray-200"}`}>{d.getMonth()+1}/{d.getDate()}</span>
                    </div>
                  ); })}
                </div>
                {HOURS.map(h=>(
                  <div key={h} className="grid gap-px bg-gray-800 mt-px" style={{gridTemplateColumns:"52px repeat(7,1fr)"}}>
                    <div className="bg-gray-950 flex items-center justify-end pr-2"><span className="text-xs text-gray-600">{h}:00</span></div>
                    {dates.map((d,i)=>{ const ymd=toYMD(d),res=getRes(d,h),isToday=ymd===todayStr,isPast=ymd<todayStr||(isToday&&h<nowH),tc=res?.teamColor||"#6366f1",isFixed=res?._type==="fixed";
                      return (
                        <div key={i} onClick={()=>res&&setModal({kind:"cancel",ymd,hour:h,res,pwInput:"",pwErr:false})}
                          className={`h-11 flex items-center justify-center px-0.5 overflow-hidden transition-colors ${isPast&&!res?"opacity-30":""} ${res?"cursor-pointer":isToday?"bg-indigo-950":"bg-gray-900"}`}
                          style={res?{backgroundColor:tc+(isFixed?"18":"28"),borderLeft:`3px ${isFixed?"dashed":"solid"} ${tc}${isFixed?"99":""}``}:{}}
                        >
                          {res&&<div className="w-full truncate text-center text-xs font-semibold px-0.5" style={{color:tc}}>{isFixed?"📌 ":""}{res.teamName||"예약"}</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-4 mt-3 text-xs text-gray-600 items-center">
              <span className="flex items-center gap-1.5"><span style={{display:"inline-block",width:12,height:12,borderRadius:2,background:"#3b82f628",borderLeft:"3px solid #3b82f6"}}/>일반 예약</span>
              <span className="flex items-center gap-1.5"><span style={{display:"inline-block",width:12,height:12,borderRadius:2,background:"#3b82f618",borderLeft:"3px dashed #3b82f699"}}/>고정 일정</span>
            </div>
            <div className="mt-5">
              {teams.length>0?(
                <><p className="text-xs text-gray-500 mb-2">팀을 선택해서 예약하세요</p>
                <div className="flex flex-wrap gap-2">
                  {teams.map(team=>(
                    <button key={team.id} onClick={()=>setModal({kind:"reserve",step:1,team,pwInput:"",pwErr:false,dayIdx:defaultDayIdx,hour:HOURS[0],fixed:false,endDate:addMonths(3)})}
                      style={{backgroundColor:team.color+"1a",border:`1.5px solid ${team.color}`,color:team.color}} className="px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-80 transition-opacity">
                      {team.name}
                    </button>
                  ))}
                </div></>
              ):(
                <p className="text-sm text-gray-600 text-center py-6">관리자 탭에서 팀을 먼저 등록해주세요</p>
              )}
            </div>
          </>
        ):(
          adminAuthed?<AdminPanel teams={teams} fss={fss} onCreate={createTeam} onUpdate={updateTeam} onDelete={deleteTeam} onDeleteFs={deleteFs} onLogout={()=>setAdminAuthed(false)}/>:(
            <div className="flex items-center justify-center pt-20">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 w-72 text-center">
                <div className="text-3xl mb-2">🔒</div>
                <h2 className="text-base font-bold text-gray-100 mb-1">관리자 로그인</h2>
                <p className="text-xs text-gray-500 mb-5">비밀번호를 입력하세요</p>
                <input type="password" autoFocus value={adminPw} onChange={e=>{setAdminPw(e.target.value);setAdminPwErr(false);}} onKeyDown={e=>e.key==="Enter"&&handleAdminLogin()} placeholder="비밀번호" className={sel} style={adminPwErr?{borderColor:"#ef4444"}:{}}/>
                {adminPwErr&&<p className="text-xs text-red-400 mt-2 text-left">비밀번호가 올바르지 않습니다</p>}
                <button onClick={handleAdminLogin} className="w-full mt-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-sm font-bold text-white">로그인</button>
              </div>
            </div>
          )
        )}
      </div>
      {modal&&<ModalRoot modal={modal} setModal={setModal} teams={teams} dates={dates} data={data} fss={fss} doReserve={doReserve} doCancel={doCancel} cancelFsDay={cancelFsDay} deleteFs={deleteFs}/>}
    </div>
  );
}

// AdminPanel과 ModalRoot는 artifact 버전과 동일 (생략 없이 포함)
function AdminPanel({ teams, fss, onCreate, onUpdate, onDelete, onDeleteFs, onLogout }) {
  const [section,setSection]=useState("teams");
  const [showForm,setShowForm]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({name:"",color:COLORS[5],password:""});
  const [busy,setBusy]=useState(false);
  const [delId,setDelId]=useState(null);
  const [delFsId,setDelFsId]=useState(null);
  const sf=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const reset=()=>{setForm({name:"",color:COLORS[5],password:""});setEditId(null);setShowForm(false);};
  const startEdit=t=>{setForm({name:t.name,color:t.color,password:t.password});setEditId(t.id);setShowForm(true);};
  const submit=async()=>{
    if(!form.name.trim()||!form.password.trim())return;
    setBusy(true);
    try{if(editId)await onUpdate(editId,{name:form.name.trim(),color:form.color,password:form.password.trim()});else await onCreate(form.name.trim(),form.color,form.password.trim());reset();}
    finally{setBusy(false);}
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          <button onClick={()=>setSection("teams")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${section==="teams"?"bg-indigo-700 text-white":"text-gray-400 hover:text-gray-200"}`}>팀 관리</button>
          <button onClick={()=>setSection("fixed")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${section==="fixed"?"bg-indigo-700 text-white":"text-gray-400 hover:text-gray-200"}`}>고정 일정 {fss.length>0&&<span className="ml-1 bg-indigo-600 text-white text-xs rounded-full px-1.5">{fss.length}</span>}</button>
        </div>
        <button onClick={onLogout} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-400">로그아웃</button>
      </div>
      {section==="teams"?(
        <>
          <div className="flex justify-end mb-4"><button onClick={()=>{reset();setShowForm(true);}} className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-sm font-bold text-white">+ 팀 생성</button></div>
          {showForm&&(
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-5">
              <h3 className="text-sm font-bold text-gray-200 mb-4">{editId?"팀 수정":"새 팀 만들기"}</h3>
              <div className="space-y-3">
                <div><label className="text-xs text-gray-500 block mb-1">팀명 *</label><input value={form.name} onChange={sf("name")} placeholder="팀 이름" className={sel}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">색상 *</label><div className="flex flex-wrap gap-2 mt-1">{COLORS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{width:28,height:28,borderRadius:6,background:c,border:form.color===c?"3px solid white":"3px solid transparent"}}/>)}</div><div className="mt-2 flex items-center gap-2"><div style={{width:18,height:18,borderRadius:4,background:form.color}}/><span className="text-xs text-gray-500">선택된 색상</span></div></div>
                <div><label className="text-xs text-gray-500 block mb-1">예약 비밀번호 *</label><input type="password" value={form.password} onChange={sf("password")} placeholder="팀 예약에 사용할 비밀번호" className={sel}/></div>
                <div className="flex gap-2 pt-1">
                  <button onClick={reset} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200">취소</button>
                  <button onClick={submit} disabled={busy||!form.name.trim()||!form.password.trim()} className="flex-1 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-sm font-bold text-white disabled:opacity-50">{busy?"저장 중…":editId?"수정 완료":"팀 생성"}</button>
                </div>
              </div>
            </div>
          )}
          {teams.length===0?<div className="text-center text-gray-600 text-sm py-10">등록된 팀이 없습니다</div>:(
            <div className="space-y-2">
              {teams.map(t=>(
                <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
                  <div style={{width:36,height:36,borderRadius:8,background:t.color+"33",border:`2px solid ${t.color}`,flexShrink:0}}/>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold" style={{color:t.color}}>{t.name}</p><p className="text-xs text-gray-500">비밀번호: {"•".repeat(Math.min(t.password.length,10))}</p></div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={()=>{setDelId(null);startEdit(t);}} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300">수정</button>
                    {delId===t.id?(<><button onClick={async()=>{await onDelete(t.id);setDelId(null);}} className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded-lg text-xs text-red-200">확인</button><button onClick={()=>setDelId(null)} className="px-3 py-1.5 bg-gray-800 rounded-lg text-xs text-gray-400">취소</button></>):(<button onClick={()=>setDelId(t.id)} className="px-3 py-1.5 bg-gray-800 hover:bg-red-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-red-300 transition-colors">삭제</button>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ):(
        fss.length===0?<div className="text-center text-gray-600 text-sm py-10">등록된 고정 일정이 없습니다</div>:(
          <div className="space-y-2">
            {fss.map(fs=>(
              <div key={fs.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
                <div style={{width:4,height:44,borderRadius:2,background:fs.teamColor,flexShrink:0}}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{color:fs.teamColor}}>📌 {fs.teamName}</p>
                  <p className="text-xs text-gray-500">매주 {DAYS[fs.dayOfWeek]}요일 {fs.hour}:00 ~ {fs.hour+1}:00</p>
                  <p className="text-xs text-gray-600">{fs.startDate} ~ {fs.endDate}{fs.cancelledDates?.length>0&&` · ${fs.cancelledDates.length}일 제외됨`}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {delFsId===fs.id?(<><button onClick={async()=>{await onDeleteFs(fs.id);setDelFsId(null);}} className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded-lg text-xs text-red-200">확인</button><button onClick={()=>setDelFsId(null)} className="px-3 py-1.5 bg-gray-800 rounded-lg text-xs text-gray-400">취소</button></>):(<button onClick={()=>setDelFsId(fs.id)} className="px-3 py-1.5 bg-gray-800 hover:bg-red-900 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-red-300 transition-colors">삭제</button>)}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ModalRoot({ modal, setModal, teams, dates, data, fss, doReserve, doCancel, cancelFsDay, deleteFs }) {
  const [busy,setBusy]=useState(false);
  const close=()=>setModal(null);
  const upd=u=>setModal(m=>({...m,...u}));
  const checkPw=()=>{ if(modal.pwInput===modal.team.password)upd({step:2,pwErr:false}); else upd({pwErr:true}); };
  const selYMD=(modal.kind==="reserve"&&modal.step===2)?toYMD(dates[modal.dayIdx]):null;
  const slotTaken=selYMD?!!data[selYMD]?.[modal.hour]:false;
  const tc=modal.team?.color||"#6366f1";
  const confirmReserve=async()=>{ if(busy)return; setBusy(true); await doReserve(toYMD(dates[modal.dayIdx]),modal.hour,modal.team,modal.fixed,modal.endDate); setBusy(false); close(); };
  const confirmCancel=async(mode)=>{
    if(busy)return;
    const res=modal.res;
    if(res?.teamId){const team=teams.find(t=>t.id===res.teamId);if(team&&(modal.pwInput||"")!==team.password){upd({pwErr:true});return;}}
    setBusy(true);
    if(res?._type==="fixed"){ if(mode==="single")await cancelFsDay(res.id,modal.ymd); else await deleteFs(res.id); }
    else await doCancel(modal.ymd,modal.hour);
    setBusy(false); close();
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={close}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl" style={{width:320}} onClick={e=>e.stopPropagation()}>
        {modal.kind==="reserve"&&modal.step===1&&(
          <>
            <div className="flex items-center gap-3 mb-4"><div style={{width:40,height:40,borderRadius:10,background:tc+"33",border:`2px solid ${tc}`,flexShrink:0}}/><div><h2 className="text-base font-bold text-gray-100">{modal.team.name}</h2><p className="text-xs text-gray-500">팀 비밀번호를 입력하세요</p></div></div>
            <input type="password" autoFocus value={modal.pwInput} onChange={e=>upd({pwInput:e.target.value,pwErr:false})} onKeyDown={e=>e.key==="Enter"&&checkPw()} placeholder="비밀번호" className={sel} style={modal.pwErr?{borderColor:"#ef4444"}:{}}/>
            {modal.pwErr&&<p className="text-xs text-red-400 mt-1.5">비밀번호가 올바르지 않습니다</p>}
            <div className="flex gap-2 mt-4"><button onClick={close} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200">취소</button><button onClick={checkPw} className="flex-1 py-2 rounded-lg text-sm font-bold text-white" style={{background:tc}}>다음</button></div>
          </>
        )}
        {modal.kind==="reserve"&&modal.step===2&&(
          <>
            <div className="flex items-center gap-2 mb-4"><div style={{width:10,height:10,borderRadius:3,background:tc,flexShrink:0}}/><h2 className="text-base font-bold text-gray-100">{modal.team.name} 예약</h2></div>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500 block mb-1">요일</label><select value={modal.dayIdx} onChange={e=>upd({dayIdx:Number(e.target.value)})} className={sel}>{dates.map((d,i)=><option key={i} value={i}>{DAYS[i]} ({d.getMonth()+1}/{d.getDate()})</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">시간</label><select value={modal.hour} onChange={e=>upd({hour:Number(e.target.value)})} className={sel}>{HOURS.map(h=><option key={h} value={h}>{h}:00 ~ {h+1}:00</option>)}</select></div>
              {slotTaken&&<div className="text-xs text-amber-400 bg-amber-950 border border-amber-800 rounded-lg px-3 py-2">⚠️ 이미 예약된 시간대입니다</div>}
              <label className="flex items-center gap-2 cursor-pointer select-none pt-1"><input type="checkbox" checked={modal.fixed} onChange={e=>upd({fixed:e.target.checked})} className="w-4 h-4" style={{accentColor:tc}}/><span className="text-sm text-gray-300">📌 고정 일정 (매주 반복)</span></label>
              {modal.fixed&&(
                <div className="bg-gray-950 border border-gray-700 rounded-lg p-3">
                  <label className="text-xs text-gray-400 block mb-2">종료일 <span className="text-gray-600">(5주 범위 밖도 가능)</span></label>
                  <input type="date" value={modal.endDate} min={selYMD||toYMD(new Date())} onChange={e=>upd({endDate:e.target.value})} className={sel}/>
                  <p className="text-xs text-gray-600 mt-1.5">매주 {DAYS[modal.dayIdx]}요일에 반복됩니다</p>
                </div>
              )}
            </div>
            <div className="flex gap-2"><button onClick={()=>upd({step:1})} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200">이전</button><button onClick={confirmReserve} disabled={busy||slotTaken} className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{background:tc}}>{busy?"예약 중…":"예약 완료"}</button></div>
          </>
        )}
        {modal.kind==="cancel"&&(()=>{
          const res=modal.res, isFixed=res?._type==="fixed", rtc=res?.teamColor||"#a5b4fc", dayIdx=dates.findIndex(d=>toYMD(d)===modal.ymd);
          return (
            <>
              <h2 className="text-base font-bold text-gray-100 mb-1">예약 정보</h2>
              <p className="text-xs text-gray-500 mb-4">{modal.ymd} {dayIdx>=0?DAYS[dayIdx]:""} · {modal.hour}:00 ~ {modal.hour+1}:00</p>
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-1"><div style={{width:10,height:10,borderRadius:2,background:rtc,flexShrink:0}}/><span className="text-sm font-bold" style={{color:rtc}}>{res?.teamName||"예약"}</span>{isFixed&&<span className="text-xs">📌</span>}</div>
                {isFixed&&<p className="text-xs text-amber-400 mt-1">매주 반복 · {res.endDate}까지</p>}
              </div>
              {res?.teamId&&(<div className="mb-4"><label className="text-xs text-gray-500 block mb-1">팀 비밀번호</label><input type="password" autoFocus value={modal.pwInput||""} onChange={e=>upd({pwInput:e.target.value,pwErr:false})} placeholder="팀 비밀번호" className={sel} style={modal.pwErr?{borderColor:"#ef4444"}:{}}/>{modal.pwErr&&<p className="text-xs text-red-400 mt-1">비밀번호가 올바르지 않습니다</p>}</div>)}
              {isFixed?(
                <div className="space-y-2">
                  <button onClick={()=>confirmCancel("single")} disabled={busy} className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 disabled:opacity-50">이 날만 취소</button>
                  <div className="flex gap-2"><button onClick={close} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-400">닫기</button><button onClick={()=>confirmCancel("all")} disabled={busy} className="flex-1 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm font-bold text-red-200 disabled:opacity-50">{busy?"처리 중…":"전체 삭제"}</button></div>
                </div>
              ):(
                <div className="flex gap-2"><button onClick={close} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200">닫기</button><button onClick={()=>confirmCancel("single")} disabled={busy} className="flex-1 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm font-bold text-red-200 disabled:opacity-50">{busy?"처리 중…":"예약 취소"}</button></div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
