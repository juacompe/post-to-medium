# post-to-medium

Playwright script สำหรับ post title ไปยัง Medium โดยเชื่อมต่อกับ Chrome จริงผ่าน CDP

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

**Step 2a — Post แค่ title**

```bash
make post TITLE="My Article Title"
```

**Step 2b — Cross-post จาก Ghost blog**

```bash
make cp URL="https://blog.odd-e.com/your-post-slug/"
```

จะดึง title, content, feature image, และ tags จาก Ghost แล้ว cross-post ไปยัง Medium เป็น draft
