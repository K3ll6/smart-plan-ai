let tasks=[];

async function api(url, opts={}){const r=await fetch(url,opts);const d=await r.json();if(!r.ok)throw new Error(d.error||"Có lỗi");return d}

async function load(){
  tasks=await api("/api/tasks");
  render();
  const h=await api("/api/health");
  document.getElementById("sysStatus").textContent=(h.ai?"AI đã kết nối":"Chế độ demo AI")+" · "+(h.database?"Database đã kết nối":"lưu tạm");
}
function showView(v){
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  document.getElementById(v).classList.add("active");
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===v));
  document.getElementById("pageTitle").textContent={dashboard:"Tổng quan",tasks:"Nhiệm vụ",timeline:"Timeline",ai:"SMART AI"}[v];
}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>showView(b.dataset.view));

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function badge(t){return t.status==="DONE"?'<span class="badge done">HOÀN THÀNH</span>':t.status==="DOING"?'<span class="badge doing">ĐANG LÀM</span>':`<span class="badge ${t.priority==="HIGH"?"high":""}">${t.priority==="HIGH"?"ƯU TIÊN CAO":"CHƯA THỰC HIỆN"}</span>`}
function taskHtml(t){
  return `<div class="task" onclick="openTask('${esc(t.id)}')"><div class="bar ${t.priority?.toLowerCase()||"normal"}"></div><div><div class="task-title">${esc(t.title)}</div><div class="task-meta">◷ ${esc(t.date_text)} ${esc(t.time_text)} · ${esc(t.location||"Chưa xác định địa điểm")} · ${esc(t.responsible||"Chưa xác định đơn vị")}</div></div>${badge(t)}</div>`
}
function render(){
  document.getElementById("total").textContent=tasks.length;
  document.getElementById("high").textContent=tasks.filter(t=>t.priority==="HIGH").length;
  document.getElementById("doing").textContent=tasks.filter(t=>t.status==="DOING").length;
  document.getElementById("done").textContent=tasks.filter(t=>t.status==="DONE").length;
  document.getElementById("nextTasks").innerHTML=tasks.slice(0,5).map(taskHtml).join("")||"<div class='task-meta'>Chưa có nhiệm vụ. Hãy upload kế hoạch.</div>";
  const f=document.getElementById("filter")?.value||"ALL";
  let filtered=tasks.filter(t=>f==="ALL"||(f==="HIGH"&&t.priority==="HIGH")||(f===t.status));
  document.getElementById("allTasks").innerHTML=filtered.map(taskHtml).join("")||"<div class='task-meta'>Không có nhiệm vụ phù hợp.</div>";
  document.getElementById("timelineList").innerHTML=tasks.map(t=>`<div class="timeline-item"><div class="timebox">${esc(t.date_text)}<br><span class="task-meta">${esc(t.time_text)}</span></div><div class="dotcol"><div class="dot"></div></div><div class="timeline-card"><b>${esc(t.title)}</b><div class="task-meta">${esc(t.location)} · ${esc(t.responsible)}</div></div></div>`).join("");
}
async function openTask(id){
  const t=await api("/api/tasks/"+encodeURIComponent(id));
  document.getElementById("modalContent").innerHTML=`
    <span class="eyebrow">CHI TIẾT NHIỆM VỤ</span><h2>${esc(t.title)}</h2>
    <div class="detail-grid">
      <div class="detail"><small>THỜI GIAN</small>${esc(t.date_text)} ${esc(t.time_text)}</div>
      <div class="detail"><small>ĐỊA ĐIỂM</small>${esc(t.location)||"Chưa xác định"}</div>
      <div class="detail"><small>CHỦ TRÌ / PHỤ TRÁCH</small>${esc(t.responsible)||"Chưa xác định"}</div>
      <div class="detail"><small>LỰC LƯỢNG</small>${esc(t.participants)||"Chưa xác định"}</div>
    </div>
    <p>${esc(t.description)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="ai-btn" onclick="aiPlan('${esc(t.id)}')">✦ Xác định hướng tổ chức, triển khai</button>
      <button class="outline-btn" onclick="setStatus('${esc(t.id)}','DOING')">Đang thực hiện</button>
      <button class="outline-btn" onclick="setStatus('${esc(t.id)}','DONE')">Hoàn thành</button>
    </div>
    <div id="aiResult" class="ai-result"></div>`;
  document.getElementById("modal").classList.add("show");
}
function closeModal(){document.getElementById("modal").classList.remove("show")}
async function setStatus(id,status){
  try{
    await api("/api/tasks/"+encodeURIComponent(id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
    tasks=await api("/api/tasks");
    render();
    await openTask(id);
    toast(status==="DONE"?"✓ Đã đánh dấu hoàn thành":status==="DOING"?"Đã chuyển sang đang thực hiện":"Đã cập nhật trạng thái");
  }catch(e){toast(e.message)}
}
async function aiPlan(id){
  const box=document.getElementById("aiResult");box.innerHTML="<div class='ai-section'><b>✦ AI đang phân tích nhiệm vụ...</b></div>";
  try{
    const d=await api("/api/tasks/"+encodeURIComponent(id)+"/ai-plan",{method:"POST"});
    box.innerHTML=`
      <div class="ai-section"><h4>🎯 Mục tiêu</h4><ul>${(d.objective||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="ai-section"><h4>👥 Lực lượng</h4><ul>${(d.forces||[]).map(x=>`<li><b>${esc(x.role)}:</b> ${esc(x.unit)}</li>`).join("")}</ul></div>
      <div class="ai-section"><h4>🧭 Các bước tiến hành</h4><ol>${(d.steps||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ol></div>
      <div class="ai-section"><h4>☑ Checklist</h4>${(d.checklist||[]).map(x=>`<label class="check"><input type="checkbox"/> ${esc(x)}</label>`).join("")}</div>
      <div class="ai-section"><h4>⚠ Rủi ro cần lưu ý</h4><ul>${(d.risks||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="ai-section"><h4>💡 Đề xuất của AI</h4><ul>${(d.suggestions||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }catch(e){box.innerHTML=`<div class="ai-section" style="color:#a73737">${esc(e.message)}</div>`}
}
document.getElementById("file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  toast("Đang phân tích kế hoạch bằng AI...");
  const fd=new FormData();fd.append("file",file);
  try{
    const d=await api("/api/upload",{method:"POST",body:fd});
    tasks=await api("/api/tasks");render();toast(`Đã phân tích ${d.count} nhiệm vụ`);showView("tasks");
  }catch(err){toast(err.message)}
  e.target.value="";
});
async function askAI(){
  const input=document.getElementById("chatInput");const msg=input.value.trim();if(!msg)return;
  const log=document.getElementById("chatLog");log.innerHTML+=`<div class="bubble user">${esc(msg)}</div>`;input.value="";
  try{const d=await api("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:msg})});log.innerHTML+=`<div class="bubble ai">${esc(d.answer)}</div>`;log.scrollTop=log.scrollHeight}catch(e){log.innerHTML+=`<div class="bubble ai">${esc(e.message)}</div>`}
}
document.getElementById("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter")askAI()});
function toast(s){const x=document.getElementById("toast");x.textContent=s;x.style.display="block";clearTimeout(window.__t);window.__t=setTimeout(()=>x.style.display="none",3000)}
load().catch(console.error);