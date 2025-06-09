

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
const barCanvas  = document.getElementById("bar-chart");
const lineCanvas = document.getElementById("line-chart");

const nextBtn = document.getElementById("next-popup");
const backBtn = document.getElementById("back-popup");

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

let popupIndex = -1;
const popupPhases = [
  { min: PROESTRUS_POPUP_MIN, shown: () => proestrusPopupShown, set: v => proestrusPopupShown = v,
    title: "🌸 Proestrus Phase 🌸",
    body: "The estrous cycle is four phases repeating every 4–5 days. <strong>Proestrus</strong> (≈12 h) is the follicle-growth phase." },

  { min: ESTRUS_POPUP_MIN, shown: () => estrusPopupShown, set: v => estrusPopupShown = v,
    title: "🔥 Estrus Phase 🔥",
    body: "Peak fertility: female mice become <em>much more active</em> during Estrus!" },

  { min: OBSERVATION_POPUP_MIN, shown: () => observationPopupShown, set: v => observationPopupShown = v,
    title: "👀 Observation 👀",
    body: "By now you’ve likely noticed that female mice move less overall—except during Estrus, when they surge in activity. This pattern reflects natural-selection pressures." },

  { min: METESTRUS_POPUP_MIN, shown: () => metestrusPopupShown, set: v => metestrusPopupShown = v,
    title: "🌗 Metestrus Phase 🌗",
    body: "Hormone levels fall; activity tapers as the cycle moves toward Diestrus." },

  { min: DIESTRUS_POPUP_MIN, shown: () => diestrusPopupShown, set: v => diestrusPopupShown = v,
    title: "🌙 Diestrus Phase 🌙",
    body: "Final low-activity stage before the cycle restarts." }
];

/* run-state */
let timeTick=0, raceTimer=null, isRunning=false, lightsOffHandled=false,
    currentTrackWidth=0;

let userPaused = false;


/* Chart.js */
let tempCtx=null, tempChart=null;
let barChart = null;
let lineChart = null;

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
  modalStart.disabled=false;
});

/* popup controls */
nextBtn.addEventListener("click", () => {
  if (popupIndex < popupPhases.length - 1) {
    popupIndex++;
    jumpToPhase(popupIndex);
  }
});

backBtn.addEventListener("click", () => {
  if (popupIndex > 0) {
    popupIndex--;
    jumpToPhase(popupIndex);
  }
});

function jumpToPhase(index) {
  const phase = popupPhases[index];
  timeTick = phase.min;

  // Reset all runners to correct position at that time
  racers.forEach(r => {
    const s = dataMap[r.id];
    r.minuteIdx = timeTick;
    r.xPos = 0;
    for (let i = 0; i < timeTick; i++) {
      const p = s[i];
      if (!p) break;
      r.xPos += p.activity * PIXELS_PER_MIN * SIM_MINUTES_PER_TICK;
    }
    r.el.style.left = `${r.xPos}px`;
  });

  // Mark popup as shown and display it
  phase.set(true);
  showPopup(phase.title, phase.body);

  // Update UI elements
  updateLights();
  updateOvulationScroll(timeTick);
  document.getElementById("timeline-progress").style.width =
    `${Math.min(timeTick / CHOSEN_TOTAL_MINUTES * 100, 100)}%`;

  // Update leaderboard
  const sorted = racers.slice().sort((a, b) => b.xPos - a.xPos);
  femaleOL.innerHTML = "";
  maleOL.innerHTML = "";
  sorted.forEach(r => {
    const li = document.createElement("li");
    li.textContent = r.id;
    (femaleIDs.includes(r.id) ? femaleOL : maleOL).appendChild(li);
  });

  // Update temperature chart
  const mIndex = Math.min(Math.floor(timeTick), dataMap[femaleIDs[0]].length - 1);
  const femTemps = femaleIDs.map(id => dataMap[id][mIndex].temperature).filter(v => !isNaN(v));
  const maleTemps = maleIDs.map(id => dataMap[id][mIndex].temperature).filter(v => !isNaN(v));
  tempChart.data.datasets[0].data = [
    femTemps.reduce((s, v) => s + v, 0) / femTemps.length,
    maleTemps.reduce((s, v) => s + v, 0) / maleTemps.length
  ];
  tempChart.update('none');
}

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
  if(modalStart.disabled)return;
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
pauseBtn.addEventListener("click", () => {
  pauseBtn.disabled = false; // ensure it's always clickable

  if (isRunning) {
    clearInterval(raceTimer);
    isRunning = false;
    userPaused = true;
    pauseBtn.textContent = "▶️ Resume";
  } else {
    raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
    isRunning = true;
    userPaused = false;
    pauseBtn.textContent = "⏸ Pause";
  }
});

/* ------------------------------------------------------------------ */
/* 7) beginRace                                                       */
/* ------------------------------------------------------------------ */
function beginRace(){

  const barCtx  = document.getElementById("bar-chart").getContext("2d");
const lineCtx = document.getElementById("line-chart").getContext("2d");

if (barChart) barChart.destroy();
if (lineChart) lineChart.destroy();

barChart = new Chart(barCtx, {
  type: 'bar',
  data: {
    labels: ['Female', 'Male'],
    datasets: [{
      label: 'Avg Temp (Bar)',
      backgroundColor: ['#ff9ccd', '#7ec6ff'],
      data: [36, 36],
    }]
  },
  options: {
    animation: false,
    scales: { y: { min: 30, max: 40, title: { display: true, text: '°C' } } },
    plugins: { legend: { display: false } }
  }
});

lineChart = new Chart(lineCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Female Avg Temp',
        data: [],
        borderColor: '#ff80c0',
        fill: false,
        tension: 0.2
      },
      {
        label: 'Male Avg Temp',
        data: [],
        borderColor: '#7ec6ff',
        fill: false,
        tension: 0.2
      }
    ]
  },
  options: {
    animation: false,
    scales: {
      y: {
        min: 30,
        max: 40,
        title: { display: true, text: 'Temperature (°C)' }
      },
      x: {
        title: { display: true, text: 'Minute' }
      }
    }
  }
});



  /* reset flags/state */
  timeTick=0;
  proestrusPopupShown=estrusPopupShown=
  observationPopupShown=metestrusPopupShown=diestrusPopupShown=false;
  lightsOffHandled=false;

  racers.forEach(r=>{r.xPos=0;r.minuteIdx=0;});
  femaleOL.innerHTML=""; maleOL.innerHTML="";
  setupRacers();
  document.getElementById("timeline-progress").style.width="0%";
  updateOvulationScroll(0); updateLights();
  pauseBtn.disabled=false; pauseBtn.textContent="⏸ Pause";
  document.getElementById("message-overlay")?.classList.add("hidden");
  isRunning=true; raceTimer=setInterval(raceStep,TICK_INTERVAL_MS);
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

function raceStep() {
  // Move each mouse one simulated minute
  racers.forEach(r => {
    if (r.minuteIdx >= CHOSEN_TOTAL_MINUTES) return;
    const idx = Math.floor(r.minuteIdx);
    const p = dataMap[r.id][idx]; if (!p) return;
    const v = p.activity * PIXELS_PER_MIN;
    r.xPos += v * SIM_MINUTES_PER_TICK;
    r.minuteIdx += SIM_MINUTES_PER_TICK;
    anime({ targets: r.el, left: `${r.xPos}px`, duration: 45, easing: "linear" });
  });
  timeTick += SIM_MINUTES_PER_TICK;

  // Update lights, progress bar, ovulation scroll
  updateLights();
  document.getElementById("timeline-progress").style.width =
    `${Math.min(timeTick / CHOSEN_TOTAL_MINUTES * 100, 100)}%`;
  updateOvulationScroll(timeTick);

  // Live rankings
  const sorted = racers.slice().sort((a, b) => b.xPos - a.xPos);
  femaleOL.innerHTML = "";
  maleOL.innerHTML = "";
  sorted.forEach(r => {
    const li = document.createElement("li");
    li.textContent = r.id;
    (femaleIDs.includes(r.id) ? femaleOL : maleOL).appendChild(li);
  });

  // Auto-scroll
  const avgX = racers.reduce((s, r) => s + r.xPos, 0) / racers.length;
  raceWrapper.scrollLeft = Math.max(0, avgX - raceWrapper.clientWidth / 2);
  ensureTrackWidth(avgX + raceWrapper.clientWidth);

  // Temperature data
  const mIndex = Math.min(Math.floor(timeTick), dataMap[femaleIDs[0]].length - 1);
  const femTemps = femaleIDs.map(id => dataMap[id][mIndex].temperature).filter(v => !isNaN(v));
  const maleTemps = maleIDs.map(id => dataMap[id][mIndex].temperature).filter(v => !isNaN(v));
  const femAvg = femTemps.length ? femTemps.reduce((s, v) => s + v, 0) / femTemps.length : 0;
  const maleAvg = maleTemps.length ? maleTemps.reduce((s, v) => s + v, 0) / maleTemps.length : 0;

  
  barChart.data.datasets[0].data = [
    femTemps.reduce((s, v) => s + v, 0) / femTemps.length,
    maleTemps.reduce((s, v) => s + v, 0) / maleTemps.length
  ];
  barChart.update('none');


  lineChart.data.labels.push(timeTick);
  lineChart.data.datasets[0].data.push(femAvg);  // Female
  lineChart.data.datasets[1].data.push(maleAvg); // Male
  lineChart.update('none');
  
  // Pop-ups
  if (!proestrusPopupShown && timeTick >= PROESTRUS_POPUP_MIN) {
    proestrusPopupShown = true;
    showPopup("🌸 Proestrus Phase 🌸",
      "The estrous cycle is four phases repeating every 4–5 days. " +
      "<strong>Proestrus</strong> (≈12 h) is the follicle-growth phase.");
  }
  if (!estrusPopupShown && timeTick >= ESTRUS_POPUP_MIN) {
    estrusPopupShown = true;
    showPopup("🔥 Estrus Phase 🔥",
      "Peak fertility: female mice become <em>much more active</em> during Estrus!");
  }
  if (!observationPopupShown && timeTick >= OBSERVATION_POPUP_MIN) {
    observationPopupShown = true;
    showPopup("👀 Observation 👀",
      "By now you’ve likely noticed that female mice move less overall—" +
      "except during Estrus, when they surge in activity. " +
      "This pattern reflects natural-selection pressures.");
  }
  if (!metestrusPopupShown && timeTick >= METESTRUS_POPUP_MIN) {
    metestrusPopupShown = true;
    showPopup("🌗 Metestrus Phase 🌗",
      "Hormone levels fall; activity tapers as the cycle moves toward Diestrus.");
  }
  if (!diestrusPopupShown && timeTick >= DIESTRUS_POPUP_MIN) {
    diestrusPopupShown = true;
    showPopup("🌙 Diestrus Phase 🌙",
      "Final low-activity stage before the cycle restarts.");
  }

  // Finish
  if (timeTick >= CHOSEN_TOTAL_MINUTES) {
    clearInterval(raceTimer);
    isRunning = false;
    pauseBtn.disabled = true;
    showFinishPopup(sorted);
  }
}


/* ------------------------------------------------------------------ */
/* 10) pop-up helpers                                                 */
/* ------------------------------------------------------------------ */
function showPopup(title,body){
  clearInterval(raceTimer); isRunning=false; pauseBtn.disabled=false;
  let o=document.getElementById("message-overlay");
  if(!o){o=document.createElement("div");o.id="message-overlay";document.body.appendChild(o);}
  o.innerHTML=`<h2>${title}</h2><p>${body}<br><br><strong>Click anywhere to continue.</strong></p>`;
  o.classList.remove("hidden");
  const resume = () => {
    o.classList.add("hidden");
    document.removeEventListener("click", resume);
  
    // Only resume if the user didn't manually pause
    if (!userPaused) {
      raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
      isRunning = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "⏸ Pause";
    }
  };
  
  setTimeout(()=>document.addEventListener("click",resume),500);
}

function showFinishPopup(sorted){
  const females=sorted.filter(r=>femaleIDs.includes(r.id)).map(r=>r.id);
  const males  =sorted.filter(r=>maleIDs.includes(r.id)).map(r=>r.id);

  let html="<h2>🎉 Finished! 🎉</h2>"+
           "<p>Thank you for taking the time to go through this visual, and the final rankings are below.</p>"+
           "<div style='display:flex;gap:2em;justify-content:center;margin-top:1.2em'>";
  html+="<div><h3>Female</h3><ol>";
  females.forEach(id=>{html+=`<li>${id}</li>`;});
  html+="</ol></div><div><h3>Male</h3><ol>";
  males.forEach(id=>{html+=`<li>${id}</li>`;});
  html+="</ol></div></div>";

  let o=document.getElementById("message-overlay");
  if(!o){o=document.createElement("div");o.id="message-overlay";document.body.appendChild(o);}
  o.innerHTML=html;
  o.classList.remove("hidden");
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