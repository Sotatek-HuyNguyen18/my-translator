import { useState, useRef, useEffect } from 'react';

const STEPS = [
  { id: 1, icon: '📂', label: 'Phân tích Cấu trúc', desc: 'Bóc tách dữ liệu từ file gốc' },
  { id: 2, icon: '🔍', label: 'AI Context Agent', desc: 'Nhận diện lĩnh vực & từ khóa' },
  { id: 3, icon: '🤖', label: 'Dịch thuật Thông minh', desc: 'Dịch song song có bộ nhớ liên kết' },
  { id: 4, icon: '✨', label: 'Kiểm tra & Đóng gói', desc: 'Rà soát chất lượng & tạo file' },
];

export default function Home() {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [steps, setSteps] = useState({});
  const [stepMessages, setStepMessages] = useState({});
  const [stepProgress, setStepProgress] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [glossary, setGlossary] = useState([]);
  const [newTerm, setNewTerm] = useState({ source: '', target: '' });
  const [livePreview, setLivePreview] = useState([]);
  const [output, setOutput] = useState('');
  const [translatedFile, setTranslatedFile] = useState(null);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWaitingConfirm, setIsWaitingConfirm] = useState(false);
  const [sourceLang, setSourceLang] = useState('Tự động phát hiện');
  const [targetLang, setTargetLang] = useState('Tiếng Việt');
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite');
  const [apiKey, setApiKey] = useState('');
  const [originalKey, setOriginalKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch('/api/settings').then(res => res.json()).then(data => {
      if (data.apiKey) {
        setApiKey(data.apiKey);
        setOriginalKey(data.apiKey);
      }
    });
  }, []);

  const handleSaveKey = async () => {
    if (apiKey === originalKey || !apiKey) return;
    setApiKeyStatus('Đang lưu...');
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      setOriginalKey(apiKey);
      setApiKeyStatus('Đã lưu ✅');
      setTimeout(() => setApiKeyStatus(''), 2000);
    } catch (e) {
      setApiKeyStatus('Lỗi ❌');
    }
  };

  const LANG_OPTIONS = ['Tiếng Việt', 'English', '日本語', '한국어', '中文', 'Français', 'Deutsch', 'Español', 'Russian'];

  const handleFile = (f) => {
    if (f) {
      setTranslatedFile(null);
      setSteps({});
      setLivePreview([]);
      setError('');
      setIsWaitingConfirm(false);
      setAnalysis(null);

      const reader = new FileReader();
      reader.onload = e => setFile({ name: f.name, base64: e.target.result.split(',')[1] });
      reader.readAsDataURL(f);
    }
  };

  const startTranslation = async () => {
    if (!file) return;
    setIsProcessing(true);
    setSteps({ 1: 'running' });
    setLivePreview(['Đang chuẩn bị luồng dịch thuật... ➔ Vui lòng đợi']);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: file.base64, fileName: file.name, sourceLang, targetLang, model: selectedModel, apiKey }),
      });
      processStream(res);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  const continueTranslation = async () => {
    setIsWaitingConfirm(false);
    setIsProcessing(true);
    setSteps(prev => ({ ...prev, 3: 'running' }));
    setLivePreview(['Đang dịch thuật song ngữ... ➔ Xin chờ giây lát']);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: file.base64, fileName: file.name, sourceLang, targetLang, model: selectedModel, analysis, glossary, skipToStep: 3, apiKey }),
      });
      processStream(res);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  const processStream = async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));
        if (event.step) {
          setSteps(prev => ({ ...prev, [event.step]: event.status }));
          if (event.message) setStepMessages(prev => ({ ...prev, [event.step]: event.message }));
          if (event.progress) setStepProgress(prev => ({ ...prev, [event.step]: event.progress }));
          if (event.step === 2 && event.status === 'done') {
            setAnalysis(event.analysis);
            if (event.analysis && event.analysis.keywords && event.analysis.keywords.length > 0) {
              setGlossary(event.analysis.keywords.map(k => ({ source: k, target: '' })));
            } else {
              setGlossary([{ source: '', target: '' }]); // Luôn hiện ít nhất 1 ô nhập
            }
            setIsWaitingConfirm(true);
            setIsProcessing(false);
            return;
          }
        }
        if (event.latest) setLivePreview(prev => [event.latest, ...prev].slice(0, 5));
        if (event.type === 'result') setOutput(event.translated);
        if (event.type === 'file') {
          setTranslatedFile({ base64: event.base64, name: event.fileName });
          setIsProcessing(false);
        }
        if (event.type === 'error') {
          setError(event.message);
          setIsProcessing(false);
        }
      }
    }
  };

  const downloadFile = () => {
    const link = document.createElement('a');
    link.href = `data:application/octet-stream;base64,${translatedFile.base64}`;
    link.download = translatedFile.name;
    link.click();
  };

  const doneSteps = Object.values(steps).filter(v => v === 'done').length;
  const progressPct = (doneSteps / STEPS.length) * 100;

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'Outfit, sans-serif', padding: '40px 20px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '40px', fontWeight: 900, marginBottom: '10px' }}>AI Agent Translator</h1>
          <p style={{ color: '#64748b' }}>Dịch thuật tài liệu chuyên sâu với Live Preview song ngữ</p>
        </header>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#fca5a5', padding: '15px', borderRadius: '15px', marginBottom: '30px', textAlign: 'center' }}>
            <strong>LỖI HỆ THỐNG:</strong> {error}
            <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#ef4444', marginLeft: '15px', cursor: 'pointer', fontWeight: 800 }}>[ĐÓNG]</button>
          </div>
        )}

        {!isProcessing && !isWaitingConfirm && !translatedFile && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', marginBottom: '30px' }}>
            <div 
              onClick={() => fileInputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              style={{ border: '2px dashed rgba(255,255,255,0.1)', borderRadius: '20px', padding: '60px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(79,70,229,0.05)' : 'transparent' }}
            >
              <div style={{ fontSize: '40px' }}>{file ? '📄' : '☁️'}</div>
              <h3>{file ? file.name : 'Tải lên tài liệu'}</h3>
              <input ref={fileInputRef} type="file" accept=".xlsx,.docx,.pptx,.pdf" onChange={e => handleFile(e.target.files[0])} style={{ display: 'none' }} />
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '10px' }}>CẤU HÌNH & API</label>
              
              <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px' }}>Gemini API Key</span>
                  <span style={{ fontSize: '10px', color: '#10b981' }}>{apiKeyStatus}</span>
                </div>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Dán key..." style={{ flex: 1, padding: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '12px' }} />
                  <button 
                    onClick={handleSaveKey} 
                    disabled={apiKey === originalKey || !apiKey}
                    style={{ background: (apiKey === originalKey || !apiKey) ? '#334155' : '#4f46e5', border: 'none', borderRadius: '8px', color: (apiKey === originalKey || !apiKey) ? '#94a3b8' : 'white', padding: '0 10px', cursor: (apiKey === originalKey || !apiKey) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}
                  >
                    Lưu
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px' }}>Mô hình AI</span>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (500 RPD - Ưu tiên)</option>
                  <option value="gemini-3-flash">Gemini 3 Flash (20 RPD)</option>
                  <option value="gemini-flash-latest">Gemini Flash Latest</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px' }}>Nguồn</span>
                <select value={sourceLang} onChange={e => setSourceLang(e.target.value)} style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                  <option value="Tự động phát hiện">Tự động</option>
                  {LANG_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px' }}>Đích</span>
                <select value={targetLang} onChange={e => setTargetLang(e.target.value)} style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                  {LANG_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {file && !isProcessing && !isWaitingConfirm && !translatedFile && (
          <button onClick={startTranslation} style={{ width: '100%', padding: '15px', borderRadius: '15px', background: '#4f46e5', color: 'white', fontWeight: 800, border: 'none', cursor: 'pointer', marginBottom: '30px' }}>BẮT ĐẦU DỊCH ➔</button>
        )}

        {(isProcessing || isWaitingConfirm || translatedFile) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
            <div style={{ background: 'rgba(255,255,255,0.01)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', marginBottom: '20px' }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: '#4f46e5', transition: 'width 0.5s' }} />
              </div>
              {STEPS.map(step => {
                const status = steps[step.id] || 'idle';
                const isRunning = status === 'running';
                const isDone = status === 'done';
                return (
                  <div key={step.id} style={{ display: 'flex', gap: '15px', marginBottom: '15px', opacity: status === 'idle' ? 0.3 : 1 }}>
                    <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: isDone ? '#10b981' : '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '14px' }}>{isDone ? '✓' : step.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '14px' }}>{step.label}</div>
                        {isRunning && <span style={{ fontSize: '12px', color: '#818cf8', fontWeight: 800 }}>{stepProgress[step.id] || 0}%</span>}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{stepMessages[step.id] || step.desc}</div>
                    </div>
                  </div>
                );
              })}
              {translatedFile && <button onClick={downloadFile} style={{ width: '100%', padding: '15px', borderRadius: '15px', background: '#10b981', color: 'white', fontWeight: 800, border: 'none', cursor: 'pointer', marginTop: '20px' }}>TẢI FILE ĐÃ DỊCH 📥</button>}
            </div>

            <aside>
              {livePreview.length > 0 && (
                <div style={{ background: 'rgba(79,70,229,0.05)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(79,70,229,0.2)', marginBottom: '20px' }}>
                  <p style={{ fontSize: '10px', fontWeight: 800, color: '#818cf8', marginBottom: '15px' }}>⚡ LIVE PREVIEW (SONG NGỮ)</p>
                  {livePreview.map((text, i) => {
                    const [goc, dich] = text.split(' ➔ ');
                    return (
                      <div key={i} style={{ marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                        {dich ? (
                          <>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{goc}</div>
                            <div style={{ fontSize: '13px', color: '#e2e8f0' }}>➔ {dich}</div>
                          </>
                        ) : <div style={{ fontSize: '13px' }}>{text}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {isWaitingConfirm && (
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '20px', border: '1px solid #4f46e5' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>XÁC NHẬN NGỮ CẢNH</p>
                  <input value={analysis?.domain} onChange={e => setAnalysis({...analysis, domain: e.target.value})} style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'white', fontSize: '13px', marginBottom: '15px' }} />
                  
                  <p style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>TỪ ĐIỂN CHUYÊN NGÀNH</p>
                  {glossary.map((g, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                      <input value={g.source} onChange={e => { const ng = [...glossary]; ng[i].source = e.target.value; setGlossary(ng); }} style={{ flex: 1, padding: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '12px' }} />
                      <span style={{ display: 'flex', alignItems: 'center' }}>➔</span>
                      <input value={g.target} onChange={e => { const ng = [...glossary]; ng[i].target = e.target.value; setGlossary(ng); }} placeholder="Dịch nghĩa..." style={{ flex: 1, padding: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '12px' }} />
                    </div>
                  ))}
                  <button onClick={() => setGlossary([...glossary, { source: '', target: '' }])} style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', cursor: 'pointer', marginBottom: '20px', fontSize: '12px' }}>+ THÊM TỪ MỚI</button>

                  <button onClick={continueTranslation} style={{ width: '100%', padding: '12px', borderRadius: '12px', background: '#4f46e5', color: 'white', fontWeight: 800, border: 'none', cursor: 'pointer' }}>TIẾP TỤC DỊCH ➔</button>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}