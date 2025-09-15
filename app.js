// ===== Sidebar controls =====
document.getElementById('openDrawerBtn').onclick=()=>document.body.classList.add('drawer-open');
document.getElementById('closeDrawerBtn').onclick=()=>document.body.classList.remove('drawer-open');
document.getElementById('drawerBackdrop').onclick=()=>document.body.classList.remove('drawer-open');

// Save API key
document.getElementById('saveKeyBtn').onclick=()=>{
  localStorage.setItem('openaiKey',document.getElementById('apiKeyInput').value.trim());
  alert("API key saved locally.");
};

// ===== Saved quizzes (localStorage) =====
function getSaved(){return JSON.parse(localStorage.getItem("quizzes")||"{}");}
function setSaved(q){localStorage.setItem("quizzes",JSON.stringify(q));renderSaved();}
function renderSaved(){
  const saved=getSaved();
  const list=document.getElementById('savedList');
  list.innerHTML=Object.keys(saved).map(k=>`
    <div>
      <b>${k}</b>
      <button onclick="loadQuiz('${k}')">▶</button>
      <button onclick="deleteQuiz('${k}')">🗑️</button>
    </div>`).join("")||"<p>No saved quizzes</p>";
}
function saveQuiz(title,text){
  const saved=getSaved();
  if(saved[title] && !confirm("Overwrite existing quiz?")) return;
  saved[title]=text; setSaved(saved);
}
function loadQuiz(title){offlineQuiz(getSaved()[title]);}
function deleteQuiz(title){const s=getSaved();delete s[title];setSaved(s);}
function exportQuizzes(){
  const data=JSON.stringify(getSaved());
  const blob=new Blob([data],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="quizzes.json";a.click();
}
document.getElementById("importInput").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  const text=await f.text();setSaved(JSON.parse(text));
});
renderSaved();

// ===== Drop/choose handling =====
const dropWrap=document.getElementById('dropWrap');
dropWrap.addEventListener('dragover',e=>{e.preventDefault();dropWrap.classList.add('drag')});
dropWrap.addEventListener('dragleave',()=>dropWrap.classList.remove('drag'));
dropWrap.addEventListener('drop',async e=>{
  e.preventDefault(); dropWrap.classList.remove('drag');
  const f=e.dataTransfer.files[0]; if(f) await readChapterFile(f);
});
document.getElementById('fileInput').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) readChapterFile(f);
});

// ===== File reading (txt/docx/pdf/img) =====
async function readChapterFile(file){
  document.getElementById('jsBanner').textContent="Reading "+file.name+"…";
  let text="";
  if(file.name.endsWith('.txt')||file.name.endsWith('.md')){
    text=await file.text();
  }else if(file.name.endsWith('.docx')){
    const buf=await file.arrayBuffer();
    const r=await window.mammoth.extractRawText({arrayBuffer:buf});
    text=r.value;
  }else if(file.name.endsWith('.pdf')){
    const buf=await file.arrayBuffer();
    text=await extractTextFromPDF(buf);
  }else if(/\.(png|jpg|jpeg)$/i.test(file.name)){
    text=await ocrImage(file);
  }
  document.getElementById('jsBanner').textContent="Loaded text length "+text.length;
  showOptions(text);
}

// ===== PDF + OCR =====
async function extractTextFromPDF(arrayBuffer){
  const banner=document.getElementById('jsBanner');
  const pdf=await pdfjsLib.getDocument({data:arrayBuffer}).promise;
  let full=""; const max=Math.min(pdf.numPages,10);
  for(let i=1;i<=max;i++){
    const page=await pdf.getPage(i);
    const c=await page.getTextContent();
    const parts=c.items.map(it=>it.str).join(" ");
    full+=parts+" ";
  }
  if(full.trim().length>20) return full;
  banner.textContent="Running OCR on scanned PDF…";
  return await ocrPdfArrayBuffer(arrayBuffer,banner);
}
async function ocrImage(file){
  const {data}=await Tesseract.recognize(file,'eng');
  return data.text;
}
async function renderPdfPageToCanvas(pdf,p,scale=2){
  const page=await pdf.getPage(p);
  const v=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  canvas.width=v.width; canvas.height=v.height;
  await page.render({canvasContext:ctx,viewport:v}).promise;
  return canvas;
}
async function ocrPdfArrayBuffer(buf,status){
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let full=""; const max=Math.min(pdf.numPages,3);
  for(let i=1;i<=max;i++){
    status.textContent=`OCR page ${i}/${max}`;
    const c=await renderPdfPageToCanvas(pdf,i,2);
    const {data}=await Tesseract.recognize(c,'eng');
    full+=data.text+" ";
  }
  return full;
}

// ===== Options after load =====
function showOptions(text){
  const out=document.getElementById('output');
  const tokenEstimate=Math.ceil(text.length/4);
  const warn= tokenEstimate>100000 ? `<p style="color:orange">⚠️ Warning: This file may be too large for AI (≈${tokenEstimate} tokens)</p>` : "";
  out.innerHTML=`
    ${warn}
    <input id="quizTitle" placeholder="Quiz Title"/>
    <br>
    <button class="btn primary" onclick="offlineQuiz(\`${escapeBackticks(text)}\`)">Offline Quiz</button>
    <button class="btn" onclick="offlineFlashcards(\`${escapeBackticks(text)}\`)">Offline Flashcards</button>
    <button class="btn" onclick="aiProcess(\`${escapeBackticks(text)}\`,'quiz')">AI Quiz</button>
    <button class="btn" onclick="aiProcess(\`${escapeBackticks(text)}\`,'flashcards')">AI Flashcards</button>
    <button class="btn" onclick="aiProcess(\`${escapeBackticks(text)}\`,'summary')">AI Summary</button>
    <button class="btn danger" onclick="aiProcess(\`${escapeBackticks(text)}\`,'full')">⚠️ Send FULL TEXT to AI</button>
    <div id="aiOut"></div>
  `;
}
function escapeBackticks(s){return s.replace(/`/g,"\\`")}

// ===== Offline Quiz =====
function offlineQuiz(text){
  const questions=parseQuizFormat(text);
  playQuiz(questions);
  const title=document.getElementById("quizTitle")?.value||"Untitled";
  saveQuiz(title,text);
}
function parseQuizFormat(text){
  const blocks=text.split(/\n-\n/).filter(b=>b.trim());
  return blocks.map(b=>{
    const lines=b.split("\n").filter(l=>l.trim());
    const q=lines[0];
    const opts=lines.slice(1).map(l=>({text:l.slice(1).trim(),correct:l.startsWith("✅")}));
    return {q,opts};
  });
}
function playQuiz(questions){
  let idx=0; let mistakes=[];
  const out=document.getElementById('aiOut');
  function render(){
    if(idx>=questions.length){
      out.innerHTML=`<h3>Quiz Finished</h3>
        <p>Score: ${questions.length-mistakes.length}/${questions.length}</p>
        <button class="btn" onclick="reviewMistakes()">Review Mistakes</button>`;
      window._quizMistakes=mistakes; return;
    }
    const q=questions[idx];
    out.innerHTML=`<div class="question"><b>${q.q}</b></div>`+
      q.opts.map((o,i)=>`<div class="opt"><input type="radio" name="o" value="${i}">${o.text}</div>`).join("")+
      `<br><button class="btn" onclick="_check()">Submit</button>`;
    window._check=()=>{
      const sel=[...out.querySelectorAll("input:checked")].map(i=>+i.value);
      if(sel.length===0)return;
      const correct=q.opts.findIndex(o=>o.correct);
      if(sel[0]===correct){out.querySelectorAll(".opt")[sel[0]].classList.add("correct");}
      else{
        out.querySelectorAll(".opt")[sel[0]].classList.add("wrong");
        out.querySelectorAll(".opt")[correct].classList.add("correct");
        mistakes.push(q);
      }
      idx++; setTimeout(render,1000);
    };
  }
  render();
}
function reviewMistakes(){
  const out=document.getElementById('aiOut');
  const ms=window._quizMistakes||[];
  out.innerHTML=`<h3>Mistakes Review</h3>`+
    ms.map(q=>`<div class="review"><b>${q.q}</b><br>`+
    q.opts.map(o=>`${o.correct?"✅":"❎"} ${o.text}`).join("<br>")+"</div>").join("");
}

// ===== Offline Flashcards =====
function offlineFlashcards(text){
  const lines=text.split("\n").filter(l=>l.includes(":"));
  const cards=lines.map(l=>{const [f,b]=l.split(":");return {f,b};});
  const out=document.getElementById('aiOut');
  let idx=0;
  function render(){
    if(idx>=cards.length){out.innerHTML="<p>All cards done.</p>";return;}
    const c=cards[idx];
    out.innerHTML=`<div class="card"><b>${c.f}</b><br><button class="btn" onclick="showBack()">Show Answer</button></div>`;
    window.showBack=()=>{out.innerHTML=`<div class="card"><b>${c.f}</b><br>${c.b}</div><button class="btn" onclick="next()">Next</button>`;};
    window.next=()=>{idx++;render();};
  }
  render();
}

// ===== AI calls =====
async function aiProcess(text,mode){
  const key=localStorage.getItem('openaiKey');
  if(!key){alert("No API key saved");return;}
  const model=document.getElementById('modelSelect').value;
  let prompt="";
  if(mode==='quiz') prompt="Generate multiple choice quiz with ✅/❎ format from this text:\n"+text;
  else if(mode==='flashcards') prompt="Generate flashcards (front/back) from this text:\n"+text;
  else if(mode==='summary') prompt="Summarize this text:\n"+text;
  else if(mode==='full') prompt="Analyze this full text without truncation:\n"+text;
  const tokenEstimate=Math.ceil(text.length/4);
  if(tokenEstimate>150000){
    alert("⚠️ File may exceed model context length. Consider trimming.");
  }
  const r=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({
      model,
      messages:[{role:"system",content:"You are a helpful study assistant."},{role:"user",content:prompt}],
      temperature:0.7,max_tokens:2000
    })
  });
  const d=await r.json();
  const msg=d.choices?.[0]?.message?.content||"Error";
  document.getElementById('aiOut').textContent=msg;
}
