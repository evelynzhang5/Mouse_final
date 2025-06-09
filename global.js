// ──────────────────────────────────────────────────────────────────────────
// • 16 racers, 4-day race, live avg-temperature bar chart
// ──────────────────────────────────────────────────────────────────────────

/* ---------- DOM references ---------- */
const raceWrapper   = document.getElementById("race-wrapper");
const raceContainer = document.getElementById("race-container");
const pauseBtn      = document.getElementById("pause-button");
const femaleOL      = document.querySelector("#female-leaderboard ol");
const maleOL        = document.querySelector("#male-leaderboard ol");
const ovWrapper     = document.getElementById("ovulation-wrapper");
const ovTimeline    = document.getElementById("ovulation-timeline");
const splashModal   = document.getElementById("splash-modal");
const modalStart    = document.getElementById("modal-start");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownText    = document.getElementById("countdown-text");
const tempCanvas       = document.getElementById("temp-chart");
const resetBtn        = document.getElementById("reset-button");
const prevPopupBtn    = document.getElementById("prev-popup-button");
const nextPopupBtn    = document.getElementById("next-popup-button");
const progressTextEl = document.getElementById("progress-text");
/* ---------- data structures ---------- */
const dataMap = {};
let femaleIDs=[], maleIDs=[];
let racers=[], laneLines=[];

/* ---------- constants ---------- */
const MINUTES_PER_DAY      = 1440;
const CHOSEN_TOTAL_MINUTES = 4 * MINUTES_PER_DAY;   // 5 760
const SIM_MINUTES_PER_TICK = 1;

const DAY_RUNTIME_SEC  = 40;
const TICK_INTERVAL_MS = DAY_RUNTIME_SEC * 1000 / MINUTES_PER_DAY;

const SPEED_SCALE    = 0.65;
const PIXELS_PER_MIN = 0.1 * SPEED_SCALE * (DAY_RUNTIME_SEC / 72);

/* pop-up schedule (sim-minutes) */
const PROESTRUS_POPUP_MIN   =  360;  //  6 h
const ESTRUS_POPUP_MIN      = 2160;  // 12 h into day 2
const OBSERVATION_POPUP_MIN = 2880;  // start of day 3
const METESTRUS_POPUP_MIN   = 3600;  //  6 h into day 3
const DIESTRUS_POPUP_MIN    = 5040;  // 12 h into day 4

/* pop-up flags */
let proestrusPopupShown=false, estrusPopupShown=false,
    observationPopupShown=false, metestrusPopupShown=false,
    diestrusPopupShown=false;

/* run-state */
let timeTick=0, raceTimer=null, isRunning=false, lightsOffHandled=false,
    currentTrackWidth=0;

/* Chart.js */
let tempCtx=null, tempChart=null;

/* Pop ups messages */
const manualPopups = [
  {
    title: "🌸 Proestrus Phase 🌸",
    body: "The estrous cycle is four phases repeating every 4–5 days. <strong>Proestrus</strong> (≈12 h) is the follicle-growth phase."
  },
  {
    title: "🔥 Estrus Phase 🔥",
    body: "Peak fertility: female mice become <em>much more active</em> during Estrus!"
  },
  {
    title: "👀 Observation 👀",
    body: "By now you’ve likely noticed that female mice move less overall—except during Estrus, when they surge in activity. This pattern reflects natural-selection pressures."
  },
  {
    title: "🌗 Metestrus Phase 🌗",
    body: "Hormone levels fall; activity tapers as the cycle moves toward Diestrus."
  },
  {
    title: "🌙 Diestrus Phase 🌙",
    body: "Final low-activity stage before the cycle restarts."
  }
];
let currentManualPopupIndex = -1;

/* — cumulative distances for replay slider — */
const cumulativeDistances = {};


/* ──────────────────────────────────────────────────────────────────────────
   1) LOAD CSVs
   ────────────────────────────────────────────────────────────────────────── */
Promise.all([
  d3.csv("data/Mouse_Fem_Act.csv"),
  d3.csv("data/Mouse_Fem_Temp.csv"),
  d3.csv("data/Mouse_Male_Act.csv"),
  d3.csv("data/Mouse_Male_Temp.csv")
]).then(([fAct,fTemp,mAct,mTemp])=>{
  buildData(fAct,fTemp,true);
  buildData(mAct,mTemp,false);
  setupDefaultRace();
  buildOvulationTimeline();
  updateOvulationScroll(0);
  updateLights();
  Object.keys(dataMap).forEach(id => {
      let sum = 0;
      cumulativeDistances[id] = dataMap[id].map(p => {
        sum += p.activity * PIXELS_PER_MIN * SIM_MINUTES_PER_TICK;
        return sum;
      });
  });
  modalStart.disabled=false;
});

/* ------------------------------------------------------------------ */
/* 2) buildData                                                       */
/* ------------------------------------------------------------------ */
function buildData(actCSV,tempCSV,isFemale){
  const n=actCSV.length;
  const ids=Object.keys(actCSV[0]);
  (isFemale?femaleIDs:maleIDs).push(...ids);

  ids.forEach(id=>{if(!dataMap[id])dataMap[id]=new Array(n);});

  actCSV.forEach((row,i)=>{
    ids.forEach(id=>{
      dataMap[id][i]={minute:i,activity:+row[id],temperature:null};
    });
  });
  tempCSV.forEach((row,i)=>{
    ids.forEach(id=>{
      dataMap[id][i].temperature=+row[id];
    });
  });
}

/* ------------------------------------------------------------------ */
/* 3) choose racers                                                   */
/* ------------------------------------------------------------------ */
function setupDefaultRace(){
  const ids=[...femaleIDs.slice(0,8),...maleIDs.slice(0,8)];
  racers=ids.map(id=>({id,el:null,xPos:0,minuteIdx:0}));
}

/* ------------------------------------------------------------------ */
/* 4) ovulation timeline                                              */
/* ------------------------------------------------------------------ */
function buildOvulationTimeline(){
  const PHASES=["Proestrus","Estrus","Metestrus","Diestrus"];
  ovTimeline.innerHTML="";
  ovWrapper.querySelector("#ovulation-labels")?.remove();

  for(let d=0;d<4;d++){
    const bar=document.createElement("div");
    bar.className="ov-day phase-"+PHASES[d].toLowerCase();
    ovTimeline.appendChild(bar);
  }
  for(let i=1;i<8;i++){
    const tick=document.createElement("div");
    tick.className="ov-tick";
    tick.style.left=`${i*12.5}%`;
    ovTimeline.appendChild(tick);
  }
  const lblRow=document.createElement("div"); lblRow.id="ovulation-labels";
  PHASES.forEach(ph=>{
    const lbl=document.createElement("div");
    lbl.className="ov-label"; lbl.textContent=ph; lblRow.appendChild(lbl);
  });
  ovWrapper.appendChild(lblRow);
}

/* ------------------------------------------------------------------ */
/* 5) splash ▶️ → countdown → beginRace                               */
/* ------------------------------------------------------------------ */
modalStart.addEventListener("click",()=>{
  if(modalStart.disabled) return;
  splashModal.style.display="none";
  countdownOverlay.classList.remove("hidden");
  runCountdown(3).then(()=>{
    countdownOverlay.classList.add("hidden");
    beginRace();
  });
});
function runCountdown(n){
  let c=n; countdownText.textContent=c;
  return new Promise(res=>{
    const int=setInterval(()=>{
      c--; countdownText.textContent=c>0?c:c===0?"GO!":"";
      if(c<0){clearInterval(int);res();}
    },1000);
  });
}

/* ------------------------------------------------------------------ */
/* 6) pause / resume                                                  */
/* ------------------------------------------------------------------ */
pauseBtn.addEventListener("click",()=>{
  if(isRunning){
    clearInterval(raceTimer); isRunning=false; pauseBtn.textContent="▶️ Resume";
  }else{
    raceTimer=setInterval(raceStep,TICK_INTERVAL_MS); isRunning=true;
    pauseBtn.textContent="⏸ Pause";
  }
});

/* ------------------------------------------------------------------ */
/* 7) beginRace                                                       */
/* ------------------------------------------------------------------ */
function beginRace(){
  /* canvas ctx & chart */
  if(!tempCtx) tempCtx=tempCanvas.getContext("2d");
  if(tempChart) tempChart.destroy();
  tempChart=new Chart(tempCtx,{
    type:'bar',
    data:{
      labels:['Female','Male'],
      datasets:[{
        backgroundColor:['#ff9ccd','#7ec6ff'],  // night shades
        borderWidth:0,
        data:[36,36]
      }]
    },
    options:{
      animation:false,
      scales:{y:{min:30,max:40,title:{display:true,text:'°C'}}},
      plugins:{legend:{display:false}}
    }
  });

  /* reset flags/state */
  timeTick = 0;
  proestrusPopupShown = estrusPopupShown =
  observationPopupShown = metestrusPopupShown = diestrusPopupShown = false;
  lightsOffHandled = false;
  currentManualPopupIndex = -1;

  racers.forEach(r=>{r.xPos=0;r.minuteIdx=0;});
  femaleOL.innerHTML=""; maleOL.innerHTML="";

  setupRacers();
  document.getElementById("timeline-progress").style.width="0%";
  updateOvulationScroll(0);
  updateLights();

  // enable controls
  pauseBtn.disabled       = false;
  resetBtn.disabled       = false;
  prevPopupBtn.disabled   = true;   // none shown yet
  nextPopupBtn.disabled   = false;
  pauseBtn.textContent    = "⏸ Pause";

  // attach listeners (only once)
  resetBtn.onclick = resetRace;
  prevPopupBtn.onclick = ()=> showManualPopup(currentManualPopupIndex - 1);
  nextPopupBtn.onclick = ()=> {
    if (currentManualPopupIndex < manualPopups.length - 1) {
      showManualPopup(currentManualPopupIndex + 1);
    } else {
      // last phase → compute and show finish
      const sorted = racers.slice().sort((a,b) => b.xPos - a.xPos);
      showFinishPopup(sorted);
    }
  };
  // start
  isRunning = true;
  raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
}
function resetRace(){
  clearInterval(raceTimer);
  isRunning = false;
  pauseBtn.disabled         = true;
  resetBtn.disabled         = true;
  prevPopupBtn.disabled     = true;
  nextPopupBtn.disabled     = true;

  // hide overlays
  countdownOverlay.classList.add("hidden");
  document.getElementById("message-overlay")?.classList.add("hidden");

  splashModal.style.display = "flex";
}
/* ------------------------------------------------------------------ */
/* manual pop-up navigator                                          */
/* ------------------------------------------------------------------ */
function showManualPopup(idx) {
  if (idx < 0 || idx >= manualPopups.length) return;

  // ─── mark this phase so auto‐triggers never fire again ───
  switch (idx) {
    case 0: proestrusPopupShown = true; break;
    case 1: estrusPopupShown    = true; break;
    case 2: observationPopupShown = true; break;
    case 3: metestrusPopupShown = true; break;
    case 4: diestrusPopupShown  = true; break;
  }

  currentManualPopupIndex = idx;

  // 1) Pause & scrub to this phase
  clearInterval(raceTimer);
  isRunning = false;
  const phaseTimes = [
    PROESTRUS_POPUP_MIN,
    ESTRUS_POPUP_MIN,
    OBSERVATION_POPUP_MIN,
    METESTRUS_POPUP_MIN,
    DIESTRUS_POPUP_MIN
  ];
  updateRaceTo(phaseTimes[idx]);

  // 2) Top‐bar nav buttons
  prevPopupBtn.disabled = (idx === 0);
  nextPopupBtn.disabled = false;
  resetBtn.disabled     = false;
  nextPopupBtn.onclick  = () => {
    if (idx < manualPopups.length - 1) {
      showManualPopup(idx + 1);
    } else {
      const sorted = racers.slice().sort((a, b) => b.xPos - a.xPos);
      showFinishPopup(sorted);
    }
  };

  // 3) Build & show the overlay
  const { title, body } = manualPopups[idx];
  let o = document.getElementById("message-overlay");
  if (!o) {
    o = document.createElement("div");
    o.id = "message-overlay";
    document.body.appendChild(o);
  }
  o.innerHTML = `
    <h2>${title}</h2>
    <p>${body}</p>
    <div class="overlay-buttons">
      <button id="overlay-prev" ${idx === 0 ? "disabled" : ""}>◀️ Prev</button>
      <button id="overlay-close">✖️ Close</button>
      <button id="overlay-next">▶️ Next</button>
    </div>
  `;
  o.classList.remove("hidden");

  // 4) Overlay controls
  document.getElementById("overlay-prev").onclick = () =>
    showManualPopup(idx - 1);

  document.getElementById("overlay-close").onclick = () => {
    o.classList.add("hidden");
    raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
    isRunning = true;
    pauseBtn.disabled = false;
    pauseBtn.textContent = "⏸ Pause";
  };

  document.getElementById("overlay-next").onclick = () => {
    o.classList.add("hidden");
    if (idx < manualPopups.length - 1) {
      showManualPopup(idx + 1);
    } else {
      const sorted = racers.slice().sort((a, b) => b.xPos - a.xPos);
      showFinishPopup(sorted);
    }
  };
}


/* ------------------------------------------------------------------ */
/* 8) build track lines & sprites                                     */
/* ------------------------------------------------------------------ */
function setupRacers(){
  clearTrack(); laneLines=[];
  const lanes=racers.length;
  const spacing=raceContainer.clientHeight/(lanes+1);
  const totalW=400+200*lanes;
  raceContainer.style.width=`${totalW}px`;
  currentTrackWidth=totalW;

  racers.forEach((r,idx)=>{
    const y=spacing*(idx+1);

    /* lane line */
    const line=document.createElement("div");
    line.className="racer-track "+(r.id.startsWith("f")?"female-track":"male-track");
    line.style.bottom=`${y}px`;
    line.style.width=`${totalW}px`;
    raceContainer.appendChild(line);
    laneLines.push(line);

    /* sprite & label */
    const wrap=document.createElement("div");
    wrap.className="racer";
    wrap.style.bottom=`${y-17}px`;
    wrap.style.left="0px";

    const vid=document.createElement("video");
    vid.className="mouse-sprite";
    vid.src="data/mouse.mp4";
    vid.autoplay=true; vid.loop=true; vid.muted=true; vid.playsInline=true;

    const lbl=document.createElement("div");
    lbl.className="racer-label"; lbl.textContent=r.id;

    wrap.append(vid,lbl); raceContainer.appendChild(wrap); r.el=wrap;

    /* tooltip */
    tippy(vid,{
      content:"", allowHTML:true, placement:"top",
      onShow(inst){
        const s=dataMap[r.id];
        const i=Math.min(Math.floor(r.minuteIdx),s.length-1);
        const {activity,temperature,minute}=s[i];
        inst.setContent(
          `<strong>ID:</strong> ${r.id}<br>`+
          `<strong>Minute:</strong> ${minute}<br>`+
          `<strong>Act:</strong> ${activity.toFixed(2)}<br>`+
          `<strong>Temp:</strong> ${temperature.toFixed(2)} °C`);
      }
    });
  });
}
function clearTrack(){
  racers.forEach(r=>r.el&&raceContainer.removeChild(r.el));
  raceContainer.querySelectorAll(".racer-track").forEach(e=>e.remove());
}

/* ------------------------------------------------------------------ */
/* 9) main loop                                                       */
/* ------------------------------------------------------------------ */
function ensureTrackWidth(minX){
  if(minX<=currentTrackWidth) return;
  currentTrackWidth=Math.ceil(minX+200);
  raceContainer.style.width=`${currentTrackWidth}px`;
  laneLines.forEach(l=>{l.style.width=`${currentTrackWidth}px`;});
}

function raceStep(){
  /* move each mouse one simulated minute --------------------------- */
  racers.forEach(r=>{
    if(r.minuteIdx>=CHOSEN_TOTAL_MINUTES) return;
    const idx=Math.floor(r.minuteIdx);
    const p=dataMap[r.id][idx]; if(!p) return;
    const v=p.activity*PIXELS_PER_MIN;
    r.xPos+=v*SIM_MINUTES_PER_TICK;
    r.minuteIdx+=SIM_MINUTES_PER_TICK;
    anime({targets:r.el,left:`${r.xPos}px`,duration:45,easing:"linear"});
  });
  timeTick+=SIM_MINUTES_PER_TICK;
  //update time text
  progressTextEl.textContent =
  `Progress: ${timeTick} / ${CHOSEN_TOTAL_MINUTES} min`;

  /* update lights, progress bar, ovulation scroll ------------------ */
  updateLights();
  document.getElementById("timeline-progress").style.width=
      `${Math.min(timeTick/CHOSEN_TOTAL_MINUTES*100,100)}%`;
  updateOvulationScroll(timeTick);

  /* live rankings --------------------------------------------------- */
  const sorted = racers.slice().sort((a,b)=>b.xPos-a.xPos);
  femaleOL.innerHTML=""; maleOL.innerHTML="";
  sorted.forEach(r=>{
    const li=document.createElement("li"); li.textContent=r.id;
    (femaleIDs.includes(r.id)?femaleOL:maleOL).appendChild(li);
  });

  /* auto-scroll view ------------------------------------------------ */
  raceWrapper.scrollLeft = 0;

  // still grow the track width so nobody ever gets cut off
  const avgX = racers.reduce((sum, r) => sum + r.xPos, 0) / racers.length;
  raceWrapper.scrollLeft = Math.max(0, avgX - raceWrapper.clientWidth / 2);
  ensureTrackWidth(avgX + raceWrapper.clientWidth);

  /* ---- live average-temperature bars ----------------------------- */
  const mIndex=Math.min(Math.floor(timeTick),dataMap[femaleIDs[0]].length-1);
  const femTemps=femaleIDs.map(id=>dataMap[id][mIndex].temperature).filter(v=>!isNaN(v));
  const maleTemps=maleIDs.map(id=>dataMap[id][mIndex].temperature).filter(v=>!isNaN(v));
  tempChart.data.datasets[0].data=[
    femTemps.reduce((s,v)=>s+v,0)/femTemps.length,
    maleTemps.reduce((s,v)=>s+v,0)/maleTemps.length
  ];
  tempChart.update('none');
  if (!proestrusPopupShown && timeTick >= PROESTRUS_POPUP_MIN) {
    proestrusPopupShown = true;
    currentManualPopupIndex = 0;
    showManualPopup(0);
    return;
  }
  if (!estrusPopupShown && timeTick >= ESTRUS_POPUP_MIN) {
    estrusPopupShown = true;
    currentManualPopupIndex = 1;
    showManualPopup(1);
    return;
  }
  if (!observationPopupShown && timeTick >= OBSERVATION_POPUP_MIN) {
    observationPopupShown = true;
    currentManualPopupIndex = 2;
    showManualPopup(2);
    return;
  }
  if (!metestrusPopupShown && timeTick >= METESTRUS_POPUP_MIN) {
    metestrusPopupShown = true;
    currentManualPopupIndex = 3;
    showManualPopup(3);
    return;
  }
  if (!diestrusPopupShown && timeTick >= DIESTRUS_POPUP_MIN) {
    diestrusPopupShown = true;
    currentManualPopupIndex = 4;
    showManualPopup(4);
    return;
  }
  /* finish flag ----------------------------------------------------- */
  if(timeTick>=CHOSEN_TOTAL_MINUTES){
    clearInterval(raceTimer); isRunning=false; pauseBtn.disabled=true;
    showFinishPopup(sorted);
  }
}

/* ------------------------------------------------------------------ */
/* 10) pop-up helpers                                                 */
/* ------------------------------------------------------------------ */
function showPopup(title,body){
  clearInterval(raceTimer); isRunning=false; pauseBtn.disabled=true;
  let o=document.getElementById("message-overlay");
  if(!o){o=document.createElement("div");o.id="message-overlay";document.body.appendChild(o);}
  o.innerHTML=`<h2>${title}</h2><p>${body}<br><br><strong>Click anywhere to continue.</strong></p>`;
  o.classList.remove("hidden");
  const resume=()=>{
    o.classList.add("hidden");document.removeEventListener("click",resume);
    raceTimer=setInterval(raceStep,TICK_INTERVAL_MS); isRunning=true; pauseBtn.disabled=false;
  };
  setTimeout(()=>document.addEventListener("click",resume),500);
}
function showFinishPopup(sorted) {
  const females = sorted
    .filter(r => femaleIDs.includes(r.id))
    .map(r => r.id);
  const males = sorted
    .filter(r => maleIDs.includes(r.id))
    .map(r => r.id);

  let o = document.getElementById("message-overlay");
  if (!o) {
    o = document.createElement("div");
    o.id = "message-overlay";
    document.body.appendChild(o);
  }

  o.innerHTML = `
    <h2>🎉 Finished! 🎉</h2>
    <p>Thank you for taking the time to go through this visual; here are the final rankings:</p>
    <div style="display:flex; gap:2em; justify-content:center; margin-top:1.2em">
      <div>
        <h3>Female</h3>
        <ol>${females.map(id => `<li>${id}</li>`).join("")}</ol>
      </div>
      <div>
        <h3>Male</h3>
        <ol>${males.map(id => `<li>${id}</li>`).join("")}</ol>
      </div>
    </div>
    <div class="overlay-buttons" style="margin-top:1em; text-align:center">
      <button id="overlay-prev">◀️ Prev</button>
      <button id="overlay-close">✖️ Close</button>
      <button id="overlay-next" disabled>▶️ Next</button>
      <button id="overlay-restart">🔄 Restart</button>
    </div>
  `;
  o.classList.remove("hidden");

  // Prev → go back to the last phase popup
  document.getElementById("overlay-prev").onclick = () => {
    currentManualPopupIndex = manualPopups.length - 1;
    showManualPopup(currentManualPopupIndex);
  };

  // Close → just hide the overlay
  document.getElementById("overlay-close").onclick = () => {
    o.classList.add("hidden");
  };

  // Next is disabled—no handler

  // Restart → reset everything back to the splash screen
  document.getElementById("overlay-restart").onclick = () => {
    o.classList.add("hidden");
    resetRace();
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   replay helper: jump-to–timeTick, updates everything
   ────────────────────────────────────────────────────────────────────────── */
   function updateRaceTo(minIdx){
    clearInterval(raceTimer);
    isRunning = false;
    pauseBtn.disabled = true;
    timeTick = minIdx;
    progressTextEl.textContent =
    `Progress: ${timeTick} / ${CHOSEN_TOTAL_MINUTES} min`;
    // update timeline & scroll
    document.getElementById("timeline-progress").style.width =
      `${Math.min(timeTick/CHOSEN_TOTAL_MINUTES*100,100)}%`;
    updateOvulationScroll(timeTick);
  
    // update temperature chart
    const mIndex = Math.min(Math.floor(timeTick), dataMap[femaleIDs[0]].length - 1);
    const femTemps = femaleIDs.map(id=>dataMap[id][mIndex].temperature).filter(v=>!isNaN(v));
    const maleTemps = maleIDs.map(id=>dataMap[id][mIndex].temperature).filter(v=>!isNaN(v));
    tempChart.data.datasets[0].data = [
      femTemps.reduce((s,v)=>s+v,0)/femTemps.length,
      maleTemps.reduce((s,v)=>s+v,0)/maleTemps.length
    ];
    tempChart.update("none");
  
    // update each racer’s position
    racers.forEach(r=>{
      const idx = Math.min(Math.floor(minIdx), cumulativeDistances[r.id].length - 1);
      r.minuteIdx = idx;
      r.xPos      = cumulativeDistances[r.id][idx];
      r.el.style.left = `${r.xPos}px`;
    });
    // update leaderboards
    const sorted = racers.slice().sort((a,b)=>b.xPos - a.xPos);
    femaleOL.innerHTML=""; maleOL.innerHTML="";
    sorted.forEach(r=>{
      const li = document.createElement("li");
      li.textContent = r.id;
      (femaleIDs.includes(r.id) ? femaleOL : maleOL).appendChild(li);
    });
    // update lights on/off
    updateLights();

      // auto-scroll to center the pack
      raceWrapper.scrollLeft = 0;

      // still grow the track width so nobody ever gets cut off
      const avgX = racers.reduce((sum, r) => sum + r.xPos, 0) / racers.length;
      raceWrapper.scrollLeft = Math.max(0, avgX - raceWrapper.clientWidth / 2);
      ensureTrackWidth(avgX + raceWrapper.clientWidth);
  }
/* ------------------------------------------------------------------ */
/* 11) ovulation scroll                                               */
/* ------------------------------------------------------------------ */
function updateOvulationScroll(minIdx){
  const total=ovTimeline.scrollWidth-ovWrapper.clientWidth;
  ovWrapper.scrollLeft=Math.min(minIdx/CHOSEN_TOTAL_MINUTES*total,total);
}

/* ------------------------------------------------------------------ */
/* 12) lights toggle (also flip bar-colours)                          */
/* ------------------------------------------------------------------ */
function updateLights(){
  const day=Math.floor(timeTick/720)%2; /* 0 night, 1 day */
  if(day===1){  /* lights ON */
    document.body.classList.add("lights-off");
    if(tempChart){
      tempChart.data.datasets[0].backgroundColor=['#b20d5f','#005b96']; // dark shades
      tempChart.update('none');
    }
    if(!lightsOffHandled){
      lightsOffHandled=true;
      showPopup("🐭 Mouse activity slows during sleep 💤",
                "Mice are nocturnal, so their activity drops while the lights are on.");
    }
  }else{        /* night */
    document.body.classList.remove("lights-off");
    if(tempChart){
      tempChart.data.datasets[0].backgroundColor=['#ff9ccd','#7ec6ff']; // light shades
      tempChart.update('none');
    }
  }
}
