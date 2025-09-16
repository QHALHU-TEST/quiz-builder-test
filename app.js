'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2,10);
  const norm = s => (s||"").trim().toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // ---- NEW: The exact prompt to copy ----
  const GENERATION_PROMPT = `Creat as much multiple choice and true or false questions from this chapter as possible

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

  // Status banner
  const statusBanner = $("#jsBanner");
  if (statusBanner) statusBanner.textContent = "✅ JavaScript is running (copy prompt + '-' separator supported).";

  // Error capture
  const logEl = $("#errorLog");
  const boxEl = $("#errorBox");
  function showError(e){
    boxEl && boxEl.classList.remove('hidden');
    if (logEl) logEl.textContent += "\n" + e;
    console.error(e);
  }
  window.addEventListener("error", ev => showError((ev && ev.message ? ev.message : ev) + "\n" + (ev.filename||"") + ":" + (ev.lineno||"")));
  window.addEventListener("unhandledrejection", ev => showError("Promise rejection: " + (ev && ev.reason && (ev.reason.stack || ev.reason) || ev)));

  const STORAGE_KEY = "quizBuilder.v10.emoji.pwa.quizzes";
  let memoryStore = [];
  function safeLoad(){ try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ showError("localStorage load failed: "+e); return memoryStore; } }
  function safeSave(arr){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch(e){ showError("localStorage save failed: "+e); memoryStore = arr; } }

  // State
  let quizzes = safeLoad();
  let activeId = quizzes[0]?.id || null;
  let parsedDraft = null;
  let session = null;

  function toast(msg){ if (statusBanner) statusBanner.textContent = "ℹ️ " + msg; }

  // Drawer controls
  const body = document.body;
  const menuBtn = $("#menuBtn");
  const closeDrawerBtn = $("#closeDrawerBtn");
  const activeQuizLabelMobile = $("#activeQuizLabelMobile");
  function openDrawer(){ body.classList.add('drawer-open'); }
  function closeDrawer(){ body.classList.remove('drawer-open'); }
  menuBtn && menuBtn.addEventListener('click', openDrawer);
  closeDrawerBtn && closeDrawerBtn.addEventListener('click', closeDrawer);
  $(".main")?.addEventListener('click', () => { if (window.innerWidth <= 1000 && body.classList.contains('drawer-open')) closeDrawer(); });

  // CRUD list
  function renderQuizList(){
    const list = $("#quizList"); if (!list) return;
    list.innerHTML = "";
    if (!quizzes.length){
      list.innerHTML = "<div class='pill'>No quizzes yet</div>";
      $("#activeQuizLabel").textContent = "No quiz selected";
      if (activeQuizLabelMobile) activeQuizLabelMobile.textContent = "No quiz selected";
      return;
    }
    quizzes.forEach(q=>{
      const card = document.createElement('div'); card.className = 'card';
      const header = document.createElement('div');
      header.innerHTML = "<b>"+esc(q.name)+"</b> • "+q.questions.length+" questions";
      const actions = document.createElement('div'); actions.className = 'list-actions';

      const play = document.createElement('button'); play.className='btn'; play.textContent='Play';
      play.onclick = ()=>{ activeId=q.id; startSession(); if (window.innerWidth<=1000) closeDrawer(); switchTab('player'); };

      const edit = document.createElement('button'); edit.className='btn'; edit.textContent='Edit';
      edit.onclick = ()=>{ activeId=q.id; loadQuizIntoBuilder(q); if (window.innerWidth<=1000) closeDrawer(); switchTab('builder'); };

      const exp = document.createElement('button'); exp.className='btn'; exp.textContent='Export';
      exp.onclick = ()=>exportSingleQuiz(q);

      const del = document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      del.onclick = ()=>{
        if (confirm(`Delete quiz "${q.name}"?`)) {
          quizzes = quizzes.filter(x => x.id !== q.id);
          if (activeId === q.id) activeId = quizzes[0]?.id || null;
          safeSave(quizzes);
          renderQuizList();
          toast("Deleted quiz");
        }
      };

      actions.append(play, edit, exp, del);
      card.append(header, actions);
      list.appendChild(card);
    });
    const activeQuiz = quizzes.find(q=>q.id===activeId);
    const label = activeQuiz ? "Active: "+activeQuiz.name : "No quiz selected";
    $("#activeQuizLabel").textContent = label;
    if (activeQuizLabelMobile) activeQuizLabelMobile.textContent = label;
  }

  function switchTab(name){
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  const ids=['builder','player','flashcards','mistakes'];
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.toggle('hidden', id!==name); });
}

  // Builder helpers
  function loadQuizIntoBuilder(q){
    $("#quizName").value = q.name;
    $("#shuffleQuestions").checked = !!q.options?.shuffleQuestions;
    $("#shuffleChoices").checked = !!q.options?.shuffleChoices;
    $("#instantFeedback").checked = q.options?.instantFeedback !== false;
    parsedDraft = { id: q.id, name: q.name, options: q.options, questions: q.questions };

    const blocks = q.questions.map((qq,i)=>{
      const lines = [];
      lines.push((i+1)+") "+qq.text);
      qq.choices.forEach(c=>{ lines.push((c.correct?'✅ ':'❎ ')+c.text); });
      if (qq.explanation) lines.push("explain: "+qq.explanation);
      return lines.join("\n");
    });
    $("#rawInput").value = "# Quiz: "+q.name+"\n\n"+blocks.join("\n\n-\n\n");
    renderPreview(parsedDraft);
    toast("Loaded into builder (editing — Save will overwrite)");
  }

  function parseChoiceLine(ln){
    const s = ln.trim();
    if (/^[✅❎]/.test(s)){ const correct = s.startsWith("✅"); return { text: s.replace(/^[✅❎]\s*/,""), correct }; }
    if (/^[\+\-]/.test(s)){ const correct = s.startsWith("+"); return { text: s.replace(/^[\+\-]\s*/,""), correct }; }
    return null;
  }

  function parseRaw(){
    const raw = $("#rawInput").value.trim();
    if(!raw){ toast("Paste questions first"); return null; }
    let name = $("#quizName").value.trim();
    const m = raw.match(/^#\s*Quiz:\s*(.+)$/mi);
    if (m && !name) name = m[1].trim();

    // ---- NEW: support both blank-line splits and a single "-" on its own line
    const afterTitle = raw.replace(/^#\s*Quiz:.+$/gmi,"").trim();
    const blocks = afterTitle.split(/(?:\n\s*-\s*\n|\n\s*\n+)/);

    const questions = [];
    for (let block of blocks){
      const lines = block.split(/\n/).map(s=>s.trim()).filter(Boolean);
      if (!lines.length) continue;
      let qText = lines.shift();
      qText = qText.replace(/^\d+\s*[\).:-]\s*/,"").trim();

      const choices = []; let explanation = "";
      for (let ln of lines){
        if (/^explain(ation)?:/i.test(ln)){ explanation = ln.replace(/^explain(ation)?:/i,"").trim(); continue; }
        const parsed = parseChoiceLine(ln);
        if (parsed){ choices.push({text:parsed.text, correct:parsed.correct}); continue; }
        const abcd = ln.match(/^[A-D]\)\s*(.+)$/i);
        if (abcd){ choices.push({text:abcd[1].trim(), correct:false}); }
      }
      if (choices.length===0 && /answer\s*:/i.test(block)){
        const opts = block.match(/^[A-D]\)\s*.+$/gim) || [];
        const ansM = block.match(/answer\s*:\s*([A-D,\s]+)/i);
        const letters = ansM ? ansM[1].toUpperCase().split(/[\s,]+/).filter(Boolean) : [];
        opts.forEach(line=>{
          const letter = line.trim()[0].toUpperCase();
          const txt = line.replace(/^[A-D]\)\s*/i,"");
          choices.push({text:txt, correct: letters.includes(letter)});
        });
      }
      if (!choices.length) continue;
      questions.push({ id: uid(), text:qText, choices, explanation });
    }
    if (!questions.length){ toast("No questions found"); return null; }

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
        d.innerHTML = '<input type="'+(multi?'checkbox':'radio')+'" disabled /> <div>'+ esc(c.text) + '</div>';
        el.appendChild(d);
      });
      if (q.explanation){ const ex=document.createElement('div'); ex.className='small'; ex.textContent="Explanation: "+q.explanation; el.appendChild(ex); }
      wrap.appendChild(el);
    });
  }

  function shuffle(arr){ const a = arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

  function startSessionFrom(quizObj, labelPrefix="Active"){ resetAttempts();
    const opts = quizObj.options || {};
    let questions = quizObj.questions.map(q=>({
      id:q.id, text:q.text, explanation:q.explanation||"",
      choices: (opts.shuffleChoices?shuffle(q.choices):q.choices).map(c=>({id:uid(), text:c.text, correct:c.correct}))
    }));
    if (opts.shuffleQuestions) questions = shuffle(questions);
    session = { quizId: quizObj.id, name: quizObj.name, options: opts, idx: 0, start: Date.now(), answers:{}, questions };
    const label = `${labelPrefix}: ${quizObj.name}`;
    $("#activeQuizLabel").textContent = label;
    if (activeQuizLabelMobile) activeQuizLabelMobile.textContent = label;
    renderQuestion(); switchTab('player');
  }
  function startSession(){ const q = quizzes.find(x=>x.id===activeId); if (!q){ toast("No quiz selected"); return; } startSessionFrom(q, "Active"); }

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
      input.onchange = ()=>{
        if (session.options.instantFeedback && !multi){
          const isCorrect = opt.correct;
          list.querySelectorAll('.opt').forEach(el=>el.classList.remove('correct','wrong'));
          row.classList.add(isCorrect?'correct':'wrong');
          session.answers[q.id] = { selectedIds:[opt.id], correct:isCorrect };
        }
      };
      const cap = document.createElement('div'); cap.textContent = opt.text;
      row.append(input,cap); list.appendChild(row);
    });
    card.appendChild(list);

    const checkBtn = document.createElement('button'); checkBtn.className='btn'; checkBtn.textContent = multi || !session.options.instantFeedback ? "Check answer" : "Change answer";
    checkBtn.onclick = ()=>{
      const chosen = Array.from(list.querySelectorAll('input')).filter(i=>i.checked).map(i=>i.parentElement.dataset.choiceId);
      if (!chosen.length){ toast("Select an option"); return; }
      const correctIds = q.choices.filter(c=>c.correct).map(c=>c.id);
      const isCorrect = chosen.length===correctIds.length && chosen.every(id=>correctIds.includes(id));
      session.answers[q.id] = { selectedIds: chosen, correct: isCorrect };
      list.querySelectorAll('.opt').forEach(el=>{
        const id = el.dataset.choiceId; el.classList.remove('correct','wrong');
        if (correctIds.includes(id)) el.classList.add('correct'); else if (chosen.includes(id)) el.classList.add('wrong');
      });
      const correctCt2 = Object.values(session.answers).filter(a=>a.correct).length;
      const attempted2 = Object.keys(session.answers).length;
      $("#scoreMeta").textContent = "Score: "+correctCt2+" / "+attempted2;
    };
    card.appendChild(checkBtn);
    container.appendChild(card);

    $("#prevBtn").onclick = ()=>{ if(session.idx>0){ session.idx--; renderQuestion(); } };
    $("#nextBtn").onclick = ()=>{ const q=session.questions[session.idx]; try{ recordAttemptFromDom(q); }catch(e){} if(session.idx<session.questions.length-1){ session.idx++; renderQuestion(); } };
    $("#finishBtn").onclick = ()=>{ const q=session.questions[session.idx]; try{ recordAttemptFromDom(q); }catch(e){} attemptsFinalized=true; renderMistakes(); showSummary(); switchTab("mistakes"); };
    $("#restartBtn").onclick = ()=>startSessionFrom({ ...session, questions: session.questions.map(q=>({text:q.text, explanation:q.explanation, choices: q.choices.map(c=>({text:c.text, correct:c.correct}))})), id: session.quizId, name: session.name, options: session.options }, "Active");
  }

  function showSummary(){
    const total = session.questions.length;
    const correctCt = Object.values(session.answers).filter(a=>a.correct).length;
    const acc = Math.round((correctCt/total)*100);
    const elapsed = Date.now()-session.start;
    const mins = Math.floor(elapsed/60000);
    const secs = Math.floor((elapsed%60000)/1000);
    const el = $("#summary"); el.classList.remove('hidden');
    el.innerHTML = `
      <div class="pill">Final score: <b style="margin-left:6px">${correctCt} / ${total}</b></div>
      <div class="pill">Accuracy: ${acc}%</div>
      <div class="pill">Time: ${mins}m ${secs}s</div>
    `;
  }

  // Copy Prompt button
  $("#copyPromptBtn").onclick = async ()=>{
    try{
      if (navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(GENERATION_PROMPT);
      } else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = GENERATION_PROMPT;
        document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast("Prompt copied to clipboard ✅");
    }catch(e){
      showError("Copy failed: " + e);
      toast("Copy failed");
    }
  };

  // Export helpers
  function downloadBlob(filename, text){
    const blob = new Blob([text], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }
  async function saveAsJSON(filename, dataObj){
    const text = JSON.stringify(dataObj, null, 2);
    if (window.showSaveFilePicker) {
      try{
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{description: 'JSON', accept: {'application/json':['.json']}}]
        });
        const stream = await handle.createWritable();
        await stream.write(new Blob([text], {type:'application/json'}));
        await stream.close();
        toast("Saved to chosen location");
        return;
      }catch(err){
        if (err && err.name !== 'AbortError') showError("Save As failed: " + err);
      }
    }
    downloadBlob(filename, text);
    toast("Downloaded JSON");
  }
  function exportSingleQuiz(q){ saveAsJSON((q.name.replace(/[^a-z0-9\-]+/gi,'_')||'quiz')+'.json', q); }
  function exportAllQuizzes(){ const payload = { exportedAt: new Date().toISOString(), quizzes }; saveAsJSON('quizzes_export.json', payload); }

  // Wire up
  $("#parseBtn").onclick = ()=>{
    const draft = parseRaw();
    if (draft){ parsedDraft = draft; renderPreview(draft); toast("Parsed "+draft.questions.length+" question(s)"); }
  };
  $("#testRunBtn").onclick = ()=>{
    const draft = parseRaw();
    if (!draft){ toast("Parse your text first"); return; }
    startSessionFrom(draft, "Testing (unsaved)");
  };
  $("#saveQuizBtn").onclick = ()=>{
    if (!parsedDraft){ toast("Parse your text first"); return; }
    const title = $("#quizName").value.trim() || parsedDraft.name;
    const normalized = norm(title);
    const editingSame = activeId && parsedDraft.id && activeId === parsedDraft.id;
    const existingByTitle = quizzes.find(q => norm(q.name) === normalized);

    if (!editingSame && existingByTitle){
      const ok = confirm(`A quiz named "${existingByTitle.name}" already exists.\n\nOverwrite it with your current content?`);
      if (!ok){ toast("Save canceled"); return; }
      const toSave = { id: existingByTitle.id, name: existingByTitle.name, options: parsedDraft.options, questions: parsedDraft.questions };
      quizzes = quizzes.map(q => q.id === existingByTitle.id ? toSave : q);
      activeId = existingByTitle.id;
      safeSave(quizzes); renderQuizList(); toast("Overwritten");
      return;
    }
    const existsById = parsedDraft.id && quizzes.find(q=>q.id===parsedDraft.id);
    const toSave = { id: existsById ? parsedDraft.id : uid(), name: title, options: parsedDraft.options, questions: parsedDraft.questions };
    if (existsById){ quizzes = quizzes.map(q=>q.id===toSave.id ? toSave : q); } else { quizzes.unshift(toSave); }
    activeId = toSave.id;
    safeSave(quizzes); renderQuizList(); toast(existsById ? "Saved (overwritten)" : "Saved");
  };
  $("#saveAsBtn").onclick = ()=>{
    let data = parsedDraft;
    let filenameBase = ($("#quizName").value.trim() || (parsedDraft?.name) || 'quiz');
    if (!data){
      const q = quizzes.find(x=>x.id===activeId);
      if (!q){ toast("Nothing to save — parse or select a quiz first"); return; }
      data = q; filenameBase = q.name;
    }
    saveAsJSON((filenameBase.replace(/[^a-z0-9\-]+/gi,'_')||'quiz')+'.json', data);
  };
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
    toast("Sample pasted — click Parse or Test Run");
  };

  $("#startSampleBtn").onclick = ()=>{
    if (!quizzes.length){ quizzes=[sampleQuiz()]; safeSave(quizzes); }
    activeId = quizzes[0].id; renderQuizList(); startSession();
  };
  $("#exportAllBtn").onclick = ()=>exportAllQuizzes();
  $("#clearAllBtn").onclick = ()=>{
    if (confirm("This will remove ALL saved quizzes on this device for this app. Continue?")){
      quizzes = []; activeId = null; safeSave(quizzes); renderQuizList();
      toast("All local data cleared");
    }
  };
  $$(".tab").forEach(t=>t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  $("#newQuizBtn").onclick = ()=>{ $("#quizName").value=""; $("#rawInput").value=""; $("#preview").innerHTML=""; parsedDraft=null; };
  $("#importJsonBtn").onclick = ()=>$("#importFile").click();
  $("#importFile").addEventListener('change', (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(reader.result);
        const arr = Array.isArray(obj)? obj : (obj.quizzes || [obj]);
        arr.forEach(q=>{
          q.id = q.id || uid();
          q.questions.forEach(qq=>{ qq.id = qq.id || uid(); qq.choices.forEach(c=>{ c.id = c.id || uid(); }); });
        });
        quizzes = arr.concat(quizzes);
        safeSave(quizzes); renderQuizList(); toast("Imported "+arr.length+" quiz(es)");
      }catch(err){ showError("Invalid JSON: "+err); toast("Invalid JSON"); }
    };
    reader.readAsText(f); e.target.value = "";
  });

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
        ]},
        { id: uid(), text: "Amlodipine belongs to which class?", choices:[
          {text:"ACE inhibitor", correct:false},
          {text:"ARB", correct:false},
          {text:"Calcium channel blocker", correct:true},
          {text:"Beta-blocker", correct:false}
        ]},
        { id: uid(), text: "True or False: Warfarin directly inhibits thrombin.", explanation:"Warfarin inhibits vitamin K epoxide reductase; it does not directly inhibit thrombin.", choices:[
          {text:"True", correct:false},
          {text:"False", correct:true}
        ]}
      ]
    };
  }

  if (!quizzes.length){ quizzes=[sampleQuiz()]; safeSave(quizzes); }
  renderQuizList();
});

  // ===== Attempts tracking (current quiz) =====
  let attemptsCurrent = [];
  let attemptsFinalized = false;
  let showIncorrectOnly = true; // default filter

  function resetAttempts(){ attemptsCurrent=[]; attemptsFinalized=false; }

  function recordAttemptFromDom(q){
    const chosen = Array.from(document.querySelectorAll('#questionView input'))
      .filter(i=>i.checked).map(i=>i.parentElement.dataset.choiceId);
    const correctIds = q.choices.filter(c=>c.correct).map(c=>c.id);
    const isCorrect = chosen.length===correctIds.length && chosen.every(id=>correctIds.includes(id));
    const entry = {
      id: uid(), at: new Date().toISOString(),
      quizId: session.quizId, quizName: session.name,
      question: q.text,
      choices: q.choices.map(c=>({ id:c.id, text:c.text, correct:c.correct })),
      chosen, correct: isCorrect
    };
    const i = attemptsCurrent.findIndex(a=>a.question===q.text);
    if (i>=0) attemptsCurrent[i]=entry; else attemptsCurrent.push(entry);
  }

  function renderMistakes(){
    const list = $("#mistakeList"); if (!list) return;
    list.innerHTML = "";
    if (!attemptsFinalized){ list.innerHTML = "<div class='small'>Finish the quiz to review answers.</div>"; return; }
    const source = showIncorrectOnly ? attemptsCurrent.filter(a=>!a.correct) : attemptsCurrent;
    if (!source.length){ list.innerHTML = "<div class='small'>No entries to show.</div>"; return; }
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
        const row = document.createElement('div'); row.className='opt';
        const isChosen = m.chosen.includes(c.id);
        row.classList.toggle('correct', c.correct);
        row.classList.toggle('wrong', isChosen && !c.correct);
        row.classList.toggle('selected', isChosen);
        row.innerHTML = `<input type="checkbox" ${isChosen?'checked':''} disabled /> <div>${c.correct ? '✅ ' : (isChosen ? '❌ ' : '')}${esc(c.text)}</div>`;
        card.appendChild(row);
      });
      list.appendChild(card);
    });
  }

  document.addEventListener('click', (e)=>{
    if (!e.target) return;
    if (e.target.id==='filterIncorrect'){ showIncorrectOnly=true; e.target.classList.add('active'); const other=$("#filterAllAnswers"); if(other) other.classList.remove('active'); renderMistakes(); }
    if (e.target.id==='filterAllAnswers'){ showIncorrectOnly=false; e.target.classList.add('active'); const other=$("#filterIncorrect"); if(other) other.classList.remove('active'); renderMistakes(); }
  });

  // ===== Flashcards =====
  let flashcards = [];
  function genFlashcards(){
    if (!session || !session.questions){ return; }
    flashcards = session.questions.map((q, idx)=>{
      const correct = q.choices.filter(c=>c.correct).map(c=>c.text);
      return { id: uid(), i: idx+1, front: q.text, back: correct.join('\n') || '(No correct marked)' };
    });
    renderFlashcards();
    switchTab('flashcards');
  }
  function renderFlashcards(){
    const list = $("#flashcardsList"); if (!list) return;
    list.innerHTML = "";
    if (!flashcards.length){ list.innerHTML = "<div class='small'>No flashcards yet. Generate from active quiz.</div>"; return; }
    flashcards.forEach(fc=>{
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `<div class="small pill">#${fc.i}</div>
        <div class="question" style="margin-top:6px">${esc(fc.front)}</div>
        <div style="margin-top:6px"><b>Back:</b><br>${esc(fc.back)}</div>`;
      list.appendChild(card);
    });
  }
  $("#genFlashcardsBtn") && ($("#genFlashcardsBtn").onclick = ()=>genFlashcards());
  $("#exportFlashcardsBtn") && ($("#exportFlashcardsBtn").onclick = ()=>{
    if (!flashcards.length){ alert('No flashcards'); return; }
    const payload = { exportedAt: new Date().toISOString(), flashcards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='flashcards.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  });
