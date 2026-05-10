import mammoth from "mammoth";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import pdf from "pdf-parse";
import { Document, Packer, Paragraph, TextRun } from "docx";

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' }, externalResolver: true },
};

const escapeXml = (s) => {
  if (typeof s !== 'string') return s;
  return s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
};

const sendEvent = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

async function callGemini(model, prompt, apiKey, retries = 5) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  for (let i = 0; i < retries; i++) {
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
      const data = await response.json();
      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return `Lỗi: ${data.candidates?.[0]?.finishReason}`;
        return text;
      }
      if (response.status === 429) {
        if (i === retries - 1) throw new Error("Lỗi 429: API Rate Limit (Vượt quá số lượt sử dụng)");
        // Đợi 20 giây để hệ thống tự động qua mốc 1 phút reset hạn ngạch của Google
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      throw new Error(data.error?.message || `API Error ${response.status}`);
    } catch (e) {
      if (e.message.includes('429')) throw e; // Quăng thẳng lỗi nếu là 429
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { fileBase64, fileName, sourceLang, targetLang, model: modelId, analysis: clientAnalysis, glossary = [], skipToStep, apiKey: clientKey } = req.body;
  let outputFileName = fileName;
  let finalBuffer = null;
  let fullTranslatedText = "";
  let analysis = clientAnalysis || { domain: "Đang phân tích...", keywords: [] };
  const apiKey = clientKey || process.env.GEMINI_API_KEY;
  const buffer = Buffer.from(fileBase64, 'base64');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  const emit = (data) => sendEvent(res, data);

  try {


    if (!skipToStep) {
      emit({ step: 1, status: 'running', message: 'Đang đọc dữ liệu file...', progress: 50 });
      let previewText = "";
      if (fileName.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        previewText = (result.value || "").slice(0, 5000);
      } else if (fileName.endsWith('.pptx')) {
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
        for (const slideName of slideFiles) {
          const slideXml = await zip.file(slideName).async("text");
          const tagRegex = /<a:t[^>]*>([^<]+)<\/a:t>/g;
          let m;
          while ((m = tagRegex.exec(slideXml)) !== null) {
            previewText += m[1] + " ";
            if (previewText.length > 5000) break;
          }
          if (previewText.length > 5000) break;
        }
      } else if (fileName.endsWith('.pdf')) {
        const data = await pdf(buffer);
        previewText = data.text.slice(0, 5000);
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        workbook.eachSheet(s => s.eachRow(row => row.eachCell(c => {
          if (c.value) {
            if (typeof c.value === 'string') previewText += c.value + " ";
            else if (c.value.richText) previewText += c.value.richText.map(t => t.text).join("") + " ";
            else if (c.value.result && typeof c.value.result === 'string') previewText += c.value.result + " ";
          }
        })));
        previewText = previewText.slice(0, 5000);
      }
      emit({ step: 1, status: 'done', progress: 100 });

      emit({ step: 2, status: 'running', message: 'AI Phân tích bối cảnh & thuật ngữ...', progress: 50 });
      const prompt = `Phân tích tài liệu sau:
${previewText}

Hãy trả về đúng 2 dòng, không giải thích gì thêm:
DOMAIN: <Lĩnh vực chính của tài liệu>
KEYWORDS: <10 từ khóa chuyên ngành quan trọng nhất trong tài liệu, cách nhau bằng dấu phẩy>`;

      let parsedDomain = "Tài liệu chuyên ngành";
      let parsedKeywords = [];
      let lastRaw = "";

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await callGemini(modelId, prompt, apiKey);
          lastRaw = raw; // Lưu lại để debug nếu lỗi
          
          const dMatch = raw.match(/DOMAIN\s*:?\s*(.+)/i);
          const kMatch = raw.match(/KEYWORDS\s*:?\s*(.+)/i);
          
          if (dMatch && kMatch) {
              parsedDomain = dMatch[1].replace(/[*_#`]/g, '').trim();
              parsedKeywords = kMatch[1].replace(/[*_#`]/g, '').split(',').map(k => k.trim()).filter(k => k.length > 2);
              if (parsedKeywords.length > 0) break;
          }
        } catch (e) {
          lastRaw = e.message;
          if (e.message.includes('429')) throw e; // Dừng ngay lập tức nếu hết hạn ngạch
        }
      }

      if (parsedKeywords.length === 0) {
        const words = previewText.split(/[\s,()]+/).filter(w => w.length > 5 && isNaN(w));
        parsedKeywords = [...new Set(words)].slice(0, 6);
        let debugRaw = lastRaw ? lastRaw.replace(/\n/g, ' ').slice(0, 40) : 'AI trả về rỗng';
        parsedDomain = `Chủ đề ${parsedKeywords[0]} (Debug AI: ${debugRaw})`;
      }

      analysis = { domain: parsedDomain, keywords: parsedKeywords };
      emit({ step: 2, status: 'done', analysis, progress: 100 });
      return res.end();
    }

    emit({ step: 3, status: 'running', message: 'Đang dịch thuật chính xác từng ô...', progress: 0 });
    const glossaryRules = glossary.length > 0 ? `\nTừ điển: ${glossary.map(g => `"${g.source}"->"${g.target}"`).join(', ')}.` : '';

    const translateChunk = async (chunk, isLongText) => {
        let prompt;
        if (isLongText) {
            prompt = `Bạn là dịch giả xuất sắc. Dịch văn bản sau từ ${sourceLang} sang ${targetLang}. Lĩnh vực: ${analysis.domain}. ${glossaryRules}
YÊU CẦU TỐI THƯỢNG: Dịch sát nghĩa, trọn vẹn sang ${targetLang}. TUYỆT ĐỐI KHÔNG giữ nguyên ngôn ngữ gốc (trừ khi là mã số/ID). KHÔNG giải thích.
Văn bản cần dịch:
${chunk[0]}`;
        } else {
            const inputData = chunk.map((text, idx) => `[Đoạn ${idx}]: ${text}`).join('\n\n');
            prompt = `Bạn là dịch giả xuất sắc. Dịch danh sách sau từ ${sourceLang} sang ${targetLang}. Lĩnh vực: ${analysis.domain}. ${glossaryRules}
YÊU CẦU TỐI THƯỢNG:
1. Dịch trọn vẹn từng đoạn sang ${targetLang}. TUYỆT ĐỐI KHÔNG giữ nguyên ngôn ngữ gốc.
2. Trả về kết quả bằng cách bọc MỖI bản dịch trong một thẻ <t>...</t>. Phải trả về đúng ${chunk.length} thẻ <t>.

Danh sách cần dịch:
${inputData}`;
        }

        const rawRes = await callGemini(modelId, prompt, apiKey);
        
        let trans = [];
        if (isLongText) {
            let cleanRes = rawRes.replace(/^```.*\n/i, '').replace(/\n```$/, '').trim();
            if (cleanRes) trans.push(cleanRes);
        } else {
            const regex = /<t>([\s\S]*?)<\/t>/gi;
            let match;
            while ((match = regex.exec(rawRes)) !== null) trans.push(match[1].trim());
            
            if (trans.length < chunk.length) {
                const lines = rawRes.split('\n').map(l => l.replace(/<\/?t>/gi, '').replace(/^\[Đoạn \d+\]:\s*/i, '').trim()).filter(l => l.length > 0);
                if (lines.length >= chunk.length) trans = lines.slice(0, chunk.length);
            }
        }
        return trans;
    };

    if (fileName.endsWith('.xlsx')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const cells = [];
      workbook.eachSheet(s => s.eachRow(r => r.eachCell(c => { 
        if (c.value) {
          let text = "";
          if (typeof c.value === 'string') text = c.value;
          else if (c.value.richText) text = c.value.richText.map(t => t.text).join("");
          else if (c.value.result && typeof c.value.result === 'string') text = c.value.result;
          if (text.trim().length > 1) cells.push({ cell: c, text });
        }
      })));
      
      for (let i = 0; i < cells.length; ) {
        const isLongText = cells[i].text.length > 150;
        const currentChunkSize = isLongText ? 1 : 20; // Gom 20 ô/lần để tận dụng tối đa 500 request/ngày
        const chunk = cells.slice(i, i + currentChunkSize);
        
        const trans = await translateChunk(chunk.map(c => c.text), isLongText);

        chunk.forEach((item, idx) => {
          let t = (trans[idx] && trans[idx].length > 0) ? trans[idx] : item.text;
          item.cell.value = t;
          fullTranslatedText += t + " ";
          emit({ 
            step: 3, 
            status: 'running', 
            progress: Math.round(((i + idx + 1) / cells.length) * 100), 
            latest: `${item.text.replace(/\n/g, ' ').slice(0, 80)} ➔ ${t.replace(/\n/g, ' ').slice(0, 80)}` 
          });
        });
        i += currentChunkSize;
        
        // Thêm độ trễ 5 giây sau mỗi lần gọi để tốc độ là 12 lượt/phút (an toàn tuyệt đối dưới mức 15 lượt/phút của bản miễn phí)
        await new Promise(r => setTimeout(r, 5000));
      }
      finalBuffer = await workbook.xlsx.writeBuffer();

    } else if (fileName.endsWith('.pptx')) {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
      const contents = [];
      const slideData = [];

      const tagRegex = /<a:t[^>]*>([^<]+)<\/a:t>/gi;
      for (const slideName of slideFiles) {
        const slideXml = await zip.file(slideName).async("text");
        const texts = [];
        let m;
        while ((m = tagRegex.exec(slideXml)) !== null) {
          if (m[1].trim().length > 1) {
            texts.push(m[1]);
            contents.push(m[1]);
          }
        }
        slideData.push({ name: slideName, xml: slideXml });
      }

      const allTrans = [];
      for (let i = 0; i < contents.length; ) {
        const isLongText = contents[i].length > 150;
        const currentChunkSize = isLongText ? 1 : 20; // Gom 20 ô/lần để tận dụng tối đa 500 request/ngày
        const chunk = contents.slice(i, i + currentChunkSize);
        
        const trans = await translateChunk(chunk, isLongText);

        for (let j = 0; j < chunk.length; j++) {
          const t = (trans[j] && trans[j].length > 0) ? trans[j] : chunk[j];
          allTrans.push(t);
          fullTranslatedText += t + " ";
          emit({ 
            step: 3, 
            status: 'running', 
            progress: Math.round(((i + j + 1) / contents.length) * 100), 
            latest: `${chunk[j].replace(/\n/g, ' ').slice(0, 80)} ➔ ${t.replace(/\n/g, ' ').slice(0, 80)}` 
          });
        }
        i += currentChunkSize;
        await new Promise(r => setTimeout(r, 5000));
      }

      let globalIdx = 0;
      for (const slide of slideData) {
        const finalXml = slide.xml.replace(/<a:t[^>]*>([^<]+)<\/a:t>/gi, (match, p1) => {
          if (p1.trim().length > 1) return match.replace(p1, escapeXml(allTrans[globalIdx++] || p1));
          return match;
        });
        zip.file(slide.name, finalXml);
      }
      finalBuffer = await zip.generateAsync({ type: "nodebuffer" });

    } else if (fileName.endsWith('.pdf')) {
      const data = await pdf(buffer);
      // Sử dụng regex tách theo 2 dòng xuống dòng trở lên và làm sạch
      const paragraphs = data.text.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 5);
      
      const allTrans = [];
      for (let i = 0; i < paragraphs.length; ) {
        const chunk = paragraphs.slice(i, i + 20); 
        const trans = await translateChunk(chunk, false);
        allTrans.push(...trans);

        for (let j = 0; j < chunk.length; j++) {
            const t = (trans[j] && trans[j].length > 0) ? trans[j] : chunk[j];
            fullTranslatedText += t + " ";
            emit({ 
                step: 3, 
                status: 'running', 
                progress: Math.round(((i + j + 1) / paragraphs.length) * 100), 
                latest: `${chunk[j].slice(0, 80)} ➔ ${t.slice(0, 80)}` 
            });
        }
        i += chunk.length;
        await new Promise(r => setTimeout(r, 5000));
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: allTrans.map(t => new Paragraph({
            children: [new TextRun(t)],
          })),
        }],
      });
      finalBuffer = await Packer.toBuffer(doc);
      outputFileName = fileName.replace(/\.[^/.]+$/, "") + "_translated.docx";

    } else {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml").async("text");
      const contents = [];
      const tagRegex = /<w:t[^>]*>([^<]+)<\/w:t>/gi;
      let m;
      while ((m = tagRegex.exec(docXml)) !== null) if (m[1].trim().length > 1) contents.push(m[1]);

      const allTrans = [];
      for (let i = 0; i < contents.length; ) {
        const isLongText = contents[i].length > 150;
        const currentChunkSize = isLongText ? 1 : 20; // Gom 20 ô/lần để tận dụng tối đa 500 request/ngày
        const chunk = contents.slice(i, i + currentChunkSize);
        
        const trans = await translateChunk(chunk, isLongText);

        for (let j = 0; j < chunk.length; j++) {
          const t = (trans[j] && trans[j].length > 0) ? trans[j] : chunk[j];
          allTrans.push(t);
          fullTranslatedText += t + " ";
          emit({ 
            step: 3, 
            status: 'running', 
            progress: Math.round(((i + j + 1) / contents.length) * 100), 
            latest: `${chunk[j].replace(/\n/g, ' ').slice(0, 80)} ➔ ${t.replace(/\n/g, ' ').slice(0, 80)}` 
          });
        }
        i += currentChunkSize;
      }

      let idx = 0;
      const finalXml = docXml.replace(/<w:t[^>]*>([^<]+)<\/w:t>/gi, (match, p1) => {
        if (p1.trim().length > 1) return match.replace(p1, escapeXml(allTrans[idx++] || p1));
        return match;
      });
      zip.file("word/document.xml", finalXml);
      finalBuffer = await zip.generateAsync({ type: "nodebuffer" });
    }


    emit({ step: 4, status: 'done' });
    emit({ type: 'file', base64: finalBuffer.toString('base64'), fileName: `translated_${outputFileName}` });
    res.end();
  } catch (error) {
    emit({ type: 'error', message: error.message });
    res.end();
  }
}
