import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "smart-plan-demo-change-this-secret";

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

const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = process.env.SUPABASE_URL && SUPABASE_KEY
  ? createClient(process.env.SUPABASE_URL, SUPABASE_KEY)
  : null;

const memory = { users:[], tasks:[], plans:[] };

function tokenFor(user){
  return jwt.sign({id:user.id,username:user.username,name:user.name},JWT_SECRET,{expiresIn:"7d"});
}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token) return res.status(401).json({error:"Vui lòng đăng nhập"});
  try{
    req.user=jwt.verify(token,JWT_SECRET);
    next();
  }catch{
    return res.status(401).json({error:"Phiên đăng nhập đã hết hạn"});
  }
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
    if(!error)return sortTasks(data||[]);
  }
  let rows=memory.tasks.filter(x=>String(x.user_id)===String(userId));
  if(!rows.length){
    rows=demoTasks(userId);
    memory.tasks.push(...rows);
  }
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
  if(supabase){
    try{
      const {error}=await supabase.from("users").select("id",{count:"exact",head:true});
      db=!error;
    }catch{}
  }
  res.json({ok:true,ai:!!ai,database:db,secretKey:!!process.env.SUPABASE_SECRET_KEY});
});

// AUTH
app.post("/api/auth/register",async(req,res)=>{
  try{
    const {username,password,name}=req.body||{};
    const u=String(username||"").trim().toLowerCase();
    const n=String(name||"").trim();
    if(u.length<3)return res.status(400).json({error:"Tài khoản phải có ít nhất 3 ký tự"});
    if(!/^[a-z0-9._-]+$/.test(u))return res.status(400).json({error:"Tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang"});
    if(String(password||"").length<4)return res.status(400).json({error:"Mật khẩu phải có ít nhất 4 ký tự"});
    if(supabase){
      const {data:existing}=await supabase.from("users").select("id").eq("username",u).maybeSingle();
      if(existing)return res.status(409).json({error:"Tài khoản đã tồn tại"});
      const password_hash=await bcrypt.hash(password,10);
      const {data,error}=await supabase.from("users").insert({username:u,password_hash,name:n||u}).select("id,username,name").single();
      if(error)throw error;
      return res.json({user:data,token:tokenFor(data)});
    }
    if(memory.users.some(x=>x.username===u))return res.status(409).json({error:"Tài khoản đã tồn tại"});
    const user={id:`u-${Date.now()}`,username:u,name:n||u,password_hash:await bcrypt.hash(password,10)};
    memory.users.push(user);
    res.json({user:{id:user.id,username:user.username,name:user.name},token:tokenFor(user)});
  }catch(e){console.error(e);res.status(500).json({error:"Không thể tạo tài khoản"})}
});
app.post("/api/auth/login",async(req,res)=>{
  try{
    const u=String(req.body?.username||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    let user=null;
    if(supabase){
      const {data,error}=await supabase.from("users").select("*").eq("username",u).maybeSingle();
      if(error)throw error;user=data;
    }else user=memory.users.find(x=>x.username===u);
    if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:"Tài khoản hoặc mật khẩu không đúng"});
    const safe={id:user.id,username:user.username,name:user.name};
    res.json({user:safe,token:tokenFor(safe)});
  }catch(e){console.error(e);res.status(500).json({error:"Không thể đăng nhập"})}
});
app.get("/api/auth/me",auth,async(req,res)=>res.json({user:req.user}));

// TASKS
app.get("/api/tasks",auth,async(req,res)=>res.json(await getTasks(req.user.id)));
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
    const source=text||"[Tài liệu hình ảnh]";
    const prompt=`Bạn là trợ lý AI quản lý kế hoạch công tác. Hãy đọc tài liệu và bóc tách thành các nhiệm vụ có thể quản lý.
Chỉ lấy thông tin có trong tài liệu; không tự bịa tên người/đơn vị/thời gian. Nếu thiếu trường để chuỗi rỗng.
Trả JSON: {"title":"","tasks":[{"title":"","description":"","date_text":"","time_text":"","location":"","responsible":"","participants":"","priority":"HIGH|NORMAL|LOW"}]}
Tài liệu:
${source.slice(0,60000)}`;
    const parsed=cleanJson(isImage?await callVision(prompt,req.file):await callText(prompt))||{title:req.file.originalname,tasks:[{title:"Nhiệm vụ cần rà soát",description:"AI chưa trả về dữ liệu cấu trúc.",priority:"NORMAL"}]};
    const saved=await savePlanAndTasks(req.user.id,parsed.title||req.file.originalname,req.file.originalname,source,parsed.tasks||[]);
    res.json({ok:true,title:parsed.title||req.file.originalname,count:saved.length,tasks:sortTasks(saved),ai:!!ai});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"Lỗi xử lý tài liệu"})}
});

app.post("/api/tasks/:id/ai-plan",auth,async(req,res)=>{
  try{
    const task=await getTask(req.user.id,req.params.id);
    if(!task)return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
    if(!ai)return res.json({
      source:"demo",
      objective:["Bảo đảm nhiệm vụ đúng thời gian, đúng thành phần, đúng nội dung."],
      forces:[{role:"Chủ trì",unit:task.responsible||"Đơn vị được giao nhiệm vụ"},{role:"Phối hợp",unit:task.participants||"Các lực lượng liên quan"}],
      steps:["Nghiên cứu kỹ nội dung kế hoạch và xác định yêu cầu.","Xác định lực lượng, thời gian, địa điểm và vật chất bảo đảm.","Hiệp đồng các lực lượng, kiểm tra điều kiện thực hiện.","Tổ chức thực hiện và theo dõi tiến độ.","Tổng hợp kết quả, báo cáo và rút kinh nghiệm."],
      checklist:["Xác định nội dung","Phân công lực lượng","Hiệp đồng","Kiểm tra điều kiện","Tổ chức thực hiện","Tổng hợp báo cáo"],
      risks:["Thiếu lực lượng hoặc vật chất bảo đảm","Chồng chéo thời gian","Thông tin trong kế hoạch chưa rõ"],
      suggestions:["Kiểm tra các nhiệm vụ diễn ra cùng thời gian.","Hoàn tất phân công trước thời điểm thực hiện.","Đánh dấu rõ nội dung do kế hoạch quy định và nội dung do AI đề xuất."]
    });
    const prompt=`Bạn là trợ lý tham mưu hỗ trợ tổ chức thực hiện công việc. Phân tích nhiệm vụ dưới đây.
Không được tự khẳng định thông tin chưa có trong kế hoạch. Nội dung suy luận phải ghi rõ là đề xuất AI.
Trả JSON: {"objective":[],"forces":[{"role":"","unit":""}],"steps":[],"checklist":[],"risks":[],"suggestions":[]}
Nhiệm vụ:
${JSON.stringify(task,null,2)}`;
    const parsed=cleanJson(await callText(prompt));
    if(!parsed)return res.status(502).json({error:"AI không trả về dữ liệu hợp lệ"});
    await updateTask(req.user.id,req.params.id,{ai_plan:parsed});
    res.json({...parsed,source:"ai"});
  }catch(e){console.error(e);res.status(500).json({error:e.message||"AI lỗi"})}
});

app.post("/api/chat",auth,async(req,res)=>{
  try{
    const message=String(req.body?.message||"").trim();
    if(!message)return res.status(400).json({error:"Thiếu câu hỏi"});
    const tasks=await getTasks(req.user.id);
    if(!ai)return res.json({answer:`Chế độ demo: tài khoản ${req.user.username} đang có ${tasks.length} nhiệm vụ riêng. Cấu hình GEMINI_API_KEY để hỏi AI trực tiếp.`});
    const today=new Date().toLocaleDateString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"});
    const prompt=`Bạn là SMART AI. Người dùng hiện tại là ${req.user.name||req.user.username}. Ngày hiện tại Việt Nam: ${today}.
Chỉ sử dụng dữ liệu nhiệm vụ RIÊNG của người dùng bên dưới. Không được tiết lộ hay suy đoán dữ liệu của tài khoản khác.
Khi người dùng nói hôm nay/ngày mai/ngày kia, hãy suy ra ngày cụ thể.
Dữ liệu:
${JSON.stringify(tasks,null,2)}
Câu hỏi: ${message}
Trả lời ngắn gọn bằng tiếng Việt.`;
    const r=await ai.models.generateContent({model:process.env.GEMINI_MODEL||"gemini-2.5-flash",contents:prompt});
    res.json({answer:r.text});
  }catch(e){res.status(500).json({error:e.message||"AI lỗi"})}
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`SMART PLAN running on ${PORT}`));