import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({limit: "10mb"}));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const memory = {
  plans: [],
  tasks: []
};

function demoTasks() {
  return [
    {
      id: "demo-1",
      plan_id: "demo-plan",
      title: "Hội nghị triển khai nhiệm vụ",
      description: "Tổ chức hội nghị triển khai nhiệm vụ theo kế hoạch.",
      date_text: "02/09/2026",
      time_text: "08:00",
      location: "Hội trường",
      responsible: "Phòng Đào tạo",
      participants: "Các cơ quan, khoa, đơn vị liên quan",
      priority: "HIGH",
      status: "TODO",
      ai_plan: null
    },
    {
      id: "demo-2",
      plan_id: "demo-plan",
      title: "Kiểm tra công tác chuẩn bị",
      description: "Kiểm tra cơ sở vật chất, lực lượng và các nội dung bảo đảm.",
      date_text: "03/09/2026",
      time_text: "14:00",
      location: "Khu vực tổ chức",
      responsible: "Bộ phận bảo đảm",
      participants: "Lực lượng phục vụ",
      priority: "NORMAL",
      status: "TODO",
      ai_plan: null
    },
    {
      id: "demo-3",
      plan_id: "demo-plan",
      title: "Tổ chức sinh hoạt, tuyên truyền",
      description: "Triển khai nội dung tuyên truyền, giáo dục theo kế hoạch.",
      date_text: "04/09/2026",
      time_text: "19:30",
      location: "Đơn vị",
      responsible: "Phòng Chính trị",
      participants: "Cán bộ, học viên",
      priority: "NORMAL",
      status: "TODO",
      ai_plan: null
    }
  ];
}

function parseDateTime(t) {
  const s = `${t.date_text || ""} ${t.time_text || ""}`;
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}).*?(\d{1,2})(?::|h)(\d{2})?/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return new Date(year, Number(m[2])-1, Number(m[1]), Number(m[4]), Number(m[5] || 0)).getTime();
}

function sortTasks(tasks) {
  return [...tasks].sort((a,b) => parseDateTime(a)-parseDateTime(b));
}

async function getTasks() {
  if (supabase) {
    const { data, error } = await supabase.from("tasks").select("*");
    if (!error && data) return sortTasks(data);
  }
  if (memory.tasks.length) return sortTasks(memory.tasks);
  return demoTasks();
}

async function getTask(id) {
  const tasks = await getTasks();
  return tasks.find(x => String(x.id) === String(id));
}

async function savePlanAndTasks(title, sourceName, rawText, tasks) {
  if (supabase) {
    const { data: plan, error: pe } = await supabase
      .from("plans")
      .insert({ title, source_name: sourceName, raw_text: rawText })
      .select().single();
    if (!pe && plan) {
      const rows = tasks.map(t => ({
        plan_id: plan.id,
        title: t.title || "Nhiệm vụ",
        description: t.description || "",
        date_text: t.date_text || "",
        time_text: t.time_text || "",
        location: t.location || "",
        responsible: t.responsible || "",
        participants: t.participants || "",
        priority: t.priority || "NORMAL",
        status: "TODO",
        ai_plan: t.ai_plan || null
      }));
      const { data } = await supabase.from("tasks").insert(rows).select();
      return data || [];
    }
  }
  const planId = `plan-${Date.now()}`;
  memory.plans.push({ id: planId, title, source_name: sourceName, raw_text: rawText });
  const rows = tasks.map((t,i) => ({...t, id:`task-${Date.now()}-${i}`, plan_id:planId, status:"TODO"}));
  memory.tasks.push(...rows);
  return rows;
}

async function updateTask(id, patch) {
  if (supabase) {
    const { data, error } = await supabase.from("tasks").update(patch).eq("id", id).select().single();
    if (!error) return data;
  }
  const idx = memory.tasks.findIndex(x => String(x.id) === String(id));
  if (idx >= 0) memory.tasks[idx] = {...memory.tasks[idx], ...patch};
  return memory.tasks[idx];
}

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".docx") {
    const r = await mammoth.extractRawText({buffer:file.buffer});
    return r.value;
  }
  if (ext === ".pdf") {
    const r = await pdfParse(file.buffer);
    return r.text;
  }
  return "";
}

async function callGeminiText(prompt) {
  if (!ai) return null;
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  return response.text;
}

async function callGeminiVision(prompt, file) {
  if (!ai) return null;
  const mime = file.mimetype || "image/jpeg";
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mime, data: file.buffer.toString("base64") } }
      ]
    }],
    config: { responseMimeType: "application/json" }
  });
  return response.text;
}

function cleanJson(s) {
  if (!s) return null;
  const fenced = s.replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim();
  try { return JSON.parse(fenced); } catch { 
    const start = Math.min(...["[","{"].map(x => { const i=fenced.indexOf(x); return i < 0 ? 999999 : i; }));
    const sub = fenced.slice(start);
    try { return JSON.parse(sub); } catch { return null; }
  }
}

app.get("/api/health", (req,res) => {
  res.json({ok:true, ai:!!ai, database:!!supabase});
});

app.get("/api/tasks", async (req,res) => {
  res.json(await getTasks());
});

app.get("/api/tasks/:id", async (req,res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
  res.json(task);
});

app.patch("/api/tasks/:id", async (req,res) => {
  res.json(await updateTask(req.params.id, req.body || {}));
});

app.post("/api/upload", upload.single("file"), async (req,res) => {
  try {
    if (!req.file) return res.status(400).json({error:"Chưa chọn file"});
    const text = await extractText(req.file);
    const isImage = req.file.mimetype.startsWith("image/");
    const source = text || "[Tài liệu hình ảnh]";
    const prompt = `Bạn là trợ lý AI quản lý kế hoạch công tác. Hãy đọc tài liệu dưới đây và bóc tách thành các nhiệm vụ có thể quản lý.
Chỉ lấy thông tin có trong tài liệu; không tự bịa tên người/đơn vị/thời gian. Nếu thiếu trường thì để chuỗi rỗng.
Trả về JSON thuần theo cấu trúc:
{"title":"tên kế hoạch","tasks":[{"title":"","description":"","date_text":"","time_text":"","location":"","responsible":"","participants":"","priority":"HIGH|NORMAL|LOW"}]}
Tài liệu:
${source.slice(0, 60000)}`;

    let raw = isImage ? await callGeminiVision(prompt, req.file) : await callGeminiText(prompt);
    let parsed = cleanJson(raw);

    if (!parsed) {
      parsed = {
        title: req.file.originalname,
        tasks: [{
          title: "Nhiệm vụ cần rà soát",
          description: "AI chưa trả về dữ liệu cấu trúc. Vui lòng kiểm tra lại tài liệu.",
          date_text: "", time_text: "", location:"", responsible:"", participants:"", priority:"NORMAL"
        }]
      };
    }

    const saved = await savePlanAndTasks(parsed.title || req.file.originalname, req.file.originalname, source, parsed.tasks || []);
    res.json({ok:true, title:parsed.title || req.file.originalname, count:saved.length, tasks:sortTasks(saved), ai:!!ai});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:e.message || "Lỗi xử lý tài liệu"});
  }
});

app.post("/api/tasks/:id/ai-plan", async (req,res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({error:"Không tìm thấy nhiệm vụ"});
    if (!ai) {
      return res.json({
        source:"demo",
        objective:["Bảo đảm nhiệm vụ đúng thời gian, đúng thành phần, đúng nội dung."],
        forces:[{role:"Chủ trì", unit:task.responsible || "Đơn vị được giao nhiệm vụ"},{role:"Phối hợp",unit:task.participants || "Các lực lượng liên quan"}],
        steps:["Nghiên cứu kỹ nội dung kế hoạch và xác định yêu cầu.","Xác định lực lượng, thời gian, địa điểm và vật chất bảo đảm.","Hiệp đồng các lực lượng, kiểm tra điều kiện thực hiện.","Tổ chức thực hiện và theo dõi tiến độ.","Tổng hợp kết quả, báo cáo và rút kinh nghiệm."],
        checklist:["Xác định nội dung","Phân công lực lượng","Hiệp đồng","Kiểm tra điều kiện","Tổ chức thực hiện","Tổng hợp báo cáo"],
        risks:["Thiếu lực lượng hoặc vật chất bảo đảm","Chồng chéo thời gian","Thông tin trong kế hoạch chưa rõ"],
        suggestions:["Kiểm tra các nhiệm vụ diễn ra cùng thời gian.","Hoàn tất phân công trước thời điểm thực hiện.","Đánh dấu rõ nội dung do kế hoạch quy định và nội dung do AI đề xuất."]
      });
    }

    const prompt = `Bạn là trợ lý tham mưu hỗ trợ tổ chức thực hiện công việc. Phân tích nhiệm vụ dưới đây.
Không được tự khẳng định thông tin chưa có trong kế hoạch. Các nội dung suy luận/đề xuất phải ghi rõ là đề xuất AI.
Trả về JSON:
{"objective":[],"forces":[{"role":"","unit":""}],"steps":[],"checklist":[],"risks":[],"suggestions":[]}
Nhiệm vụ:
${JSON.stringify(task, null, 2)}`;

    const parsed = cleanJson(await callGeminiText(prompt));
    if (!parsed) return res.status(502).json({error:"AI không trả về dữ liệu hợp lệ"});
    await updateTask(req.params.id, { ai_plan: parsed });
    res.json({...parsed, source:"ai"});
  } catch(e) {
    console.error(e);
    res.status(500).json({error:e.message || "AI lỗi"});
  }
});

app.post("/api/chat", async (req,res) => {
  try {
    const {message} = req.body || {};
    if (!message) return res.status(400).json({error:"Thiếu câu hỏi"});
    const tasks = await getTasks();
    if (!ai) {
      return res.json({answer:"Chế độ demo: hãy cấu hình GEMINI_API_KEY để hỏi AI trực tiếp. Hiện hệ thống đang quản lý " + tasks.length + " nhiệm vụ."});
    }
    const prompt = `Bạn là SMART AI, trợ lý hỏi đáp về kế hoạch công tác. Chỉ sử dụng dữ liệu nhiệm vụ được cung cấp.
Nếu người dùng hỏi điều không có dữ liệu, nói rõ chưa có dữ liệu.
Dữ liệu:
${JSON.stringify(tasks, null, 2)}
Câu hỏi: ${message}
Trả lời ngắn gọn, rõ ràng bằng tiếng Việt.`;
    const r = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: prompt
    });
    res.json({answer:r.text});
  } catch(e) {
    res.status(500).json({error:e.message || "AI lỗi"});
  }
});

app.use((req,res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`SMART PLAN running on ${PORT}`));