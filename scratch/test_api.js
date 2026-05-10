const fs = require('fs');

const envContent = fs.readFileSync('./.env', 'utf-8');
const apiKeyMatch = envContent.match(/GEMINI_API_KEY=(.*)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : '';

async function callGemini(model, prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });
    console.log("HEADERS:", Object.fromEntries(response.headers));
    const data = await response.json();
    console.log("HTTP STATUS:", response.status);
    console.log("DATA:", JSON.stringify(data, null, 2));
  } catch(e) {
    console.error(e);
  }
}

callGemini('gemini-flash-latest', `Phân tích tài liệu sau:

テストケースの種類 GUI テスト結果 合格 不合格 未実施 該当なし 合计 不具合数 合格率 備考 備考 機能名 ダッシュボード 合计 テスター My.pham3 合计 備考 テストケースID Test Title/Summary of test cases Pre-conditions Test Steps Expected Result Test Result Test Result Test Result Test Result Test Result Test Result テスト結果 テストケースID テストタイトル/テストケース概要 事前条件 テスト手順 期待結果 担当者 実行日 Chrome Firefox エッジ 不具合ID 備考 A. SCR-001. [売上ダッシュボード] 画面 

Hãy trả về đúng 2 dòng, không giải thích gì thêm:
DOMAIN: <Lĩnh vực chính của tài liệu>
KEYWORDS: <5 từ khóa chuyên ngành, cách nhau bằng dấu phẩy>`, apiKey);
