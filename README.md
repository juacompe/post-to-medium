# post-to-medium

Playwright script สำหรับ cross-post บทความจาก Ghost blog ไปยัง Medium และ submit ไปยัง odds.team publication โดยเชื่อมต่อกับ Chrome จริงผ่าน CDP

## Requirements

- Node.js
- Google Chrome

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

**Step 1 — เปิด Chrome ด้วย remote debugging**

```bash
make chrome
```

Login Medium ใน Chrome window ที่เปิดขึ้นมา (ถ้ายังไม่ได้ login)

---

**Step 2a — Cross-post จาก Ghost blog**

```bash
make cp URL="https://blog.odd-e.com/your-post-slug/"
```

ดึง title, content, feature image, และ tags จาก Ghost แล้ว cross-post ไปยัง Medium เป็น draft

> ใส่ `LIMIT=N` เพื่อจำกัดจำนวน paragraph (ใช้สำหรับทดสอบ):
> ```bash
> make cp URL="https://blog.odd-e.com/your-post-slug/" LIMIT=3
> ```

**Step 2b — ดู stories ที่ยังไม่ได้ submit ไป odds.team**

```bash
make potential-publish
```

แสดง 5 บทความล่าสุดที่ publish แล้วบน Medium แต่ยังไม่ได้ submit ไปยัง odds.team publication

**Step 2c — Submit บทความล่าสุดไปยัง odds.team**

```bash
make publish
```

หาบทความล่าสุดที่ยังไม่ได้ submit แล้ว submit และ approve ไปยัง odds.team publication อัตโนมัติ

---

**อื่นๆ — Post แค่ title**

```bash
make post TITLE="My Article Title"
```
