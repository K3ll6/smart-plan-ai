import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({limit:"10mb"}));
app.use(express.static(path.join(__dirname,"public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits:{fileSize:15*1024*1024}
});

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY})
  : null;

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const supabaseAnon = SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const memory = { users:[], tasks:[], plans:[] };

async function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token || !supabaseAnon)return res.status(401).json({error:"Phiên đăng nhập không hợp lệ"});
  try{
    const {data,error}=await supabaseAnon.auth.getUser(token);
    if(error||!data?.user)return res.status(401).json({error:"Phiên đăng nhập đã hết hạn"});
    const u=data.user;
    req.user={id:u.id,email:u.email,username:u.user_metadata?.username||u.email?.split("@")[0]||"user",name:u.user_metadata?.name||u.email?.split("@")[0]||"user"};
    next();
  }catch{return res.status(401).json({error:"Phiên đăng nhập đã hết hạn"});}
}

function cleanJson(s){
  if(!s)return null;
  const x=s.replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim();
  try{return JSON.parse(x)}catch{
    const a=Math.min(...["[","{"].map(c=>{const i=x.indexOf(c);return i<0?999999:i}));
    try{return JSON.parse(x.slice(a))}catch{return null}
  }
}
function parseDateTime(t){
  const s=`${t.date_text||""} ${t.time_text||""}`;
  const m=s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}).*?(\d{1,2})(?::|h)?(\d{2})?/i);
  if(!m)return Number.MAX_SAFE_INTEGER;
  let y=Number(m[3]);if(y<100)y+=2000;
  return new Date(y,Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5]||0)).getTime();
}
function sortTasks(a){return [...a].sort((x,y)=>parseDateTime(x)-parseDateTime(y))}
function demoTasks(userId){
  return [
    {id:`${userId}-demo-1`,user_id:userId,title:"Hội nghị triển khai nhiệm vụ",description:"Tổ chức hội nghị triển khai nhiệm vụ theo kế hoạch.",date_text:"02/09/2026",time_text:"08:00",location:"Hội trường",responsible:"Phòng Đào tạo",participants:"Các cơ quan, khoa, đơn vị liên quan",priority:"HIGH",status:"TODO",ai_plan:null},
    {id:`${userId}-demo-2`,user_id:userId,title:"Kiểm tra công tác chuẩn bị",description:"Kiểm tra cơ sở vật chất, lực lượng và các nội dung bảo đảm.",date_text:"03/09/2026",time_text:"14:00",location:"Khu vực tổ chức",responsible:"Bộ phận bảo đảm",participants:"Lực lượng phục vụ",priority:"NORMAL",status:"TODO",ai_plan:null},
    {id:`${userId}-demo-3`,user_id:userId,title:"Tổ chức sinh hoạt, tuyên truyền",description:"Triển khai nội dung tuyên truyền, giáo dục theo kế hoạch.",date_text:"04/09/2026",time_text:"19:30",location:"Đơn vị",responsible:"Phòng Chính trị",participants:"Cán bộ, học viên",priority:"NORMAL",status:"TODO",ai_plan:null}
  ];
}



async function getTasks(userId){
  if(supabase){
    const {data,error}=await supabase.from("tasks").select("*").eq("user_id",userId);
    if(error)throw error;
    return sortTasks(data||[]);
  }
  let rows=memory.tasks.filter(x=>String(x.user_id)===String(userId));
  if(!rows.length){rows=demoTasks(userId);memory.tasks.push(...rows);}
  return sortTasks(rows);
}

async function getTask(userId,id){
  const tasks=await getTasks(userId);
  return tasks.find(x=>String(x.id)===String(id));
}
async function updateTask(userId,id,patch){
  if(supabase){
    const {data,error}=await supabase.from("tasks").update(patch).eq("id",id).eq("user_id",userId).select().single();
    if(!error)return data;
  }
  const idx=memory.tasks.findIndex(x=>String(x.id)===String(id)&&String(x.user_id)===String(userId));
  if(idx<0)return null;
  memory.tasks[idx]={...memory.tasks[idx],...patch};
  return memory.tasks[idx];
}
async function deleteTask(userId,id){
  if(supabase){
    const {data,error}=await supabase.from("tasks").delete().eq("id",id).eq("user_id",userId).select();
    if(error)throw error;
    return !!data?.length;
  }
  const idx=memory.tasks.findIndex(x=>String(x.id)===String(id)&&String(x.user_id)===String(userId));
  if(idx<0)return false;
  memory.tasks.splice(idx,1);return true;
}
async function savePlanAndTasks(userId,title,sourceName,rawText,tasks){
  if(supabase){
    const {data:plan,error:pe}=await supabase.from("plans").insert({user_id:userId,title,source_name:sourceName,raw_text:rawText}).select().single();
    if(!pe&&plan){
      const rows=tasks.map(t=>({user_id:userId,plan_id:plan.id,title:t.title||"Nhiệm vụ",description:t.description||"",date_text:t.date_text||"",time_text:t.time_text||"",location:t.location||"",responsible:t.responsible||"",participants:t.participants||"",priority:t.priority||"NORMAL",status:"TODO",ai_plan:t.ai_plan||null}));
      const {data}=await supabase.from("tasks").insert(rows).select();
      return data||[];
    }
  }
  const planId=`${userId}-plan-${Date.now()}`;
  memory.plans.push({id:planId,user_id:userId,title,source_name:sourceName,raw_text:rawText});
  const rows=tasks.map((t,i)=>({...t,id:`${userId}-task-${Date.now()}-${i}`,user_id:userId,plan_id:planId,status:"TODO"}));
  memory.tasks.push(...rows);return rows;
}
async function extractText(file){
  const ext=path.extname(file.originalname).toLowerCase();
  if(ext===".docx"){const r=await mammoth.extractRawText({buffer:file.buffer});return r.value}
  if(ext===".pdf"){const r=await pdfParse(file.buffer);return r.text}
  return "";
}
async function callText(prompt){
  if(!ai)return null;
  const r=await ai.models.generateContent({model:process.env.GEMINI_MODEL||"gemini-2.5-flash",contents:prompt,config:{responseMimeType:"application/json"}});
  return r.text;
}
async function callVision(prompt,file){
  if(!ai)return null;
  const r=await ai.models.generateContent({
    model:process.env.GEMINI_MODEL||"gemini-2.5-flash",
    contents:[{role:"user",parts:[{text:prompt},{inlineData:{mimeType:file.mimetype||"image/jpeg",data:file.buffer.toString("base64")}}]}],
    config:{responseMimeType:"application/json"}
  });
  return r.text;
}

app.get("/api/health",async(req,res)=>{
  let db=false;
  if(supabase){try{const {error}=await supabase.from("tasks").select("id",{count:"exact",head:true});db=!error}catch{}}
  res.json({ok:true,ai:!!ai,database:db,demoAI:true,aiMode:ai?"REAL":"DEMO",supabaseAuth:!!supabaseAnon});
});

// AUTH - Supabase Auth
app.post("/api/auth/register",async(req,res)=>{
  try{
    if(!supabaseAnon)return res.status(500).json({error:"Chưa cấu hình SUPABASE_ANON_KEY"});
    const u=String(req.body?.username||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    const name=String(req.body?.name||"").trim()||u;
    if(u.length<3)return res.status(400).json({error:"Tài khoản phải có ít nhất 3 ký tự"});
    if(!/^[a-z0-9._-]+$/.test(u))return res.status(400).json({error:"Tài khoản không hợp lệ"});
    if(password.length<6)return res.status(400).json({error:"Mật khẩu phải có ít nhất 6 ký tự"});
    const {data,error}=await supabaseAnon.auth.signUp({email:`${u}@smartplan.local`,password,options:{data:{username:u,name}}});
    if(error)return res.status(400).json({error:error.message});
    if(!data.session)return res.status(400).json({error:"Supabase đang yêu cầu xác nhận email. Hãy tắt Email Confirm trong Authentication > Providers > Email."});
    res.json({user:{id:data.user.id,username:u,name},token:data.session.access_token});
  }catch(e){console.error(e);res.status(500).json({error:"Không thể tạo tài khoản"})}
});
app.post("/api/auth/login",async(req,res)=>{
  try{
    if(!supabaseAnon)return res.status(500).json({error:"Chưa cấu hình SUPABASE_ANON_KEY"});
    const u=String(req.body?.username||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    const {data,error}=await supabaseAnon.auth.signInWithPassword({email:`${u}@smartplan.local`,password});
    if(error||!data.session)return res.status(401).json({error:"Tài khoản hoặc mật khẩu không đúng"});
    const user=data.user;
    res.json({user:{id:user.id,username:user.user_metadata?.username||u,name:user.user_metadata?.name||u},token:data.session.access_token});
  }catch(e){console.error(e);res.status(500).json({error:"Không thể đăng nhập"})}
});
app.get("/api/auth/me",auth,async(req,res)=>res.json({user:req.user}));

// TASKS
app.get("/api/tasks",auth,async(req,res)=>res.json((await getTasks(req.user.id)).filter(t=>String(t.user_id)===String(req.user.id))));
app.get("/api/my-scope",auth,async(req,res)=>res.json({user:req.user,tasks:(await getTasks(req.user.id)).filter(t=>String(t.user_id)===String(req.user.id)).map(t=>({id:t.id,title:t.title,user_id:t.user_id}))}));
app.get("/api/tasks/:id",auth,async(req,res)=>{
  const t=await getTask(req.user.id,req.params.id);
  if(!t)return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
  res.json(t);
});
app.patch("/api/tasks/:id",auth,async(req,res)=>{
  const t=await updateTask(req.user.id,req.params.id,req.body||{});
  if(!t)return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
  res.json(t);
});
app.delete("/api/tasks/:id",auth,async(req,res)=>{
  const ok=await deleteTask(req.user.id,req.params.id);
  if(!ok)return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
  res.json({ok:true});
});

app.post("/api/upload",auth,upload.single("file"),async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:"Chưa chọn file"});
    const text=await extractText(req.file);
    const isImage=req.file.mimetype.startsWith("image/");
    let parsed=null;
    if(ai){
      try{
        const prompt=`Bóc tách tài liệu kế hoạch thành nhiệm vụ quản lý. Chỉ lấy dữ liệu có trong tài liệu. Trả JSON {"title":"","tasks":[{"title":"","description":"","date_text":"","time_text":"","location":"","responsible":"","participants":"","priority":"HIGH|NORMAL|LOW"}]}\n${(text||"[Ảnh]").slice(0,60000)}`;
        parsed=cleanJson(isImage?await callVision(prompt,req.file):await callText(prompt));
      }catch(e){console.warn("Gemini upload unavailable, switching to demo:",e.message)}
    }
    if(!parsed){
      const lines=(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const candidates=[];
      for(const line of lines){
        if(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(line)){
          const date=(line.match(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/)||[""])[0];
          const time=(line.match(/\b\d{1,2}(?::|h)\d{0,2}\b/)||[""])[0];
          const parts=line.split(/\t|\|/).map(x=>x.trim()).filter(Boolean);
          const title=parts.find(x=>x.length>8&&!/\d{1,2}[\/.-]\d{1,2}/.test(x))||parts[0]||"Nhiệm vụ";
          candidates.push({title,description:line,date_text:date,time_text:time,location:"",responsible:"",participants:"",priority:/cao|ưu tiên/i.test(line)?"HIGH":"NORMAL"});
        }
      }
      parsed={title:req.file.originalname,tasks:candidates};
      if(!candidates.length)parsed.tasks=[{title:"Tài liệu cần rà soát",description:"Demo AI chưa thể bóc tách tự động tài liệu phức tạp. Khi Gemini hoạt động, hãy upload lại để AI phân tích đầy đủ.",date_text:"",time_text:"",location:"",responsible:"",participants:"",priority:"NORMAL"}];
    }
    const saved=await savePlanAndTasks(req.user.id,parsed.title||req.file.originalname,req.file.originalname,text||"[Ảnh]",parsed.tasks||[]);
    res.json({ok:true,title:parsed.title||req.file.originalname,count:saved.length,tasks:sortTasks(saved),ai:!!ai,mode:ai?"REAL_AI":"DEMO_AI"});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"Lỗi xử lý tài liệu"})}
});

app.post("/api/tasks/:id/ai-plan",auth,async(req,res)=>{
  try{
    const task=await getTask(req.user.id,req.params.id);
    if(!task)return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
    const demo={
      objective:[`Bảo đảm nhiệm vụ “${task.title}” được chuẩn bị và thực hiện đúng thời gian, đúng thành phần, đúng nội dung kế hoạch.`],
      forces:[{role:"Chủ trì",unit:task.responsible||"Đơn vị được giao nhiệm vụ"},{role:"Phối hợp",unit:task.participants||"Các lực lượng liên quan"}],
      steps:["Nghiên cứu kỹ nội dung nhiệm vụ và thời hạn.","Phân công lực lượng, chuẩn bị điều kiện bảo đảm.","Hiệp đồng thời gian, địa điểm và trách nhiệm.","Kiểm tra công tác chuẩn bị.","Tổ chức thực hiện, theo dõi tiến độ và xử lý phát sinh.","Tổng hợp kết quả, báo cáo và cập nhật trạng thái."],
      checklist:["Xác định yêu cầu","Phân công lực lượng","Hiệp đồng","Kiểm tra chuẩn bị","Tổ chức thực hiện","Tổng hợp báo cáo"],
      risks:["Thiếu lực lượng hoặc điều kiện bảo đảm","Chồng chéo thời gian","Nội dung kế hoạch thay đổi"],
      suggestions:["Hoàn thành phân công trước thời gian thực hiện.","Kiểm tra các nhiệm vụ cùng ngày để tránh chồng chéo.","Các nội dung suy luận là đề xuất AI, cán bộ phụ trách quyết định."]
    };
    if(ai){
      try{
        const prompt=`Phân tích nhiệm vụ sau để đề xuất hướng tổ chức, triển khai. Không bịa dữ kiện. Trả JSON gồm objective, forces, steps, checklist, risks, suggestions.\n${JSON.stringify(task,null,2)}`;
        const parsed=cleanJson(await callText(prompt));
        if(parsed){await updateTask(req.user.id,req.params.id,{ai_plan:parsed});return res.json({...parsed,source:"REAL_AI"});}
      }catch(e){console.warn("Gemini unavailable, switching to demo AI:",e.message)}
    }
    await updateTask(req.user.id,req.params.id,{ai_plan:demo});
    res.json({...demo,source:"DEMO_AI"});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"Không thể phân tích nhiệm vụ"})}
});
app.post("/api/chat",auth,async(req,res)=>{
  try{
    const message=String(req.body?.message||"").trim();
    if(!message)return res.status(400).json({error:"Thiếu câu hỏi"});
    const tasks=(await getTasks(req.user.id)).filter(t=>String(t.user_id)===String(req.user.id));
    const lower=message.toLowerCase();
    const now=new Date();
    const addDays=n=>{const d=new Date(now);d.setDate(d.getDate()+n);return d};
    const fmt=d=>`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
    let target=null;
    if(lower.includes("hôm nay"))target=fmt(now);
    else if(lower.includes("ngày mai"))target=fmt(addDays(1));
    else if(lower.includes("ngày kia"))target=fmt(addDays(2));

    if(target && /(nhiệm vụ|công việc|lịch|có gì)/.test(lower)){
      const found=tasks.filter(t=>String(t.date_text||"").includes(target));
      return res.json({answer:found.length?`@${req.user.username}: ${target} có ${found.length} nhiệm vụ:\n`+found.map((t,i)=>`${i+1}. ${t.title} — ${t.time_text||"chưa có giờ"} — ${t.location||"chưa có địa điểm"}`).join("\n"):`@${req.user.username}: ${target} không có nhiệm vụ trong dữ liệu của bạn.`,source:"DB"});
    }
    if(/bao nhiêu|số lượng/.test(lower))return res.json({answer:`@${req.user.username}: ${tasks.length} nhiệm vụ; ${tasks.filter(t=>t.status==="DONE").length} hoàn thành, ${tasks.filter(t=>t.status==="DOING").length} đang thực hiện, ${tasks.filter(t=>t.status==="TODO").length} chưa thực hiện.`,source:"DB"});
    if(/chưa hoàn thành|chưa thực hiện/.test(lower)){
      const p=tasks.filter(t=>t.status!=="DONE");
      return res.json({answer:p.length?`Có ${p.length} nhiệm vụ chưa hoàn thành:\n`+p.map((t,i)=>`${i+1}. ${t.title} — ${t.date_text||"chưa có ngày"}`).join("\n"):"Tất cả nhiệm vụ đã hoàn thành.",source:"DB"});
    }
    if(/ưu tiên cao/.test(lower)){
      const p=tasks.filter(t=>t.priority==="HIGH");
      return res.json({answer:p.length?`Có ${p.length} nhiệm vụ ưu tiên cao:\n`+p.map((t,i)=>`${i+1}. ${t.title} — ${t.date_text||"chưa có ngày"}`).join("\n"):"Không có nhiệm vụ ưu tiên cao.",source:"DB"});
    }

    if(ai){
      try{
        const prompt=`Bạn là SMART PLAN AI. Chỉ dùng dữ liệu của tài khoản @${req.user.username}. Không dùng dữ liệu ngoài. Ngày hiện tại Việt Nam: ${fmt(now)}.\nDỮ LIỆU:\n${JSON.stringify(tasks,null,2)}\nCÂU HỎI:\n${message}\nTrả lời tiếng Việt ngắn gọn.`;
        const r=await ai.models.generateContent({model:process.env.GEMINI_MODEL||"gemini-2.5-flash",contents:prompt});
        return res.json({answer:r.text,source:"REAL_AI"});
      }catch(e){console.warn("Gemini chat unavailable, switching to demo:",e.message)}
    }
    res.json({answer:`@${req.user.username}: Gemini hiện không khả dụng hoặc đã hết quota. Bạn vẫn có thể dùng tra cứu nhiệm vụ, ngày/thứ, trạng thái, ưu tiên và chức năng hướng tổ chức ở chế độ Demo AI.`,source:"DEMO_AI"});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"AI lỗi"})}
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`SMART PLAN running on ${PORT}`));