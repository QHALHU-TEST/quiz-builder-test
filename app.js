'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2,10);
  const norm = s => (s||"").trim().toLowerCase();
  const esc  = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const statusBanner = $("#jsBanner");

  // Boot message
  statusBanner.textContent = "✅ Ready — libraries loaded (if available).";

  // Error capture
  const logEl = $("#errorLog"), boxEl = $("#errorBox");
  function showError(e){
    boxEl && boxEl.classList.remove('hidden');
    if (logEl) logEl.textContent += (logEl.textContent? "\n":"") + e;
    console.error(e);
  }
  window.addEventListener("error", ev => showError(`${ev.message || ev} @ ${ev.filename||""}:${ev.lineno||""}`));
  window.addEventListener("unhandledrejection", ev => showError(`Promise rejection: ${ev?.reason?.stack || ev?.reason || ev}`));

  // Storage
  const STORAGE_MISTAKES = 'quizBuilder.v15.fix.mistakes';
  function loadMistakes(){ try{ const raw=localStorage.getItem(STORAGE_MISTAKES); return raw? JSON.parse(raw): []; }catch(e){ showError('Load mistakes failed: '+e); return []; } }
  function saveMistakes(arr){ try{ localStorage.setItem(STORAGE_MISTAKES, JSON.stringify(arr)); }catch(e){ showError('Save mistakes failed: '+e); } }
  let mistakes = loadMistakes();
  let mistakesCurrent = [];
  let mistakesFilterAll = false;
  const STORAGE_KEY = "quizBuilder.v15.fix.quizzes";
  function safeLoad(){ try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ showError("Load failed: "+e); return []; } }
  function safeSave(arr){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch(e){ showError("Save failed: "+e); } }

  let quizzes = safeLoad();
  let activeId = quizzes[0]?.id || null;
  let parsedDraft = null;
  let session = null;

  // Tabs
  function switchTab(name){
    $$(".tab").forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
    ["home","builder","player","flashcards","summary","mistakes"].forEach(id=>{
      const sec = $("#"+id);
      if (sec) sec.classList.toggle('hidden', id!==name);
    });
  }
  $$(".tab").forEach(t=>t.addEventListener('click', ()=>{ const tab=t.dataset.tab; switchTab(tab); if(tab==='mistakes') renderMistakes && renderMistakes(); if(tab==='flashcards') renderFlashcards && renderFlashcards(); document.body.classList.remove("nav-open"); }));
  $("#goHomeBtn").addEventListener('click', ()=>switchTab('home'));
  switchTab('home');
  const hb = $('#hamburger'); if (hb) hb.onclick = ()=> document.body.classList.toggle('nav-open');

  // Helpers
  function mkBtn(txt, fn, cls=''){ const b=document.createElement('button'); b.className='btn '+cls; b.textContent=txt; b.onclick=fn; return b; }
  function shuffle(a){ const x=a.slice(); for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; }

  // Render saved list
  function renderQuizList(){
    const list = $("#quizList");
    list.innerHTML = "";
    if (!quizzes.length){
      list.innerHTML = "<div class='pill'>No quizzes yet</div>";
      $("#activeQuizLabel").textContent = "No quiz selected";
      return;
    }
    quizzes.forEach(q=>{
      const card = document.createElement('div'); card.className='card';
      const head = document.createElement('div'); head.innerHTML = "<b>"+esc(q.name)+"</b> • "+q.questions.length+" questions";
      const actions = document.createElement('div'); actions.className='row wrap';
      actions.append(
        mkBtn('Play', ()=>{activeId=q.id; startSession(); switchTab('player');}),
        mkBtn('Edit', ()=>{activeId=q.id; loadQuizIntoBuilder(q); switchTab('builder');}),
        mkBtn('Export', ()=>exportSingleQuiz(q)),
        mkBtn('Delete', ()=>{
          if (confirm(`Delete quiz "${q.name}"?`)){
            quizzes = quizzes.filter(x=>x.id!==q.id);
            if (activeId===q.id) activeId = quizzes[0]?.id || null;
            safeSave(quizzes); renderQuizList();
          }
        }, 'danger')
      );
      card.append(head, actions);
      list.appendChild(card);
    });
    const active = quizzes.find(q=>q.id===activeId);
    $("#activeQuizLabel").textContent = active ? "Active: "+active.name : "No quiz selected";
  }

  // ===== File drop & reading (TXT / PDF / DOCX) =====
  const dropWrap = $("#dropWrap");
  const chooseBtn = $("#chooseFileBtn");
  const chooseInput = $("#chooseFileInput");
  const chooser = $("#featureChooser");
  const loadedMeta = $("#loadedMeta");
  let loadedText = "";

  ["dragenter","dragover"].forEach(ev=>dropWrap.addEventListener(ev, (e)=>{e.preventDefault(); dropWrap.classList.add('drag');}));
  ["dragleave","drop"].forEach(ev=>dropWrap.addEventListener(ev, (e)=>{e.preventDefault(); dropWrap.classList.remove('drag');}));
  dropWrap.addEventListener('drop', async (e)=>{ const f = e.dataTransfer.files?.[0]; if (f) await readChapterFile(f); });
  chooseBtn.addEventListener('click', ()=>chooseInput.click());
  chooseInput.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (f){ await readChapterFile(f); e.target.value=""; } });

  async function readPdfWithOcr(file){
    if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: buf}).promise;
    let text = '';
    for (let p=1; p<=pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map(i=>i.str).join(' ') + '\n\n';
    }
    if (text.replace(/\s+/g,' ').trim().length > 200) return text;
    if (!window.Tesseract) throw new Error('Tesseract not loaded');
    let ocrText = '';
    for (let p=1; p<=pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({scale: 2});
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({canvasContext: ctx, viewport}).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const res = await Tesseract.recognize(dataUrl, 'eng');
      ocrText += (res && res.data && res.data.text) ? res.data.text + '\n' : '';
    }
    return ocrText;
  }

  async function readChapterFile(file){
    const name = (file.name||'').toLowerCase();
    const isImage = /\.(png|jpe?g|webp|bmp|gif)$/i.test(name);
    const isPdf   = /\.pdf$/i.test(name);
    if (isPdf){
      try { loadedText = await readPdfWithOcr(file); } catch(e){ showError('PDF OCR failed: '+e); alert('PDF OCR failed — see error'); return; }
      loadedMeta.textContent = `Loaded (PDF): ${file.name} • ${loadedText.length.toLocaleString()} characters`;
      chooser.classList.remove('hidden'); switchTab('home'); return;
    }
    if (isImage){
      try{
        if (!window.Tesseract) throw new Error('Tesseract.js not loaded');
        const imgUrl = URL.createObjectURL(file);
        const result = await Tesseract.recognize(imgUrl, 'eng');
        loadedText = (result && result.data && result.data.text) ? result.data.text : '';
        URL.revokeObjectURL(imgUrl);
      }catch(err){ showError('OCR failed: '+err); alert('OCR failed — see error'); return; }
      loadedMeta.textContent = `Loaded (OCR): ${file.name} • ${loadedText.length.toLocaleString()} characters`;
      chooser.classList.remove('hidden'); switchTab('home'); return;
    }

    const name = file.name || 'file';
    const lower = name.toLowerCase();
    try{
      if (/\.(txt|md)$/i.test(lower)){ loadedText = await file.text(); }
      else if (/\.pdf$/i.test(lower)){ loadedText = await extractTextFromPDF(await file.arrayBuffer()); }
      else if (/\.docx$/i.test(lower)){ loadedText = await extractTextFromDOCX(await file.arrayBuffer()); }
      else if (/(\.png|\.jpe?g|\.webp|\.bmp|\.gif)$/i.test(lower)){
        if (!window.Tesseract) throw new Error('Tesseract.js not loaded');
        const imgUrl = URL.createObjectURL(file);
        const result = await Tesseract.recognize(imgUrl, 'eng');
        loadedText = (result && result.data && result.data.text) ? result.data.text : '';
        URL.revokeObjectURL(imgUrl);
      }
      else { alert("Please provide a .txt, .md, .pdf, or .docx file."); return; }
    }catch(err){ showError("Read failed: "+err); alert("Could not read the file. See error box for details."); return; }
    loadedMeta.textContent = `Loaded: ${name} • ${loadedText.length.toLocaleString()} characters`;
    chooser.classList.remove('hidden'); switchTab('home');
  const hb = $('#hamburger'); if (hb) hb.onclick = ()=> document.body.classList.toggle('nav-open');
  }

  async function extractTextFromPDF(arrayBuffer){
    if (!window.pdfjsLib) { throw new Error("PDF.js not loaded"); }
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, 60);
    let full = "";
    for (let p=1; p<=maxPages; p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const parts = content.items.map(it => (typeof it.str === 'string' ? it.str : '')).filter(Boolean);
      full += parts.join(' ') + "\n";
    }
    return full.replace(/\s+/g,' ').trim();
  }

  async function extractTextFromDOCX(arrayBuffer){
    if (!window.mammoth) { throw new Error("Mammoth.js not loaded"); }
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return (value || "").replace(/\s+$/,'');
  }

  // ===== Copy Prompt =====
  const PROMPT = `Creat as much multiple choice and true or false questions from this chapter as possible

Format all quiz questions according to the following Quiz Builder rules:

• Start the quiz with:  # Quiz: <Quiz Title>  
• Number each question (1), 2), 3) …)  
• Separate each question block with a (-) (important)
• Mark correct answers with ✅ and incorrect ones with ❎
• If multiple ✅ answers exist, the question is multi-select  
• Optional explanation lines must start with: explain:  
• Do not add anything outside this format

Example of the required format:

# Quiz: Cardiovascular Pharmacology

1) What does ACE stand for?
✅ Angiotensin-Converting Enzyme
❎ Acetylcholine Esterase
❎ Adenosine Cyclase Enzyme
❎ Acid Citrate Enzyme
explain: ACE converts angiotensin I to angiotensin II.

2) Which of the following are ARBs? (Select all that apply)
✅ Losartan
✅ Valsartan
❎ Amlodipine
❎ Metoprolol
explain: ARBs usually end with -sartan.

3) Amlodipine belongs to which class?
❎ ACE inhibitor
❎ ARB
✅ Calcium channel blocker
❎ Beta-blocker`;
  $("#copyPromptBtn").addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(PROMPT); statusBanner.textContent = "ℹ️ Prompt copied ✅"; }
    catch(e){ showError(e); alert("Copy failed"); }
  });

  // ===== AI settings & helpers (kept minimal here) =====
  const apiKeyInput = $("#apiKeyInput");
  const saveKeyBtn = $("#saveKeyBtn");
  const clearKeyBtn = $("#clearKeyBtn");
  const modelSelect = $("#modelSelect");
  const tempSlider = $("#tempSlider");
  const tempVal = $("#tempVal");
  const maxTokensInput = $("#maxTokensInput");
  const systemPromptInput = $("#systemPromptInput");
  const useAiDefault = $("#useAiDefault");

  // preload
  if (localStorage.getItem("openaiKey")) apiKeyInput.value = "••••••••••••••••";
  modelSelect.value = localStorage.getItem("openaiModel") || "gpt-4o-mini";
  tempSlider.value = localStorage.getItem("openaiTemp") || "0.7"; tempVal.textContent = tempSlider.value;
  maxTokensInput.value = localStorage.getItem("openaiMaxTokens") || "1200";
  systemPromptInput.value = localStorage.getItem("openaiSystem") || "You are a helpful study assistant that strictly follows formatting rules.";
  useAiDefault.checked = localStorage.getItem("openaiUseDefault")==="1";

  saveKeyBtn.onclick = ()=>{
    const v = apiKeyInput.value.trim();
    if (!/^sk-/.test(v)) { alert("That doesn’t look like an OpenAI key (starts with sk-)"); return; }
    localStorage.setItem("openaiKey", v);
    localStorage.setItem("openaiModel", modelSelect.value);
    localStorage.setItem("openaiTemp", tempSlider.value);
    localStorage.setItem("openaiMaxTokens", Math.max(100, Math.min(4000, parseInt(maxTokensInput.value||"1200",10))).toString());
    localStorage.setItem("openaiSystem", systemPromptInput.value || "");
    localStorage.setItem("openaiUseDefault", useAiDefault.checked ? "1" : "0");
    apiKeyInput.value = "••••••••••••••••";
    statusBanner.textContent = "🔐 AI settings saved locally";
  };
  clearKeyBtn.onclick = ()=>{ localStorage.removeItem("openaiKey"); apiKeyInput.value=""; statusBanner.textContent="🔐 API key cleared"; };
  modelSelect.onchange = ()=> localStorage.setItem("openaiModel", modelSelect.value);
  tempSlider.oninput = ()=> tempVal.textContent = tempSlider.value;
  tempSlider.onchange = ()=> localStorage.setItem("openaiTemp", tempSlider.value);
  maxTokensInput.onchange = ()=>{
    const v = Math.max(100, Math.min(4000, parseInt(maxTokensInput.value||"1200",10)));
    maxTokensInput.value = v; localStorage.setItem("openaiMaxTokens", v.toString());
  };
  systemPromptInput.onchange = ()=> localStorage.setItem("openaiSystem", systemPromptInput.value || "");
  useAiDefault.onchange = ()=> localStorage.setItem("openaiUseDefault", useAiDefault.checked ? "1" : "0");

  function hasApiKey(){ return !!localStorage.getItem("openaiKey"); }

  async function aiChat(messages){
    const apiKey = localStorage.getItem("openaiKey"); if (!apiKey) throw new Error("Missing API key");
    const model = localStorage.getItem("openaiModel") || "gpt-4o-mini";
    const temperature = parseFloat(localStorage.getItem("openaiTemp") || "0.7");
    const max_tokens = Math.max(100, Math.min(4000, parseInt(localStorage.getItem("openaiMaxTokens") || "1200", 10)));
    const body = JSON.stringify({ model, temperature, max_tokens, messages });
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type":"application/json" },
      body
    });
    if (!resp.ok){ throw new Error("OpenAI error "+resp.status+": "+(await resp.text())); }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async function aiGenerateQuiz(text){
    const sys = (localStorage.getItem("openaiSystem") || "You are a precise quiz generator. Output ONLY in the app's strict format with ✅/❎ and single '-' line between questions. No extra commentary.");
    const user = `Create as many multiple choice and true/false questions as possible from this chapter. Follow EXACTLY this format:

• Start with '# Quiz: <Quiz Title>'
• Number questions (1), 2), 3) …)
• Separate each question block with a single line containing only a hyphen (-)
• Mark correct answers with ✅ and incorrect ones with ❎
• If multiple ✅ answers exist, the question is multi-select
• Optional explanation lines start with: explain:
• Do not add anything outside this format

Chapter:
${text.slice(0, 120000)}`;
    return await aiChat([{role:"system", content:sys},{role:"user", content:user}]);
  }

  async function aiGenerateFlashcards(text){
    const sys = (localStorage.getItem("openaiSystem") || "You generate clean study flashcards.");
    const user = `From the chapter below, produce 20 high-value flashcards as strict JSON array of objects:
[
  {"front":"TERM or QUESTION", "back":"Concise definition or answer"},
  ...
]
Do not include Markdown fences or any extra text. Keep answers concise.

Chapter:
${text.slice(0, 120000)}`;
    const out = await aiChat([{role:"system", content:sys},{role:"user", content:user}]);
    try { return JSON.parse(out); }
    catch { const m = out.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw new Error("AI did not return valid JSON"); }
  }

  async function aiSummarize(text){
    const sys = (localStorage.getItem("openaiSystem") || "You are a study assistant that writes faithful, concise summaries.");
    const user = `Summarize the following chapter into 8-12 bullet points. Keep technical terms accurate. Avoid fluff.

Chapter:
${text.slice(0, 120000)}`;
    return (await aiChat([{role:"system", content:sys},{role:"user", content:user}])).trim();
  }

  // Feature chooser wiring
  $("#genQuizBtn").addEventListener('click', async ()=>{
    if (hasApiKey() && $("#useAiDefault").checked) return $("#aiQuizBtn").click();
    const quiz = buildQuizFromText(loadedText); loadQuizIntoBuilder(quiz); switchTab('builder'); $("#quizName").value = quiz.name || "Generated Quiz";
  });
  $("#genFlashBtn").addEventListener('click', async ()=>{
    if (hasApiKey() && $("#useAiDefault").checked) return $("#aiFlashBtn").click();
    const cards = buildFlashcardsFromText(loadedText); renderFlashcards(cards); switchTab('flashcards');
  });
  $("#genSummaryBtn").addEventListener('click', async ()=>{
    if (hasApiKey() && $("#useAiDefault").checked) return $("#aiSummaryBtn").click();
    $("#summaryText").textContent = summarizeText(loadedText); switchTab('summary');
  });

  $("#aiQuizBtn").addEventListener('click', async ()=>{
    try{ statusBanner.textContent="🤖 Generating quiz…"; const aiText = await aiGenerateQuiz(loadedText);
      $("#rawInput").value = aiText; const draft = parseRaw();
      if (draft){ parsedDraft = draft; renderPreview(draft); switchTab('builder'); $("#quizName").value = draft.name || "AI Generated Quiz"; }
      statusBanner.textContent="✅ AI quiz generated";
    }catch(err){ showError(err); alert("AI Quiz failed: "+err.message); statusBanner.textContent="⚠️ AI Quiz failed"; }
  });
  $("#aiFlashBtn").addEventListener('click', async ()=>{
    try{ statusBanner.textContent="🤖 Generating flashcards…"; const cards = await aiGenerateFlashcards(loadedText);
      renderFlashcards(cards.map(c=>({ id: uid(), front: c.front, back: c.back }))); switchTab('flashcards'); statusBanner.textContent="✅ AI flashcards ready";
    }catch(err){ showError(err); alert("AI Flashcards failed: "+err.message); statusBanner.textContent="⚠️ AI Flashcards failed"; }
  });
  $("#aiSummaryBtn").addEventListener('click', async ()=>{
    try{ statusBanner.textContent="🤖 Summarizing…"; const sum = await aiSummarize(loadedText);
      $("#summaryText").textContent = sum; switchTab('summary'); statusBanner.textContent="✅ AI summary ready";
    }catch(err){ showError(err); alert("AI Summary failed: "+err.message); statusBanner.textContent="⚠️ AI Summary failed"; }
  });

  // ===== Parser / Builder / Player =====
  function parseChoiceLine(ln){
    const s = ln.trim();
    if (/^[✅❎]/.test(s)){ const correct = s.startsWith("✅"); return { text: s.replace(/^[✅❎]\s*/,""), correct }; }
    if (/^[\+\-]/.test(s)){ const correct = s.startsWith("+"); return { text: s.replace(/^[\+\-]\s*/,""), correct }; }
    return null;
  }
  function normalizeEmojiFormat(raw){
  return raw.split(/\n/).map(line=>{
    if (/^\s*\+\s+/.test(line)) return line.replace(/^\s*\+\s+/, '✅ ');
    if (/^\s*\-\s+/.test(line)) return line.replace(/^\s*\-\s+/, '❎ ');
    return line;
  }).join('\n');
}
function parseRaw(){
    let raw = $("#rawInput").value.trim(); raw = normalizeEmojiFormat(raw); if(!raw){ statusBanner.textContent="ℹ️ Paste questions first"; return null; }
    let name = $("#quizName").value.trim();
    const m = raw.match(/^#\s*Quiz:\s*(.+)$/mi); if (m && !name) name = m[1].trim();
    const afterTitle = raw.replace(/^#\s*Quiz:.+$/gmi,"").trim();
    const blocks = afterTitle.split(/(?:\n\s*-\s*\n|\n\s*\n+)/);
    const questions = [];
    for (let block of blocks){
      const lines = block.split(/\n/).map(s=>s.trim()).filter(Boolean);
      if (!lines.length) continue;
      let qText = lines.shift().replace(/^\d+\s*[\).:-]\s*/,"").trim();
      const choices = []; let explanation = "";
      for (let ln of lines){
        if (/^explain(ation)?:/i.test(ln)){ explanation = ln.replace(/^explain(ation)?:/i,"").trim(); continue; }
        const parsed = parseChoiceLine(ln);
        if (parsed){ choices.push({text:parsed.text, correct:parsed.correct}); continue; }
        const abcd = ln.match(/^[A-D]\)\s*(.+)$/i);
        if (abcd){ choices.push({text:abcd[1].trim(), correct:false}); }
      }
      if (!choices.length) continue;
      questions.push({ id: uid(), text:qText, choices, explanation });
    }
    if (!questions.length){ statusBanner.textContent="ℹ️ No questions found"; return null; }
    const options = {
      shuffleQuestions: $("#shuffleQuestions").checked,
      shuffleChoices: $("#shuffleChoices").checked,
      instantFeedback: $("#instantFeedback").checked
    };
    const keepId = parsedDraft && parsedDraft.id && norm(parsedDraft.name) === norm(name);
    return { id: keepId ? parsedDraft.id : uid(), name: name || "Untitled quiz", options, questions };
  }
  function renderPreview(draft){
    const wrap = $("#preview"); wrap.innerHTML="";
    draft.questions.forEach((q,idx)=>{
      const el = document.createElement('div'); el.className='card';
      const multi = q.choices.filter(c=>c.correct).length>1;
      el.innerHTML = "<div class='question'>"+(idx+1)+". "+esc(q.text)+(multi?" <span class='pill'>multi-select</span>":"")+"</div>";
      q.choices.forEach(c=>{
        const d = document.createElement('div'); d.className='opt';
        d.innerHTML = '<input type="'+(multi?'checkbox':'radio')+'" disabled /> <span>'+ esc(c.text) + '</span>';
        el.appendChild(d);
      });
      if (q.explanation){ const ex=document.createElement('div'); ex.className='small'; ex.textContent="Explanation: "+q.explanation; el.appendChild(ex); }
      wrap.appendChild(el);
    });
  }

  $("#parseBtn").onclick = ()=>{ const draft = parseRaw(); if (draft){ parsedDraft = draft; renderPreview(draft); statusBanner.textContent="ℹ️ Parsed "+draft.questions.length+" question(s)"; } };
  $("#testRunBtn").onclick = ()=>{ const draft = parseRaw(); if(!draft){ statusBanner.textContent="ℹ️ Parse your text first"; return; } startSessionFrom(draft, "Testing (unsaved)"); switchTab('player'); };
  $("#saveQuizBtn").onclick = ()=>saveOrOverwrite();
  $("#saveAsBtn").onclick = ()=>saveAsJSONAuto();
  $("#loadSampleBtn").onclick = ()=>{
    $("#rawInput").value = `# Quiz: Sample — Emoji Format

1) What does ACE stand for?
✅ Angiotensin-Converting Enzyme
❎ Acetylcholine Esterase
❎ Adenosine Cyclase Enzyme
❎ Acid Citrate Enzyme
explain: ACE converts angiotensin I to angiotensin II.

-

2) Which of the following are ARBs? (Select all that apply)
✅ Losartan
✅ Valsartan
❎ Amlodipine
❎ Metoprolol
explain: ARBs end with -sartan.`;
    $("#quizName").value = "Sample — Emoji Format";
    parsedDraft = null;
    statusBanner.textContent = "ℹ️ Sample pasted — Parse or Test Run";
  };

  function startSession(){ const q = quizzes.find(x=>x.id===activeId); if (!q){ statusBanner.textContent="ℹ️ No quiz selected"; return; } startSessionFrom(q, "Active"); }
  function startSessionFrom(quizObj, labelPrefix="Active"){
    const opts = quizObj.options || {};
    let questions = quizObj.questions.map(q=>({
      id:q.id, text:q.text, explanation:q.explanation||"",
      choices: (opts.shuffleChoices?shuffle(q.choices):q.choices).map(c=>({id:uid(), text:c.text, correct:c.correct}))
    }));
    if (opts.shuffleQuestions) questions = shuffle(questions);
    session = { quizId: quizObj.id, name: quizObj.name, options: opts, idx: 0, start: Date.now(), answers:{}, questions };
    $("#activeQuizLabel").textContent = `${labelPrefix}: ${quizObj.name}`;
    renderQuestion(); switchTab('player');
  }
  function renderQuestion(){
    const q = session.questions[session.idx]; if (!q) return;
    const qIdx = session.idx+1, total = session.questions.length;
    $("#qMeta").textContent = "Question "+qIdx+" of "+total;
    const correctCt = Object.values(session.answers).filter(a=>a.correct).length;
    const attempted = Object.keys(session.answers).length;
    $("#scoreMeta").textContent = "Score: "+correctCt+" / "+attempted;
    $("#progressBar").style.width = Math.round((qIdx-1)/total*100)+"%";

    const container = $("#questionView"); container.innerHTML = "";
    const card = document.createElement('div'); card.className='card';
    const h = document.createElement('div'); h.className='question'; h.innerHTML = (qIdx)+". "+esc(q.text);
    const multi = q.choices.filter(c=>c.correct).length>1;
    const help = document.createElement('div'); help.className='small'; help.textContent = multi ? "Select all that apply." : "Select one answer.";
    card.append(h,help);

    const list = document.createElement('div');
    q.choices.forEach(opt=>{
      const row = document.createElement('label'); row.className='opt'; row.dataset.choiceId = opt.id;
      const input = document.createElement('input'); input.type = multi ? "checkbox" : "radio"; input.name = "q-"+q.id;
      input.onchange = ()=>{ const parent = input.closest('.opt'); if(parent){ parent.classList.toggle('selected', input.checked); }
        if (session.options.instantFeedback && !multi){
          const isCorrect = opt.correct;
          list.querySelectorAll('.opt').forEach(el=>el.classList.remove('correct','wrong'));
          row.classList.add(isCorrect?'correct':'wrong');
          session.answers[q.id] = { selectedIds:[opt.id], correct:isCorrect };
        }
      };
      const cap = document.createElement('span'); cap.textContent = opt.text;
      row.append(input,cap); list.appendChild(row);
    });
    card.appendChild(list);

    const checkBtn = document.createElement('button'); checkBtn.className='btn'; checkBtn.textContent = multi || !session.options.instantFeedback ? "Check answer" : "Change answer";
    checkBtn.onclick = ()=>{
      const chosen = Array.from(list.querySelectorAll('input')).filter(i=>i.checked).map(i=>i.parentElement.dataset.choiceId);
      if (!chosen.length){ statusBanner.textContent="ℹ️ Select an option"; return; }
      const correctIds = q.choices.filter(c=>c.correct).map(c=>c.id);
      const isCorrect = chosen.length===correctIds.length && chosen.every(id=>correctIds.includes(id));
      session.answers[q.id] = { selectedIds: chosen, correct: isCorrect };
      if (!isCorrect) try{ recordMistake(q, chosen); }catch(e){}
      list.querySelectorAll('.opt').forEach(el=>{
        const id = el.dataset.choiceId; el.classList.remove('correct','wrong');
        if (correctIds.includes(id)) el.classList.add('correct'); else if (chosen.includes(id)) el.classList.add('wrong');
      });
      // Visual feedback per choice
      const correctIds2 = q.choices.filter(c=>c.correct).map(c=>c.id);
      $$('label.opt').forEach(el=>{
        const id = el.dataset && el.dataset.choiceId; if(!id) return;
        const picked = chosen.includes(id);
        el.classList.toggle('correct', correctIds2.includes(id));
        el.classList.toggle('wrong', picked && !correctIds2.includes(id));
      });
      const correctCt2 = Object.values(session.answers).filter(a=>a.correct).length;
      const attempted2 = Object.keys(session.answers).length;
      $("#scoreMeta").textContent = "Score: "+correctCt2+" / "+attempted2;
    };
    card.appendChild(checkBtn);
    container.appendChild(card);

    $("#prevBtn").onclick = ()=>{ if(session.idx>0){ session.idx--; renderQuestion(); } };
    $("#nextBtn").onclick = ()=>{ if(session.idx<session.questions.length-1){ session.idx++; renderQuestion(); } };
    $("#finishBtn").onclick = ()=>showSummary();
    $("#restartBtn").onclick = ()=>startSessionFrom({ ...session, questions: session.questions.map(q=>({text:q.text, explanation:q.explanation, choices: q.choices.map(c=>({text:c.text, correct:c.correct}))})), id: session.quizId, name: session.name, options: session.options }, "Active");
  }
  function showSummary(){
    const total = session.questions.length;
    const correctCt = Object.values(session.answers).filter(a=>a.correct).length;
    const acc = Math.round((correctCt/total)*100);
    const elapsed = Date.now()-session.start;
    const mins = Math.floor(elapsed/60000), secs = Math.floor((elapsed%60000)/1000);
    const el = document.querySelector("section#player div#summary"); el.classList.remove('hidden');
    el.innerHTML = `<div class="pill">Final score: <b style="margin-left:6px">${correctCt} / ${total}</b></div>
                    <div class="pill">Accuracy: ${acc}%</div>
                    <div class="pill">Time: ${mins}m ${secs}s</div>`;
  }

  
  // ===== Mistakes tracking & viewer =====
  function recordMistake(q, chosenIds){
    const correctIds = q.choices.filter(c=>c.correct).map(c=>c.id);
    const entry = {
      id: uid(),
      at: new Date().toISOString(),
      quizId: session.quizId,
      quizName: session.name,
      question: q.text,
      choices: q.choices.map(c=>({ id:c.id, text:c.text, correct:c.correct })),
      chosen: chosenIds,
      correctIds
    };
    mistakes.unshift(entry); mistakesCurrent.unshift(entry);
    if (mistakes.length > 500) mistakes = mistakes.slice(0, 500);
    saveMistakes(mistakes);
  }

  function renderMistakes(){
    const list = $("#mistakeList"); if (!list) return;
    list.innerHTML = "";
    const source = mistakesFilterAll ? mistakes : (mistakesCurrent.length ? mistakesCurrent : []);
    if (!source.length){ list.innerHTML = "<div class='small'>No mistakes yet.</div>"; return; }
    source.forEach(m => {
      const card = document.createElement('div'); card.className = 'card';
      const header = document.createElement('div');
      header.innerHTML = `<div class="row wrap" style="justify-content:space-between;align-items:center">
        <div class="pill">${esc(m.quizName || 'Quiz')}</div>
        <div class="small">${new Date(m.at).toLocaleString()}</div>
      </div>
      <div class="question" style="margin-top:6px">${esc(m.question)}</div>`;
      card.appendChild(header);
      m.choices.forEach(c => {
        const row = document.createElement('label'); row.className='opt';
        const isChosen = m.chosen.includes(c.id);
        const isCorrect = c.correct;
        const input = document.createElement('input'); input.type='checkbox'; input.disabled = true; input.checked = isChosen;
        const span = document.createElement('span'); span.innerText = (isCorrect?'✅ ':'') + c.text;
        row.classList.toggle('correct', isCorrect);
        row.classList.toggle('wrong', isChosen && !isCorrect);
        row.append(input, span); card.appendChild(row);
      });
      list.appendChild(card);
    });
  }

  $("#exportMistakesBtn") && ($("#exportMistakesBtn").onclick = ()=>{
    const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), mistakes }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'mistakes_export.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
  });
  $("#clearMistakesBtn") && ($("#clearMistakesBtn").onclick = ()=>{
    if (confirm('Clear all recorded mistakes?')){
      mistakes = []; mistakesCurrent = []; saveMistakes(mistakes); renderMistakes();
    }
  });
  $("#filterMistakesCurrent") && ($("#filterMistakesCurrent").onclick = ()=>{ mistakesFilterAll=false; $("#filterMistakesCurrent").classList.add('active'); $("#filterMistakesAll").classList.remove('active'); renderMistakes(); });
  $("#filterMistakesAll") && ($("#filterMistakesAll").onclick = ()=>{ mistakesFilterAll=true; $("#filterMistakesAll").classList.add('active'); $("#filterMistakesCurrent").classList.remove('active'); renderMistakes(); });
// Save / Export
  function downloadBlob(filename, text, type='application/json'){
    const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }
  async function saveAsJSON(filename, dataObj){
    const text = JSON.stringify(dataObj, null, 2);
    if (window.showSaveFilePicker) {
      try{
        const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{description:'JSON', accept:{'application/json':['.json']}}] });
        const stream = await handle.createWritable(); await stream.write(new Blob([text], {type:'application/json'})); await stream.close();
        statusBanner.textContent = "ℹ️ Saved to chosen location"; return;
      }catch(err){ if (err?.name !== 'AbortError') showError("Save As failed: "+err); }
    }
    downloadBlob(filename, text); statusBanner.textContent = "ℹ️ Downloaded JSON";
  }
  function exportSingleQuiz(q){ saveAsJSON((q.name.replace(/[^a-z0-9\-]+/gi,'_')||'quiz')+'.json', q); }
  $("#exportAllBtn").onclick = ()=> saveAsJSON('quizzes_export.json', { exportedAt:new Date().toISOString(), quizzes });

  function saveOrOverwrite(){
    if (!parsedDraft){ statusBanner.textContent="ℹ️ Parse your text first"; return; }
    const title = $("#quizName").value.trim() || parsedDraft.name;
    const normalized = norm(title);
    const editingSame = activeId && parsedDraft.id && activeId === parsedDraft.id;
    const existingByTitle = quizzes.find(q => norm(q.name) === normalized);
    if (!editingSame && existingByTitle){
      if (!confirm(`A quiz named "${existingByTitle.name}" exists.\nOverwrite with current content?`)){ statusBanner.textContent="ℹ️ Save canceled"; return; }
      const toSave = { id: existingByTitle.id, name: existingByTitle.name, options: parsedDraft.options, questions: parsedDraft.questions };
      quizzes = quizzes.map(q => q.id === existingByTitle.id ? toSave : q);
      activeId = existingByTitle.id; safeSave(quizzes); renderQuizList(); statusBanner.textContent="ℹ️ Overwritten"; return;
    }
    const existsById = parsedDraft.id && quizzes.find(q=>q.id===parsedDraft.id);
    const toSave = { id: existsById ? parsedDraft.id : uid(), name: title, options: parsedDraft.options, questions: parsedDraft.questions };
    if (existsById){ quizzes = quizzes.map(q=>q.id===toSave.id ? toSave : q); } else { quizzes.unshift(toSave); }
    activeId = toSave.id; safeSave(quizzes); renderQuizList(); statusBanner.textContent= existsById ? "ℹ️ Saved (overwritten)" : "ℹ️ Saved";
  }
  function saveAsJSONAuto(){
    let data = parsedDraft; let filenameBase = ($("#quizName").value.trim() || (parsedDraft?.name) || 'quiz');
    if (!data){ const q = quizzes.find(x=>x.id===activeId); if (!q){ statusBanner.textContent="ℹ️ Nothing to save"; return; } data = q; filenameBase = q.name; }
    saveAsJSON((filenameBase.replace(/[^a-z0-9\-]+/gi,'_')||'quiz')+'.json', data);
  }

  $("#importJsonBtn").onclick = ()=>$("#importFile").click();
  $("#importFile").addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(reader.result);
        const arr = Array.isArray(obj)? obj : (obj.quizzes || [obj]);
        arr.forEach(q=>{
          q.id = q.id || uid();
          q.questions.forEach(qq=>{ qq.id = qq.id || uid(); qq.choices.forEach(c=>{ c.id = c.id || uid(); }); });
        });
        quizzes = arr.concat(quizzes); safeSave(quizzes); renderQuizList(); statusBanner.textContent = "ℹ️ Imported "+arr.length+" quiz(es)";
      }catch(err){ showError("Invalid JSON: "+err); statusBanner.textContent="ℹ️ Invalid JSON"; }
    };
    reader.readAsText(f); e.target.value = "";
  });

  $("#newQuizBtn").onclick = ()=>{ $("#quizName").value=""; $("#rawInput").value=""; $("#preview").innerHTML=""; parsedDraft=null; switchTab('builder'); };
  $("#startSampleBtn").onclick = ()=>{
    if (!quizzes.length){ quizzes=[sampleQuiz()]; safeSave(quizzes); }
    activeId = quizzes[0].id; renderQuizList(); startSession();
  };
  $("#clearAllBtn").onclick = ()=>{ if (confirm("Remove ALL saved quizzes on this device?")){ quizzes=[]; activeId=null; safeSave(quizzes); renderQuizList(); } };

  // Offline heuristics (kept simple)
  function toSentences(text){ return (text||"").replace(/\s+/g,' ').split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).map(s=>s.trim()).filter(Boolean); }
  function rankSentences(sentences){
    const stop = new Set(("the a an and or but if then to of in on for with by is are was were be been being as at from it its this that these those into over under again more most other some such no nor not only own same so than too very can will just don should now chapter section figure table").split(/\s+/));
    const freq = Object.create(null);
    sentences.forEach(s=> s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).forEach(w=>{ if(!w||stop.has(w)||w.length<3) return; freq[w]=(freq[w]||0)+1; }));
    const score = s=>{ let sc=0; s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).forEach(w=>{ if(!w||stop.has(w)||w.length<3) return; sc += freq[w]||0; }); return sc/Math.sqrt(s.length+1); };
    return sentences.slice().sort((a,b)=>score(b)-score(a));
  }
  function makeQuestionStem(sentence){ const trimmed = sentence.replace(/\s+/g,' ').trim(); return /^(what|which|when|where|why|how)\b/i.test(trimmed) ? (trimmed.endsWith('?')?trimmed:trimmed+'?') : "Which statement matches the chapter content?"; }
  function buildQuizFromText(text){
    const title = (text.split('\n')[0] || 'Generated Quiz').slice(0,80);
    const sentences = toSentences(text).filter(s => s.length > 20);
    const take = Math.min(12, Math.max(4, Math.floor(sentences.length/6)));
    const selected = rankSentences(sentences).slice(0, take);
    const questions = selected.map((s)=>{
      const correct = s.replace(/\s+/g,' ').trim();
      const pool = sentences.filter(x=>x!==s && Math.abs(x.length - s.length) < 60);
      const distractors = shuffle(pool).slice(0,3).map(x=>x.replace(/\s+/g,' ').trim());
      const choices = shuffle([{text:correct, correct:true}].concat(distractors.map(t=>({text:t, correct:false})))).slice(0, Math.max(2, Math.min(4, 1 + distractors.length)));
      return { id: uid(), text: makeQuestionStem(s), explanation:"", choices };
    });
    return { id: uid(), name: title || "Generated Quiz", options:{ shuffleQuestions:false, shuffleChoices:true, instantFeedback:true }, questions };
  }
  function topTerms(text, k){
    const stop = new Set(("the a an and or but if then to of in on for with by is are was were be been being as at from it its this that these those into over under again more most other some such no nor not only own same so than too very can will just don should now chapter section figure table").split(/\s+/));
    const freq = Object.create(null);
    text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).forEach(w=>{ if(!w||stop.has(w)||w.length<4) return; freq[w]=(freq[w]||0)+1; });
    return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([w])=>w);
  }
  function buildFlashcardsFromText(text){
    const sentences = toSentences(text); const terms = topTerms(text, 20);
    return terms.map(term=>{ const def = sentences.find(s=> new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(s)) || ""; return { id: uid(), front: term, back: def || "Definition/example from chapter." }; });
  }
  function summarizeText(text){
    const sentences = toSentences(text); if (sentences.length<=5) return text.trim();
    const ranked = rankSentences(sentences); const take = Math.min(12, Math.max(4, Math.floor(sentences.length/8)));
    return ranked.slice(0,take).join(' ');
  }

  function renderFlashcards(cards){
    const wrap = $("#flashWrap"); wrap.innerHTML="";
    if (!cards.length){ wrap.innerHTML = "<div class='small'>No cards created.</div>"; return; }
    cards.forEach(c=>{
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `<b>${esc(c.front)}</b><div class="small">${esc(c.back)}</div>`;
      wrap.appendChild(card);
    });
    $("#exportFlashBtn").onclick = ()=> saveAsJSON('flashcards.json', { cards });
  }

  function loadQuizIntoBuilder(q){
    $("#quizName").value = q.name || "Generated Quiz";
    parsedDraft = { id: q.id || uid(), name: q.name || "Generated Quiz", options: q.options || {}, questions: q.questions };
    const blocks = q.questions.map((qq,i)=>{
      const lines = [];
      lines.push((i+1)+") "+qq.text);
      qq.choices.forEach(c=>{ lines.push((c.correct?'✅ ':'❎ ')+c.text); });
      if (qq.explanation) lines.push("explain: "+qq.explanation);
      return lines.join("\n");
    });
    $("#rawInput").value = "# Quiz: "+(q.name || "Generated Quiz")+"\n\n"+blocks.join("\n\n-\n\n");
    renderPreview(parsedDraft);
    statusBanner.textContent = "ℹ️ Loaded into builder";
  }

  function sampleQuiz(){
    return {
      id: uid(),
      name: "Sample — Emoji Format",
      options: { shuffleQuestions:false, shuffleChoices:false, instantFeedback:true },
      questions: [
        { id: uid(), text: "What does ACE stand for?", explanation:"ACE converts angiotensin I to angiotensin II.", choices:[
          {text:"Angiotensin-Converting Enzyme", correct:true},
          {text:"Acetylcholine Esterase", correct:false},
          {text:"Adenosine Cyclase Enzyme", correct:false},
          {text:"Acid Citrate Enzyme", correct:false}
        ]},
        { id: uid(), text: "Which of the following are ARBs? (Select all that apply)", explanation:"ARBs end with -sartan.", choices:[
          {text:"Losartan", correct:true},
          {text:"Valsartan", correct:true},
          {text:"Amlodipine", correct:false},
          {text:"Metoprolol", correct:false}
        ]}
      ]
    };
  }

  if (!quizzes.length){ quizzes=[sampleQuiz()]; safeSave(quizzes); }
  renderQuizList();
});

  // ===== Flashcards =====
  let flashcards = [];
  function makeFlashcards(){
    if (!session || !session.questions || !session.questions.length){ statusBanner.textContent='ℹ️ No quiz loaded.'; return; }
    flashcards = session.questions.map((q, idx)=>{
      const correct = q.choices.filter(c=>c.correct).map(c=>c.text);
      const back = correct.length ? correct.join('\n') : '(No correct marked)';
      return { id: uid(), i: idx+1, front: q.text, back };
    });
    renderFlashcards();
    switchTab('flashcards');
  }
  function renderFlashcards(){
    const list = $("#flashcardsList"); if (!list) return;
    list.innerHTML = "";
    if (!flashcards.length){ list.innerHTML = "<div class='small'>No flashcards yet. Click “Generate from current quiz”.</div>"; return; }
    flashcards.forEach(fc=>{
      const card = document.createElement('div'); card.className = 'fc';
      card.innerHTML = `<div class="small pill">#${fc.i}</div>
        <div style="margin-top:6px"><b>Front:</b> ${esc(fc.front)}</div>
        <div style="margin-top:6px"><b>Back:</b><br>${esc(fc.back)}</div>`;
      list.appendChild(card);
    });
  }
  $("#makeFlashcardsBtn") && ($("#makeFlashcardsBtn").onclick = ()=> makeFlashcards());
  $("#exportFlashcardsBtn") && ($("#exportFlashcardsBtn").onclick = ()=>{
    if (!flashcards.length){ alert('No flashcards to export'); return; }
    const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), flashcards }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'flashcards.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
  });
