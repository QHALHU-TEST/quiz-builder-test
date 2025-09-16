// ===== helpers =====
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => (s==null? "": String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ===== minimal global state =====
let session = null; // { quizId, name, idx, questions: [ {id,text,choices:[{id,text,correct}], explanation?} ] }

// ===== tabs =====
function switchTab(name){
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab===name));
  const ids = ["builder","player","mistakes"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", id!==name);
  });
}
$$(".tab").forEach(t => t.addEventListener("click", () => {
  const tab = t.dataset.tab;
  switchTab(tab);
  if (tab==="mistakes") renderMistakes();
}));

// ===== builder parsing =====
function parseRawToQuestions(raw){
  // Supports:
  //   Optional "# Quiz: title"
  //   Questions separated by either a single line "-" OR a blank line
  //   Choices are lines starting with "-" (dash/bullet). Add "✅" anywhere to mark correct.
  let name = $("#quizName").value.trim();
  const m = raw.match(/^#\s*Quiz:\s*(.+)$/mi);
  if (m && !name) name = m[1].trim();

  const afterTitle = raw.replace(/^#\s*Quiz:.+$/gmi,"").trim();
  const blocks = afterTitle.split(/(?:\n\s*-\s*\n|\n\s*\n+)/);

  const questions = [];
  for (let block of blocks){
    const lines = block.split(/\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) continue;
    let qText = lines.shift();
    qText = qText.replace(/^\d+\s*[\).:-]\s*/,"").trim();

    const choices = []; let explanation = "";
    for (const line of lines){
      if (/^\-\s*/.test(line)){
        const t = line.replace(/^\-\s*/,'');
        const correct = /✅/.test(t);
        choices.push({ id: uid(), text: t.replace(/✅/g,'').trim(), correct });
      }else if (/^exp[:\-]/i.test(line)){
        explanation = line.replace(/^exp[:\-]\s*/i,'').trim();
      }else{
        // treat as continuation of previous line or ignore
        if (choices.length>0){
          choices[choices.length-1].text += " " + line;
        }else{
          qText += " " + line;
        }
      }
    }
    if (qText && choices.length){
      const q = { id: uid(), text: qText, choices };
      if (explanation) q.explanation = explanation;
      questions.push(q);
    }
  }
  return { name: name || "Active Quiz", questions };
}

$("#loadSampleBtn").onclick = ()=>{
  $("#rawInput").value =
`# Quiz: General Sample

What is the capital of France?
- Paris ✅
- Lyon
- Marseille

-
2 + 2 = ?
- 3
- 4 ✅
- 5

-
Select the fruits:
- Apple ✅
- Carrot
- Banana ✅`;
};

$("#parseBtn").onclick = ()=>{
  const raw = $("#rawInput").value.trim();
  if (!raw){ alert("Paste your quiz first."); return; }
  const quiz = parseRawToQuestions(raw);
  $("#parseResult").innerHTML =
    `<div class="pill">Parsed:</div> <b>${esc(quiz.name)}</b> — <span class="small">${quiz.questions.length} questions</span>`;
};

$("#testBtn").onclick = ()=>{
  const raw = $("#rawInput").value.trim();
  if (!raw){ alert("Paste your quiz first."); return; }
  const quiz = parseRawToQuestions(raw);
  startSessionFrom(quiz, "Test Run");
  switchTab("player");
};

$("#saveBtn").onclick = ()=>{
  const raw = $("#rawInput").value.trim();
  if (!raw){ alert("Paste your quiz first."); return; }
  const quiz = parseRawToQuestions(raw);
  startSessionFrom(quiz, "Active");
  switchTab("player");
};

// ===== player =====
function startSessionFrom(quizObj, labelPrefix="Active"){
  session = {
    quizId: uid(),
    name: `${labelPrefix}: ${quizObj.name}`,
    idx: 0,
    questions: quizObj.questions.map(q => ({
      id: uid(),
      text: q.text,
      explanation: q.explanation || "",
      choices: q.choices.map(c => ({ id: uid(), text: c.text, correct: !!c.correct }))
    }))
  };
  // Reset attempts for the new quiz (used by Mistakes feature)
  resetAttempts();
  renderQuestion();
}

function renderQuestion(){
  const q = session.questions[session.idx];
  $("#activeQuizName").textContent = session.name;
  $("#progressText").textContent = `${session.idx+1}/${session.questions.length}`;

  const wrap = $("#questionView");
  wrap.innerHTML = `
    <div class="row wrap small" style="gap:8px">
      <div class="pill">Question</div>
      <div class="pill">#${session.idx+1}</div>
    </div>
    <div class="question">${esc(q.text)}</div>
    <div id="options"></div>
  `;
  const list = $("#options");

  // single-choice if exactly one correct; else multi-choice
  const multi = q.choices.filter(c=>c.correct).length !== 1;

  q.choices.forEach((c, i)=>{
    const lab = document.createElement("label");
    lab.className = "opt";
    lab.dataset.choiceId = c.id;

    const input = document.createElement("input");
    input.type = multi ? "checkbox" : "radio";
    input.name = `q_${q.id}`;

    const txt = document.createElement("div");
    txt.textContent = c.text;

    // restore previous selection if any
    const prev = attemptsCurrent.find(a => a.question === q.text);
    if (prev && prev.chosen.includes(c.id)) input.checked = true;

    lab.appendChild(input);
    lab.appendChild(txt);
    list.appendChild(lab);
  });

  $("#prevBtn").disabled = (session.idx===0);
  $("#nextBtn").disabled = (session.idx>=session.questions.length-1);
}

$("#prevBtn").onclick = ()=>{
  if (session.idx>0){ session.idx--; renderQuestion(); }
};

$("#nextBtn").onclick = ()=>{
  // (wrapped by Mistakes feature; original logic remains)
  if (session.idx < session.questions.length-1){
    session.idx++;
    renderQuestion();
  }
};

$("#finishBtn").onclick = ()=>{
  // (wrapped by Mistakes feature; original logic remains)
  alert("Quiz finished! Open the Mistakes tab to review.");
};

// ===== Mistakes feature (requested) =====
// Collects answers on NEXT, shows all inputs on Finish, toggle Incorrect/All

let attemptsCurrent = [];
let attemptsFinalized = false;
let showIncorrectOnly = true;

function resetAttempts(){ attemptsCurrent=[]; attemptsFinalized=false; }

function recordAttemptFromDom(q){
  const chosen = Array.from(document.querySelectorAll('#questionView input'))
    .filter(i=>i.checked).map(i=>i.parentElement.dataset.choiceId);

  const correctIds = q.choices.filter(c=>c.correct).map(c=>c.id);
  const isCorrect = chosen.length===correctIds.length && chosen.every(id=>correctIds.includes(id));

  const entry = {
    id: uid(),
    at: new Date().toISOString(),
    quizId: session.quizId,
    quizName: session.name,
    question: q.text,
    choices: q.choices.map(c=>({ id:c.id, text:c.text, correct:c.correct })),
    chosen,
    correct: isCorrect
  };

  const i = attemptsCurrent.findIndex(a=>a.question===q.text);
  if (i>=0) attemptsCurrent[i]=entry; else attemptsCurrent.push(entry);
}

function renderMistakes(){
  const list = $("#mistakeList"); if (!list) return;
  list.innerHTML = "";
  if (!attemptsFinalized){
    list.innerHTML = "<div class='small'>Finish the quiz to review answers.</div>";
    return;
  }
  const data = showIncorrectOnly ? attemptsCurrent.filter(a=>!a.correct) : attemptsCurrent;
  if (!data.length){
    list.innerHTML = "<div class='small'>No entries to show.</div>";
    return;
  }
  data.forEach(m=>{
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `
      <div class="row wrap" style="justify-content:space-between;align-items:center">
        <div class="pill">${esc(m.quizName || 'Quiz')}</div>
        <div class="small">${new Date(m.at).toLocaleString()}</div>
      </div>
      <div class="question" style="margin-top:6px">${esc(m.question)}</div>
    `;
    m.choices.forEach(c=>{
      const row = document.createElement('div'); row.className='opt';
      const isChosen = m.chosen.includes(c.id);
      if (c.correct) row.classList.add('correct');
      if (isChosen && !c.correct) row.classList.add('wrong');
      const cb = document.createElement('input'); cb.type='checkbox'; cb.disabled=true; cb.checked=isChosen;
      const text = document.createElement('div');
      const prefix = c.correct ? '✅ ' : (isChosen ? '❌ ' : '');
      text.innerHTML = prefix + esc(c.text);
      row.appendChild(cb); row.appendChild(text);
      card.appendChild(row);
    });
    list.appendChild(card);
  });
}

// Toggle buttons
document.addEventListener('click', (e)=>{
  if (!e.target) return;
  if (e.target.id==='filterIncorrect'){
    showIncorrectOnly = true;
    e.target.classList.add('active');
    const o = $('#filterAllAnswers'); if (o) o.classList.remove('active');
    renderMistakes();
  }
  if (e.target.id==='filterAllAnswers'){
    showIncorrectOnly = false;
    e.target.classList.add('active');
    const o = $('#filterIncorrect'); if (o) o.classList.remove('active');
    renderMistakes();
  }
});

// Wrap original Next/Finish so we don’t alter your existing flows
(function(){
  const next = $('#nextBtn');
  if (next){
    const original = next.onclick;
    next.onclick = ()=>{
      try{
        if (session && session.questions && session.questions[session.idx]){
          recordAttemptFromDom(session.questions[session.idx]);
        }
      }catch(e){}
      if (typeof original === 'function') return original();
    };
  }
  const finish = $('#finishBtn');
  if (finish){
    const originalF = finish.onclick;
    finish.onclick = ()=>{
      try{
        if (session && session.questions && session.questions[session.idx]){
          recordAttemptFromDom(session.questions[session.idx]);
        }
      }catch(e){}
      attemptsFinalized = true;
      renderMistakes();
      if (typeof originalF === 'function') return originalF();
    };
  }
})();
