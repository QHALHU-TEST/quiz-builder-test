'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2,10);
  const norm = s => (s||"").trim().toLowerCase();
  const esc  = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const statusBanner = $("#jsBanner");

  statusBanner.textContent = "✅ Ready — mobile UI fixed; OCR enabled; AI + offline; review mistakes.";

  // Error handling
  const logEl = $("#errorLog"), boxEl = $("#errorBox");
  function showError(e){
    boxEl && boxEl.classList.remove('hidden');
    if (logEl) logEl.textContent += (logEl.textContent? "\n":"") + e;
    console.error(e);
  }
  window.addEventListener("error", ev => showError(`${ev.message || ev} @ ${ev.filename||""}:${ev.lineno||""}`));
  window.addEventListener("unhandledrejection", ev => showError(`Promise rejection: ${ev?.reason?.stack || ev?.reason || ev}`));

  // Storage
  const STORAGE_KEY = "quizBuilder.v17.ocr.quizzes";
  function safeLoad(){ try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ showError("Load failed: "+e); return []; } }
  function safeSave(arr){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch(e){ showError("Save failed: "+e); } }

  let quizzes = safeLoad();
  let activeId = quizzes[0]?.id || null;
  let parsedDraft = null;
  let session = null;

  // Tabs
  function switchTab(name){
    $$(".tab").forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
    ["home","builder","player","flashcards","summary"].forEach(id=>{
      const sec = $("#"+id);
      if (sec) sec.classList.toggle('hidden', id!==name);
    });
  }
  $$(".tab").forEach(t=>t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  $("#goHomeBtn").addEventListener('click', ()=>switchTab('home'));
  switchTab('home');

  // Drawer close on main tap (mobile)
  document.querySelector('.main').addEventListener('click', ()=>document.body.classList.remove('drawer-open'));

  // Helpers
  function mkBtn(txt, fn, cls=''){ const b=document.createElement('button'); b.className='btn '+cls; b.textContent=txt; b.onclick=fn; return b; }
  function shuffle(a){ const x=a.slice(); for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; }
  function toSentences(text){ return (text||"").replace(/\s+/g,' ').split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).map(s=>s.trim()).filter(Boolean); }

  // Render saved list
  function renderQuizList(){
    const list = $("#quizList");
    list.innerHTML = "";
    if (!quizzes.length){
      list.innerHTML = "<div class='pill'>No quizzes yet</div>";
      $("#activeQuizLabel").textContent = "No quiz selected";
      $("#activeQuizLabelMobile").textContent = "No quiz selected";
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
        mkBtn('Delete', ()=>{ if (confirm(`Delete quiz "${q.name}"?`)){ quizzes = quizzes.filter(x=>x.id!==q.id); if (activeId===q.id) activeId = quizzes[0]?.id || null; safeSave(quizzes); renderQuizList(); } }, 'danger')
      );
      card.append(head, actions);
      list.appendChild(card);
    });
    const active = quizzes.find(q=>q.id===activeId);
    const label = active ? "Active: "+active.name : "No quiz selected";
    $("#activeQuizLabel").textContent = label;
    $("#activeQuizLabelMobile").textContent = label;
  }

  // ===== File drop & reading =====
  const dropWrap = $("#dropWrap");
  const chooseBtn = $("#chooseFileBtn");
  const chooseInput = $("#chooseFileInput");
  const chooser = $("#featureChooser");
  const loadedMeta = $("#loadedMeta");
  let loadedText = "";

  ["dragenter","dragover"].forEach(ev=>dropWrap.addEventListener(ev, (e)=>{e.preventDefault(); dropWrap.classList.add('drag');}));
  ["dragleave","drop"].forEach(ev=>dropWrap.addEventListener(ev, (e)=>{e.preventDefault(); dropWrap.classList.remove('drag');}));
  dropWrap.addEventListener('drop', async (e)=>{
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) { await readChapterFile(file); return; }
  });

  chooseBtn.addEventListener('click', ()=>chooseInput.click());
  chooseInput.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (f){ await readChapterFile(f); e.target.value=""; } });

  async function readChapterFile(file){
    const name = file.name || 'file';
    const lower = name.toLowerCase();
    try{
      if (/\.(txt|md)$/i.test(lower)){ loadedText = await file.text(); }
      else if (/\.pdf$/i.test(lower)){ loadedText = await extractTextFromPDF(await file.arrayBuffer()); }
      else if (/\.docx$/i.test(lower)){ loadedText = await extractTextFromDOCX(await file.arrayBuffer()); }
      else { alert("Please provide a .txt, .md, .pdf, or .docx file."); return; }
    }catch(err){
      showError("Read failed: "+err);
      alert("Could not read the file.");
      return;
    }
    loadedMeta.textContent = `Loaded: ${name} • ${loadedText.length.toLocaleString()} characters`;
    chooser.classList.remove('hidden'); switchTab('home');
  }

  async function extractTextFromPDF(arrayBuffer){
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded");
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let full = "";
    for (let p=1; p<=pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const parts = content.items.map(it => it.str || '').filter(Boolean);
      full += parts.join(' ') + "\n";
    }
    full = full.replace(/\s+/g,' ').trim();
    if (!full) {
      // OCR fallback
      full = await runOcrOnPdf(pdf);
    }
    return full;
  }

  async function runOcrOnPdf(pdf){
    if (!window.Tesseract) throw new Error("Tesseract.js not loaded");
    let text = "";
    for (let p=1; p<=Math.min(pdf.numPages, 5); p++){ // limit for speed
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data: { text: ocrText } } = await Tesseract.recognize(canvas, 'eng');
      text += ocrText + "\n";
    }
    return text.replace(/\s+/g,' ').trim();
  }

  async function extractTextFromDOCX(arrayBuffer){
    if (!window.mammoth) throw new Error("Mammoth.js not loaded");
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return (value || "").replace(/\s+$/,'');
  }

  // ===== AI helpers =====
  async function aiChat(messages){
    const apiKey = localStorage.getItem("openaiKey"); if (!apiKey) throw new Error("Missing API key");
    const model = localStorage.getItem("openaiModel") || "gpt-4o-mini";
    const temperature = parseFloat(localStorage.getItem("openaiTemp") || "0.7");
    const max_tokens = Math.max(100, Math.min(4000, parseInt(localStorage.getItem("openaiMaxTokens") || "1200", 10)));
    if (loadedText.length > 120000) alert("⚠️ File is very large. Sending full text to AI may fail or be truncated.");
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

  // (rest of your existing quiz builder, parser, player, flashcards, summary, import/export code stays as in your last working version…)
  
  if (!quizzes.length){ quizzes=[{id:uid(),name:"Sample",options:{},questions:[]}]; safeSave(quizzes); }
  renderQuizList();
});
