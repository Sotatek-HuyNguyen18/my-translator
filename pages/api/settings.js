import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const envPath = path.resolve(process.cwd(), '.env');

  if (req.method === 'GET') {
    let currentKey = process.env.GEMINI_API_KEY || '';
    // Che giấu một phần key để bảo mật khi hiển thị
    if (currentKey.length > 10) {
      currentKey = currentKey.substring(0, 8) + '*'.repeat(currentKey.length - 12) + currentKey.slice(-4);
    }
    return res.status(200).json({ apiKey: currentKey });
  }

  if (req.method === 'POST') {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'Thiếu API Key' });

    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    if (envContent.includes('GEMINI_API_KEY=')) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${apiKey}`);
    } else {
      envContent += `\nGEMINI_API_KEY=${apiKey}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    process.env.GEMINI_API_KEY = apiKey; // Cập nhật ngay vào môi trường chạy

    return res.status(200).json({ success: true, message: 'Đã lưu API Key' });
  }

  res.status(405).end();
}
