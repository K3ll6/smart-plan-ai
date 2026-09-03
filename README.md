# SMART PLAN V5
## Điểm chính
- Supabase Auth + RLS: mỗi BGK có tài khoản và dữ liệu riêng.
- Demo AI fallback: Gemini hết quota vẫn test được các chức năng.
- DB-first: ngày/thứ, tìm nhiệm vụ, trạng thái, ưu tiên không gọi Gemini.
- AI plan được cache trong `tasks.ai_plan`.
- Khi Gemini có quota, upload/phân tích có thể dùng AI thật.
- Khi Gemini lỗi/rate limit, hệ thống tự chuyển Demo AI thay vì chết.

## Supabase
1. Tạo project.
2. SQL Editor → chạy `supabase/schema.sql`.
3. Authentication → Providers → Email → tắt Email Confirm nếu muốn đăng ký tài khoản giả dạng username không cần email.
4. Settings → API Keys:
   - Project URL → `SUPABASE_URL`
   - Publishable/Anon key → `SUPABASE_ANON_KEY`
   - Secret key → `SUPABASE_SECRET_KEY` (chỉ Render)
5. Render Environment:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SECRET_KEY
   - GEMINI_API_KEY (có thể bỏ trống để chạy Demo AI)
   - GEMINI_MODEL=gemini-2.5-flash

Không đưa Secret Key lên GitHub.


## Fix AI 5.1
- Câu hỏi liệt kê nhiệm vụ được trả lời trực tiếp từ DB của tài khoản, không gọi Gemini.
- Mỗi request Gemini tạo context mới từ đúng tasks của JWT user.
- `/api/my-scope` hiển thị user và task_count để kiểm chứng cách ly.
- Không có AI chat history global.
