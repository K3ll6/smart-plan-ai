let tasks=[];
let token=localStorage.getItem("smart_plan_token")||"";
let currentUser=null;
let registerMode=false;

const $=id=>document.getElementById(id);
async function api(url,opts={}){
  opts.headers={...(opts.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};
  const r=await fetch(url,opts);
  let d={};try{d=await r.json()}catch{}
  if(r.status===401){logout();throw new Error(d.error||"Phiên đăng nhập hết hạn")}
  if(!r.ok)throw new Error(d.error||"Có lỗi");
  return d;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function getWeekday(dateText){
  const m=String(dateText||"").match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if(!m)return "";
  let y=Number(m[3]);if(y<100)y+=2000;
  const d=new Date(y,Number(m[2])-1,Number(m[1]));
  return ["Chủ nhật","Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7"][d.getDay()];
}
function dateLabel(t){const w=getWeekday(t.date_text);return w?`${w}, ${t.date_text}`:(t.date_text||"Chưa xác định ngày")}
function badge(t){return t.status==="DONE"?'<span class="badge done">HOÀN THÀNH</span>':t.status==="DOING"?'<span class="badge doing">ĐANG LÀM</span>':`<span class="badge ${t.priority==="HIGH"?"high":""}">${t.priority==="HIGH"?"ƯU TIÊN CAO":"CHƯA THỰC HIỆN"}</span>`}
function taskHtml(t){
 return `<div class="task" onclick="openTask('${esc(t.id)}')"><div class="bar ${t.priority?.toLowerCase()||"normal"}"></div><div><div class="task-title">${esc(t.title)}</div><div class="task-meta">◷ ${esc(dateLabel(t))} ${esc(t.time_text)} · ${esc(t.location||"Chưa xác định địa điểm")} · ${esc(t.responsible||"Chưa xác định đơn vị")}</div></div><div class="task-actions">${badge(t)}<button class="delete-mini" onclick="event.stopPropagation();deleteTask('${esc(t.id)}')" title="Xóa nhiệm vụ">🗑</button></div></div>`
}
function render(){
 $("total").textContent=tasks.length;$("high").textContent=tasks.filter(t=>t.priority==="HIGH").length;$("doing").textContent=tasks.filter(t=>t.status==="DOING").length;$("done").textContent=tasks.filter(t=>t.status==="DONE").length;
 $("nextTasks").innerHTML=tasks.slice(0,5).map(taskHtml).join("")||"<div class='task-meta'>Chưa có nhiệm vụ. Hãy upload kế hoạch.</div>";
 const f=$("filter")?.value||"ALL";
 const filtered=tasks.filter(t=>f==="ALL"||(f==="HIGH"&&t.priority==="HIGH")||(f===t.status));
 $("allTasks").innerHTML=filtered.map(taskHtml).join("")||"<div class='task-meta'>Không có nhiệm vụ phù hợp.</div>";
 $("timelineList").innerHTML=tasks.map(t=>`<div class="timeline-item"><div class="timebox">${esc(dateLabel(t))}<br><span class="task-meta">${esc(t.time_text)}</span></div><div class="dotcol"><div class="dot"></div></div><div class="timeline-card"><b>${esc(t.title)}</b><div class="task-meta">${esc(t.location)} · ${esc(t.responsible)}</div></div></div>`).join("");
}
function showView(v){
 document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$(v).classList.add("active");
 document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===v));
 $("pageTitle").textContent={dashboard:"Tổng quan",tasks:"Nhiệm vụ",timeline:"Timeline",ai:"SMART AI"}[v];
}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>showView(b.dataset.view));

function setAuthMode(reg){
 registerMode=reg;$("authTitle").textContent=reg?"Đăng ký":"Đăng nhập";$("authSubmit").textContent=reg?"Tạo tài khoản":"Đăng nhập";$("nameWrap").classList.toggle("hidden",!reg);$("switchAuth").textContent=reg?"Đã có tài khoản? Đăng nhập":"Chưa có tài khoản? Đăng ký";$("authError").textContent="";
}
$("switchAuth").onclick=()=>setAuthMode(!registerMode);
$("authForm").onsubmit=async e=>{
 e.preventDefault();$("authError").textContent="";
 try{
  const body={username:$("username").value,password:$("password").value,name:$("name").value};
  const d=await api(registerMode?"/api/auth/register":"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  token=d.token;localStorage.setItem("smart_plan_token",token);currentUser=d.user;enterApp();
 }catch(err){$("authError").textContent=err.message}
};
async function enterApp(){
 $("authScreen").classList.add("hidden");$("appScreen").classList.remove("hidden");
 $("userName").textContent=currentUser?.name||currentUser?.username||"Người dùng";$("userAccount").textContent="@"+(currentUser?.username||"");$("avatar").textContent=(currentUser?.name||currentUser?.username||"U").charAt(0).toUpperCase();
 try{tasks=await api("/api/tasks");render();const h=await api("/api/health");$("sysStatus").textContent=(h.ai?"AI đã kết nối":"Chế độ demo AI")+" · "+(h.database?"Database dùng chung":"lưu tạm theo phiên")}
 catch(e){$("sysStatus").textContent="Không tải được dữ liệu"}
}
function logout(){token="";currentUser=null;localStorage.removeItem("smart_plan_token");$("appScreen").classList.add("hidden");$("authScreen").classList.remove("hidden");setAuthMode(false)}
async function openTask(id){
 const t=await api("/api/tasks/"+encodeURIComponent(id));
 $("modalContent").innerHTML=`<span class="eyebrow">NHIỆM VỤ RIÊNG CỦA TÔI</span><h2>${esc(t.title)}</h2>
 <div class="detail-grid"><div class="detail"><small>THỜI GIAN</small>${esc(dateLabel(t))} ${esc(t.time_text)}</div><div class="detail"><small>ĐỊA ĐIỂM</small>${esc(t.location)||"Chưa xác định"}</div><div class="detail"><small>CHỦ TRÌ / PHỤ TRÁCH</small>${esc(t.responsible)||"Chưa xác định"}</div><div class="detail"><small>LỰC LƯỢNG</small>${esc(t.participants)||"Chưa xác định"}</div></div>
 <p>${esc(t.description)}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ai-btn" onclick="aiPlan('${esc(t.id)}')">✦ Xác định hướng tổ chức, triển khai</button><button class="outline-btn" onclick="setStatus('${esc(t.id)}','DOING')">Đang thực hiện</button><button class="outline-btn" onclick="setStatus('${esc(t.id)}','DONE')">Hoàn thành</button><button class="outline-btn danger-btn" onclick="deleteTask('${esc(t.id)}')">🗑 Xóa nhiệm vụ</button></div><div id="aiResult" class="ai-result"></div>`;
 $("modal").classList.add("show");
}
function closeModal(){$("modal").classList.remove("show")}
async function setStatus(id,status){
 try{await api("/api/tasks/"+encodeURIComponent(id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});tasks=await api("/api/tasks");render();await openTask(id);toast(status==="DONE"?"✓ Đã đánh dấu hoàn thành":"Đã cập nhật trạng thái")}
 catch(e){toast(e.message)}
}
async function deleteTask(id){
 const t=tasks.find(x=>String(x.id)===String(id));if(!t)return;
 if(!confirm(`Xóa nhiệm vụ "${t.title}"?`))return;
 try{await api("/api/tasks/"+encodeURIComponent(id),{method:"DELETE"});tasks=await api("/api/tasks");render();closeModal();toast("✓ Đã xóa nhiệm vụ")}
 catch(e){toast(e.message)}
}
async function aiPlan(id){
 const box=$("aiResult");box.innerHTML="<div class='ai-section'><b>✦ AI đang phân tích nhiệm vụ...</b></div>";
 try{const d=await api("/api/tasks/"+encodeURIComponent(id)+"/ai-plan",{method:"POST"});
 box.innerHTML=`<div class="ai-section"><h4>🎯 Mục tiêu</h4><ul>${(d.objective||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div><div class="ai-section"><h4>👥 Lực lượng</h4><ul>${(d.forces||[]).map(x=>`<li><b>${esc(x.role)}:</b> ${esc(x.unit)}</li>`).join("")}</ul></div><div class="ai-section"><h4>🧭 Các bước tiến hành</h4><ol>${(d.steps||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ol></div><div class="ai-section"><h4>☑ Checklist</h4>${(d.checklist||[]).map(x=>`<label class="check"><input type="checkbox"/> ${esc(x)}</label>`).join("")}</div><div class="ai-section"><h4>⚠ Rủi ro cần lưu ý</h4><ul>${(d.risks||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div><div class="ai-section"><h4>💡 Đề xuất của AI</h4><ul>${(d.suggestions||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
 }catch(e){box.innerHTML=`<div class="ai-section" style="color:#a73737">${esc(e.message)}</div>`}
}
$("file").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;toast("Đang phân tích kế hoạch...");
 const fd=new FormData();fd.append("file",file);
 try{const d=await api("/api/upload",{method:"POST",body:fd});tasks=await api("/api/tasks");render();toast(`Đã phân tích ${d.count} nhiệm vụ vào tài khoản của bạn`);showView("tasks")}
 catch(err){toast(err.message)}e.target.value="";
});
async function askAI(){
 const input=$("chatInput"),msg=input.value.trim();if(!msg)return;
 const log=$("chatLog");log.innerHTML+=`<div class="bubble user">${esc(msg)}</div>`;input.value="";
 try{const d=await api("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:msg})});log.innerHTML+=`<div class="bubble ai">${esc(d.answer)}</div>`;log.scrollTop=log.scrollHeight}
 catch(e){log.innerHTML+=`<div class="bubble ai">${esc(e.message)}</div>`}
}
$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter")askAI()});

(async()=>{
 if(!token){setAuthMode(false);return}
 try{const d=await api("/api/auth/me");currentUser=d.user;enterApp()}catch{logout()}
})();