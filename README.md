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

**Step 2 — Post title ไปยัง Medium**

```bash
make post TITLE="My Article Title"
```

จะเปิด Medium new story, ใส่ title, รอ autosave แล้ว print draft URL ใน terminal
