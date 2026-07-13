import { useState, useEffect, useCallback, useMemo } from "react";
import { storage } from "./firebase.js";

const SLOT=30,S_MIN=540,E_MIN=1380,MAX_DUR=240;
const SLOTS=Array.from({length:(E_MIN-S_MIN)/SLOT},(_,i)=>S_MIN+i*SLOT);
const DAYS=["월","화","수","목","금","토","일"];
const ADMIN_PW="0923";
const COLORS=["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#f43f5e","#06b6d4","#84cc16","#a855f7"];
const WK_LABELS=["2주 전","지난 주","이번 주","다음 주","다다음 주"];

function t2s(m){return `${Math.floor(m/60)}:${m%60===0?"00":"30"}`;}
function durLabel(d){const h=Math.floor(d/60),m=d%60;return h===0?`${m}분`:m===0?`${h}시간`:`${h}시간 ${m}분`;}
function getBaseMonday(){const d=new Date();d.setHours(0,0,0,0);const w=d.getDay();d.setDate(d.getDate()-(w===0?6:w-1));return d;}
function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
function toYMD(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function getDOW(ymd){const d=new Date(ymd+"T00:00:00"),w=d.getDay();return w===0?6:w-1;}
function addMonths(n){const d=new Date();d.setMonth(d.getMonth()+n);return toYMD(d);}
function getNowMin(){const n=new Date();return n.getHours()*60+(n.getMinutes()>=30?30:0);}
function overlaps(s1,d1,s2,d2){return s1<s2+d2&&s1+d1>s2;}
function getDayRes(data,ymd){
  const v=data[ymd];
  if(!v)return[];
  if(Array.isArray(v))return v;
  return Object.entries(v).map(([h,r])=>({...r,startMinute:Number(h)*60,duration:60,id:(r.at||Date.now()).toString(36)}));
}

// Firebase storage 래퍼
const store={
  async get(key){try{return await storage.get(key);}catch{return null;}},
  async set(key,value){return await storage.set(key,value);}
};

const sel="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500";

export default function App(){
  const todayStr=toYMD(new Date());
  const [weekOffset,setWeekOffset]=useState(0);
  const monday=useMemo(()=>addDays(getBaseMonday(),weekOffset*7),[weekOffset]);
  const dates=useMemo(()=>Array.from({length:7},(_,i)=>addDays(monday,i)),[monday]);
  const [tab,setTab]=useState("general");
  const [adminAuthed,setAdminAuthed]=useState(false);
  const [adminPw,setAdminPw]=useState("");
  const [adminPwErr,setAdminPwErr]=useState(false);
  const [teams,setTeams]=useState([]);
  const [data,setData]=useState({});
  const [fss,setFss]=useState([]);
  const [syncing,setSyncing]=useState(false);
  const [modal,setModal]=useState(null);

  const loadTeams=async()=>{const r=await store.get("teams");return r?.value?JSON.parse(r.value):[];};
  const saveTeams=async t=>{await store.set("teams",JSON.stringify(t));setTeams(t);};
  const loadFss=async()=>{const r=await store.get("fixedSchedules");return r?.value?JSON.parse(r.value):[];};
  const saveFss=async v=>{await store.set("fixedSchedules",JSON.stringify(v));setFss(v);};

  const sync=useCallback(async mon=>{
    setSyncing(true);
    const ds=Array.from({length:7},(_,i)=>addDays(mon,i));
    const[t,fs,...rows]=await Promise.all([
      loadTeams(),loadFss(),
      ...ds.map(async d=>{const ymd=toYMD(d);const r=await store.get(`resv:${ymd}`);return[ymd,r?.value?JSON.parse(r.value):[]];})

    ]);
    setTeams(t);setFss(fs);setData(Object.fromEntries(rows));setSyncing(false);
  },[]);

  // Firebase 실시간 구독
  useEffect(()=>{
    const u1=storage.subscribe("teams",val=>{if(val)setTeams(JSON.parse(val));});
    const u2=storage.subscribe("fixedSchedules",val=>{if(val)setFss(JSON.parse(val));});
    return()=>{u1?.();u2?.();};
  },[]);

  useEffect(()=>{
    sync(monday);
    const unsubs=Array.from({length:7},(_,i)=>addDays(monday,i)).map(d=>{
      const ymd=toYMD(d);
      return storage.subscribe(`resv:${ymd}`,val=>{
        setData(p=>({...p,[ymd]:val?JSON.parse(val):[]}));
      });
    });
    return()=>unsubs.forEach(u=>u?.());
  },[monday]);

  const handleAdminLogin=()=>{if(adminPw===ADMIN_PW){setAdminAuthed(true);setAdminPwErr(false);setAdminPw("");}else setAdminPwErr(true);};
  const createTeam=async(n,c,p)=>saveTeams([...teams,{id:uid(),name:n,color:c,password:p,createdAt:Date.now()}]);
  const updateTeam=async(id,u)=>saveTeams(teams.map(t=>t.id===id?{...t,...u}:t));
  const deleteTeam=async(id)=>saveTeams(teams.filter(t=>t.id!==id));

  const doReserve=async(ymd,startMinute,duration,team,fixed,endDate)=>{
    if(fixed){
      await saveFss([...fss,{id:uid(),teamId:team.id,teamName:team.name,teamColor:team.color,dayOfWeek:getDOW(ymd),startMinute,duration,startDate:ymd,endDate,cancelledDates:[],at:Date.now()}]);
      return"ok";
    } else {
      const key=`resv:${ymd}`;
      let latest=[];
      const r=await store.get(key);
      if(r?.value){const v=JSON.parse(r.value);latest=Array.isArray(v)?v:[];}
      if(latest.some(r=>overlaps(startMinute,duration,r.startMinute,r.duration)))return"conflict";
      const entry={id:uid(),teamId:team.id,teamName:team.name,teamColor:team.color,startMinute,duration,at:Date.now()};
      const day=[...latest,entry];
      await store.set(key,JSON.stringify(day));
      setData(p=>({...p,[ymd]:day}));
      return"ok";
    }
  };

  const doCancel=async(ymd,resId)=>{
    const key=`resv:${ymd}`;
    const day=getDayRes(data,ymd).filter(r=>r.id!==resId);
    await store.set(key,JSON.stringify(day));
    setData(p=>({...p,[ymd]:day}));
  };

  const cancelFsDay=async(id,ymd)=>saveFss(fss.map(f=>f.id===id?{...f,cancelledDates:[...(f.cancelledDates||[]),ymd]}:f));
  const deleteFs=async id=>saveFss(fss.filter(f=>f.id!==id));

  const getCellInfo=useCallback((d,slot)=>{
    const ymd=toYMD(d);
    const dayRes=getDayRes(data,ymd);
    for(const res of dayRes){
      if(res.startMinute===slot)return{type:"start",res:{...res,_type:"regular"}};
      if(slot>res.startMinute&&slot<res.startMinute+res.duration)return{type:"covered"};
    }
    const dow=getDOW(ymd);
    const fs=fss.find(f=>f.dayOfWeek===dow&&ymd>=f.startDate&&ymd<=f.endDate&&!f.cancelledDates?.includes(ymd)&&slot>=f.startMinute&&slot<f.startMinute+f.duration);
    if(fs){
      if(fs.startMinute===slot)return{type:"start",res:{...fs,_type:"fixed",fixed:true}};
      return{type:"covered"};
    }
    return{type:"empty"};
  },[data,fss]);

  const hasConflict=useCallback((ymd,startMinute,duration)=>{
    if(getDayRes(data,ymd).some(r=>overlaps(startMinute,duration,r.startMinute,r.duration)))return true;
    const dow=getDOW(ymd);
    return fss.some(f=>f.dayOfWeek===dow&&ymd>=f.startDate&&ymd<=f.endDate&&!f.cancelledDates?.includes(ymd)&&overlaps(startMinute,duration,f.startMinute,f.duration));
  },[data,fss]);

  const wkRange=`${monday.getMonth()+1}/${monday.getDate()} ~ ${addDays(monday,6).getMonth()+1}/${addDays(monday,6).getDate()}`;
  const defaultDayIdx=useMemo(()=>{if(weekOffset!==0)return 0;const i=dates.findIndex(d=>toYMD(d)===todayStr);return i>=0?i:0;},[weekOffset,dates,todayStr]);

  return(
    <div className="min-h-screen bg-gray-950 text-gray-100" style={{fontFamily:"system-ui,sans-serif",colorScheme:"dark"}}>
      <div className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto flex px-4">
          {[["general","일반"],["admin","관리자 🔒"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab===k?"border-indigo-400 text-indigo-300":"border-transparent text-gray-500 hover:text-gray-300"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="max-w-5xl mx-auto p-4">
        {tab==="general"?(
          <>
            <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-bold text-indigo-400">함성 동아리방 사용 일정</h1>
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
              <table style={{minWidth:520,borderCollapse:"collapse",width:"100%"}}>
                <thead>
                  <tr>
                    <th style={{width:44,background:"#0d1117",border:"1px solid #1c2128"}}></th>
                    {dates.map((d,i)=>{
                      const isToday=toYMD(d)===todayStr;
                      return(
                        <th key={i} style={{background:isToday?"#1e1b4b":"#161b22",border:"1px solid #1c2128",padding:"6px 4px",textAlign:"center",minWidth:80}}>
                          <div style={{fontSize:10,color:i>=5?"#f87171":"#6e7681"}}>{DAYS[i]}</div>
                          <div style={{fontSize:13,fontWeight:700,color:isToday?"#818cf8":"#e6edf3"}}>{d.getMonth()+1}/{d.getDate()}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map(slot=>{
                    const isHour=slot%60===0;
                    const curMin=getNowMin();
                    return(
                      <tr key={slot} style={{height:22}}>
                        <td style={{background:"#0d1117",border:"1px solid #1c2128",textAlign:"right",padding:"0 6px",verticalAlign:"middle",borderTop:isHour?"1px solid #2d333b":"1px solid #1c2128"}}>
                          {isHour&&<span style={{fontSize:10,color:"#4d5562",whiteSpace:"nowrap"}}>{t2s(slot)}</span>}
                        </td>
                        {dates.map((d,i)=>{
                          const ymd=toYMD(d);
                          const cell=getCellInfo(d,slot);
                          const isPast=ymd<todayStr||(ymd===todayStr&&slot<curMin);
                          const isToday=ymd===todayStr;
                          if(cell.type==="covered")return null;
                          if(cell.type==="empty"){
                            return(<td key={i} style={{background:isPast?"#0a0e17":isToday?"#11172e":"#161b22",border:"1px solid #1c2128",borderTop:isHour?"1px solid #2d333b":"1px solid #1c2128",opacity:isPast?0.4:1}}/>);
                          }
                          const res=cell.res,tc=res.teamColor||"#6366f1",isFixed=res._type==="fixed",span=res.duration/SLOT;
                          return(
                            <td key={i} rowSpan={span}
                              onClick={()=>setModal({kind:"cancel",ymd,res,pwInput:"",pwErr:false})}
                              style={{backgroundColor:tc+(isFixed?"1a":"28"),borderLeft:`3px ${isFixed?"dashed":"solid"} ${tc}`,border:`1px solid ${tc}33`,cursor:"pointer",verticalAlign:"top",padding:"3px 4px"}}
                            >
                              <div style={{color:tc,fontSize:11,fontWeight:700,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isFixed?"📌 ":""}{res.teamName}</div>
                              <div style={{color:tc+"aa",fontSize:10,lineHeight:1.2}}>{t2s(res.startMinute)}~{t2s(res.startMinute+res.duration)}</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-4 mt-3 text-xs text-gray-600 items-center">
              <span className="flex items-center gap-1.5"><span style={{display:"inline-block",width:12,height:12,borderRadius:2,background:"#3b82f628",borderLeft:"3px solid #3b82f6"}}/>일반 예약</span>
              <span className="flex items-center gap-1.5"><span style={{display:"inline-block",width:12,height:12,borderRadius:2,background:"#3b82f61a",borderLeft:"3px dashed #3b82f6"}}/>고정 일정</span>
            </div>
            <div className="mt-5">
              {teams.length>0?(
                <><p className="text-xs text-gray-500 mb-2">팀을 선택해서 예약하세요</p>
                <div className="flex flex-wrap gap-2">
                  {teams.map(team=>(
                    <button key={team.id}
                      onClick={()=>setModal({kind:"reserve",step:1,team,pwInput:"",pwErr:false,dayIdx:defaultDayIdx,startMinute:S_MIN,duration:60,fixed:false,endDate:addMonths(3)})}
                      style={{backgroundColor:team.color+"1a",border:`1.5px solid ${team.color}`,color:team.color}}
                      className="px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-80 transition-opacity">
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
      {modal&&<ModalRoot modal={modal} setModal={setModal} teams={teams} dates={dates} data={data} fss={fss} doReserve={doReserve} doCancel={doCancel} cancelFsDay={cancelFsDay} deleteFs={deleteFs} hasConflict={hasConflict}/>}
      <footer style={{marginTop:48,paddingBottom:24,textAlign:"center"}}>
        <p style={{fontSize:11,color:"#4d5562"}}>이 사이트는 박기남이 제작했습니다. © 2026 All rights reserved.</p>
      </footer>
    </div>
  );
}

function AdminPanel({teams,fss,onCreate,onUpdate,onDelete,onDeleteFs,onLogout}){
  const[section,setSection]=useState("teams");
  const[showForm,setShowForm]=useState(false);
  const[editId,setEditId]=useState(null);
  const[form,setForm]=useState({name:"",color:COLORS[5],password:""});
  const[busy,setBusy]=useState(false);
  const[delId,setDelId]=useState(null);
  const[delFsId,setDelFsId]=useState(null);
  const[submitErr,setSubmitErr]=useState("");
  const sf=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const reset=()=>{setForm({name:"",color:COLORS[5],password:""});setEditId(null);setShowForm(false);setSubmitErr("");};
  const startEdit=t=>{setForm({name:t.name,color:t.color,password:t.password});setEditId(t.id);setShowForm(true);};
  const submit=async()=>{
    if(!form.name.trim()||!form.password.trim())return;
    setBusy(true);setSubmitErr("");
    try{
      if(editId)await onUpdate(editId,{name:form.name.trim(),color:form.color,password:form.password.trim()});
      else await onCreate(form.name.trim(),form.color,form.password.trim());
      reset();
    }catch(e){
      setSubmitErr("오류: "+(e?.message||String(e)));
    }finally{setBusy(false);}
  };
  return(
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          <button onClick={()=>setSection("teams")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${section==="teams"?"bg-indigo-700 text-white":"text-gray-400 hover:text-gray-200"}`}>팀 관리</button>
          <button onClick={()=>setSection("fixed")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${section==="fixed"?"bg-indigo-700 text-white":"text-gray-400 hover:text-gray-200"}`}>고정 일정{fss.length>0&&` (${fss.length})`}</button>
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
                {submitErr&&<p className="text-xs text-red-400 mt-2 p-2 bg-red-950 rounded-lg break-all">{submitErr}</p>}
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
                  <p className="text-xs text-gray-500">매주 {DAYS[fs.dayOfWeek]}요일 {t2s(fs.startMinute)}~{t2s(fs.startMinute+fs.duration)} ({durLabel(fs.duration)})</p>
                  <p className="text-xs text-gray-600">{fs.startDate} ~ {fs.endDate}{fs.cancelledDates?.length>0&&` · ${fs.cancelledDates.length}일 제외`}</p>
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

function ModalRoot({modal,setModal,teams,dates,data,fss,doReserve,doCancel,cancelFsDay,deleteFs,hasConflict}){
  const[busy,setBusy]=useState(false);
  const close=()=>setModal(null);
  const upd=u=>setModal(m=>({...m,...u}));
  const checkPw=()=>{if(modal.pwInput===modal.team.password)upd({step:2,pwErr:false});else upd({pwErr:true});};
  const selYMD=(modal.kind==="reserve"&&modal.step===2)?toYMD(dates[modal.dayIdx]):null;
  const conflict=selYMD?hasConflict(selYMD,modal.startMinute,modal.duration):false;
  const maxDur=Math.min(MAX_DUR,E_MIN-(modal.startMinute||S_MIN));
  const durOptions=Array.from({length:maxDur/SLOT},(_,i)=>(i+1)*SLOT);
  const endMinute=(modal.startMinute||S_MIN)+(modal.duration||60);
  const tc=modal.team?.color||"#6366f1";

  const confirmReserve=async()=>{
    if(busy||conflict)return;
    setBusy(true);
    const ymd=toYMD(dates[modal.dayIdx]);
    const result=await doReserve(ymd,modal.startMinute,modal.duration,modal.team,modal.fixed,modal.endDate);
    setBusy(false);
    if(result==="conflict")upd({conflict:true});
    else close();
  };

  const confirmCancel=async mode=>{
    if(busy)return;
    const res=modal.res;
    if(res?.teamId){
      const team=teams.find(t=>t.id===res.teamId);
      if(team){if((modal.pwInput||"")!==team.password){upd({pwErr:true});return;}}
      else{if(!(modal.pwInput||"")){upd({pwErr:true});return;}}
    }
    setBusy(true);
    if(res?._type==="fixed"){if(mode==="single")await cancelFsDay(res.id,modal.ymd);else await deleteFs(res.id);}
    else await doCancel(modal.ymd,res.id);
    setBusy(false);close();
  };

  return(
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
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500 block mb-1">시작 시간</label><select value={modal.startMinute} onChange={e=>upd({startMinute:Number(e.target.value),duration:Math.min(modal.duration,Math.min(MAX_DUR,E_MIN-Number(e.target.value)))})} className={sel}>{SLOTS.map(s=><option key={s} value={s}>{t2s(s)}</option>)}</select></div>
                <div><label className="text-xs text-gray-500 block mb-1">사용 시간</label><select value={modal.duration} onChange={e=>upd({duration:Number(e.target.value)})} className={sel}>{durOptions.map(d=><option key={d} value={d}>{durLabel(d)}</option>)}</select></div>
              </div>
              <div className="bg-gray-950 rounded-lg px-3 py-2 flex items-center justify-between"><span className="text-xs text-gray-500">종료 시간</span><span className="text-sm font-bold text-indigo-300">{t2s(endMinute)}</span></div>
              {conflict&&<div className="text-xs text-amber-400 bg-amber-950 border border-amber-800 rounded-lg px-3 py-2">⚠️ 이미 예약된 시간과 겹칩니다</div>}
              <label className="flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={modal.fixed} onChange={e=>upd({fixed:e.target.checked})} className="w-4 h-4" style={{accentColor:tc}}/><span className="text-sm text-gray-300">📌 고정 일정 (매주 반복)</span></label>
              {modal.fixed&&(
                <div className="bg-gray-950 border border-gray-700 rounded-lg p-3">
                  <label className="text-xs text-gray-400 block mb-2">종료일 <span className="text-gray-600">(5주 범위 밖도 가능)</span></label>
                  <input type="date" value={modal.endDate} min={selYMD||toYMD(new Date())} onChange={e=>upd({endDate:e.target.value})} className={sel}/>
                  <p className="text-xs text-gray-600 mt-1.5">매주 {DAYS[modal.dayIdx]}요일에 반복됩니다</p>
                </div>
              )}
            </div>
            <div className="flex gap-2"><button onClick={()=>upd({step:1})} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200">이전</button><button onClick={confirmReserve} disabled={busy||conflict} className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{background:tc}}>{busy?"예약 중…":"예약 완료"}</button></div>
          </>
        )}
        {modal.kind==="cancel"&&(()=>{
          const res=modal.res,isFixed=res?._type==="fixed",rtc=res?.teamColor||"#a5b4fc";
          const dayIdx=dates.findIndex(d=>toYMD(d)===modal.ymd);
          return(
            <>
              <h2 className="text-base font-bold text-gray-100 mb-1">예약 정보</h2>
              <p className="text-xs text-gray-500 mb-4">{modal.ymd} {dayIdx>=0?DAYS[dayIdx]:""} · {t2s(res.startMinute)} ~ {t2s(res.startMinute+res.duration)} ({durLabel(res.duration)})</p>
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2"><div style={{width:10,height:10,borderRadius:2,background:rtc,flexShrink:0}}/><span className="text-sm font-bold" style={{color:rtc}}>{res?.teamName||"예약"}</span>{isFixed&&<span className="text-xs">📌</span>}</div>
                {isFixed&&<p className="text-xs text-amber-400 mt-1">매주 반복 · {res.endDate}까지</p>}
              </div>
              {res?.teamId&&(
                <div className="mb-4">
                  <label className="text-xs text-gray-500 block mb-1">팀 비밀번호 *</label>
                  <input type="password" autoFocus value={modal.pwInput||""} onChange={e=>upd({pwInput:e.target.value,pwErr:false})} onKeyDown={e=>e.key==="Enter"&&confirmCancel(isFixed?null:"single")} placeholder="취소하려면 비밀번호 입력" className={sel} style={modal.pwErr?{borderColor:"#ef4444"}:{}}/>
                  {modal.pwErr&&<p className="text-xs text-red-400 mt-1">비밀번호가 올바르지 않습니다</p>}
                </div>
              )}
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
