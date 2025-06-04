// ──────────────────────────────────────────────────────────────────────────
// • First 8 female + first 8 male mice (16 total)
// • Fixed 4-day race (no duration input) → 4 × 1440 = 5760 minutes
// • Simulated pace: 1 simulated minute per 50 ms tick → 1 day ≈ 72 s
// • Separator lines span entire container width, drawn dynamically
// • 3… 2… 1… GO! countdown before race
// • Ovulation timeline: 4 pink bars (each 25% width), labels below, dashed ticks at 12-hour marks
// • Live bottom rankings updated each tick
// • Pause button toggles correctly; manual scrolling does NOT auto-pause
// • Lights toggle every 12 hours (720 minutes), starting ON; full background updates immediately
// • Pause once on first lights-off event, show message overlay with current phase name
// • Modal pop-up “🐭 Mouse Marathon! 🏁” on load with circular ▶️ button
// ──────────────────────────────────────────────────────────────────────────

const raceWrapper     = document.getElementById("race-wrapper");
const raceContainer   = document.getElementById("race-container");
const pauseBtn        = document.getElementById("pause-button");
const femaleOL        = document.querySelector("#female-leaderboard ol");
const maleOL          = document.querySelector("#male-leaderboard ol");
const ovWrapper       = document.getElementById("ovulation-wrapper");
const ovTimeline      = document.getElementById("ovulation-timeline");

// Modal elements
const splashModal     = document.getElementById("splash-modal");
const modalStart      = document.getElementById("modal-start");

// Countdown elements
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownText    = document.getElementById("countdown-text");

// Data structures
const dataMap = {};    // { mouseID: [ { minute, activity, temperature }, … ] }
let femaleIDs = [], maleIDs = [];
let racers = [];       // [ { id, el, xPos, minuteIdx, finished } ]

const MINUTES_PER_DAY  = 1440;
const TOTAL_CYCLE_DAYS = 4;  // one full 4-day cycle
const PHASES = ["Proestrus","Estrus","Metestrus","Diestrus"];

// 4-day race → 4 × 1440 = 5760 simulated minutes
const CHOSEN_TOTAL_MINUTES = 4 * MINUTES_PER_DAY;

// Pace: 1 simulated minute per 50 ms tick
const SIM_MINUTES_PER_TICK = 1;
const TICK_INTERVAL_MS = 50;

let timeTick = 0;      // simulated minutes elapsed
let raceTimer = null;
let isRunning = false;
let lightsOffHandled = false;  // track first lights-off event

// ──────────────────────────────────────────────────────────────────────────
// 1) LOAD ALL FOUR CSVs (female-act, female-temp, male-act, male-temp)
//    (14 days × 1440 minutes = 20160 rows per mouse)
// ──────────────────────────────────────────────────────────────────────────
Promise.all([
  d3.csv("data/Mouse_Fem_Act.csv"),
  d3.csv("data/Mouse_Fem_Temp.csv"),
  d3.csv("data/Mouse_Male_Act.csv"),
  d3.csv("data/Mouse_Male_Temp.csv")
]).then(([fAct, fTemp, mAct, mTemp]) => {
  buildData(fAct, fTemp, true);
  buildData(mAct, mTemp, false);
  computeAverages();
  setupDefaultRace();       // first 8 of each gender
  buildOvulationTimeline(); // 4 pink bars + labels + ticks
  updateOvulationScroll(0);
  updateLights();           // set initial light state

  // Enable the modal start button once data is ready
  modalStart.disabled = false;
});

// ──────────────────────────────────────────────────────────────────────────
// 2) BUILD DATA MAP FOR EACH MOUSE ID
// ──────────────────────────────────────────────────────────────────────────
function buildData(actCSV, tempCSV, isFemale) {
  const n = actCSV.length;           // 20160 rows
  const ids = Object.keys(actCSV[0]);
  if (isFemale) femaleIDs.push(...ids);
  else          maleIDs.push(...ids);

  ids.forEach(id => {
    if (!dataMap[id]) dataMap[id] = new Array(n);
  });

  actCSV.forEach((row, i) => {
    ids.forEach(id => {
      dataMap[id][i] = {
        minute: i,
        activity: +row[id],
        temperature: null
      };
    });
  });
  tempCSV.forEach((row, i) => {
    ids.forEach(id => {
      dataMap[id][i].temperature = +row[id];
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 3) COMPUTE “AVG_FEMALE” & “AVG_MALE” (unused, kept for completeness)
// ──────────────────────────────────────────────────────────────────────────
function computeAverages() {
  const totalMinutes = dataMap[femaleIDs[0]].length; // 20160
  dataMap.AVG_FEMALE = new Array(totalMinutes);
  dataMap.AVG_MALE   = new Array(totalMinutes);

  for (let i = 0; i < totalMinutes; i++) {
    let sumFA = 0, sumFT = 0;
    femaleIDs.forEach(id => {
      sumFA += dataMap[id][i].activity;
      sumFT += dataMap[id][i].temperature;
    });
    let sumMA = 0, sumMT = 0;
    maleIDs.forEach(id => {
      sumMA += dataMap[id][i].activity;
      sumMT += dataMap[id][i].temperature;
    });
    dataMap.AVG_FEMALE[i] = {
      minute: i,
      activity: sumFA / femaleIDs.length,
      temperature: sumFT / femaleIDs.length
    };
    dataMap.AVG_MALE[i] = {
      minute: i,
      activity: sumMA / maleIDs.length,
      temperature: sumMT / maleIDs.length
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 4) SETUP FIRST 8 FEMALES + FIRST 8 MALES (16 total)
// ──────────────────────────────────────────────────────────────────────────
function setupDefaultRace() {
  const chosenFemales = femaleIDs.slice(0, 8);
  const chosenMales   = maleIDs.slice(0, 8);
  const allIDs = [...chosenFemales, ...chosenMales];

  racers = allIDs.map(id => ({
    id,
    el: null,
    xPos: 0,
    minuteIdx: 0,
    finished: false
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// 5) BUILD OVULATION TIMELINE (4 pink bars + labels + dashed ticks)
// ──────────────────────────────────────────────────────────────────────────
function buildOvulationTimeline() {
  ovTimeline.innerHTML = "";
  const existingLabels = document.getElementById("ovulation-labels");
  if (existingLabels) existingLabels.remove();

  // Create 4 pink bars
  for (let d = 1; d <= 4; d++) {
    const bar = document.createElement("div");
    bar.className = "ov-day phase-" + PHASES[(d - 1) % 4].toLowerCase();
    ovTimeline.appendChild(bar);
  }
  // Add dashed ticks at every 12 hours (half-day intervals)
  for (let i = 1; i < 8; i++) {
    const tick = document.createElement("div");
    tick.className = "ov-tick";
    tick.style.left = `${i * 12.5}%`;
    ovTimeline.appendChild(tick);
  }

  // Create labels row
  const labelsRow = document.createElement("div");
  labelsRow.id = "ovulation-labels";
  for (let d = 1; d <= 4; d++) {
    const lbl = document.createElement("div");
    lbl.className = "ov-label";
    lbl.textContent = PHASES[(d - 1) % 4];
    labelsRow.appendChild(lbl);
  }
  ovWrapper.appendChild(labelsRow);
}

// ──────────────────────────────────────────────────────────────────────────
// 6) MODAL START BUTTON HANDLER → hide modal, show countdown, then race
// ──────────────────────────────────────────────────────────────────────────
modalStart.addEventListener("click", () => {
  if (modalStart.disabled) return;

  // 1) Hide the modal immediately
  splashModal.style.display = "none";

  // 2) Show countdown overlay right away
  countdownOverlay.classList.remove("hidden");

  // 3) Run the 3…2…1…GO! countdown, then start the race
  runCountdown(3).then(() => {
    countdownOverlay.classList.add("hidden");
    beginRace();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7) PAUSE BUTTON LOGIC
// ──────────────────────────────────────────────────────────────────────────
pauseBtn.addEventListener("click", () => {
  if (isRunning) {
    clearInterval(raceTimer);
    isRunning = false;
    pauseBtn.textContent = "▶️ Resume";
  } else {
    raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
    isRunning = true;
    pauseBtn.textContent = "⏸ Pause";
  }
});

// Utility: countdown from N → “GO!” → resolve
function runCountdown(startNumber) {
  let count = startNumber;
  countdownText.textContent = count;
  return new Promise(resolve => {
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.textContent = count;
      } else if (count === 0) {
        countdownText.textContent = "GO!";
      } else {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 8) BEGIN RACE: reset state, build UI, enable pause button
// ──────────────────────────────────────────────────────────────────────────
function beginRace() {
  timeTick = 0;
  racers.forEach(r => {
    r.xPos = 0;
    r.minuteIdx = 0;
    r.finished = false;
  });
  femaleOL.innerHTML = "";
  maleOL.innerHTML = "";
  setupRacers();
  document.getElementById("timeline-progress").style.width = "0%";
  updateOvulationScroll(0);

  // Ensure correct lights state immediately
  updateLights();

  // Enable Pause
  pauseBtn.disabled = false;
  pauseBtn.textContent = "⏸ Pause";

  // Hide message overlay if visible
  const msg = document.getElementById("message-overlay");
  if (msg) msg.classList.add("hidden");
  lightsOffHandled = false;

  isRunning = true;
  raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
}

// ──────────────────────────────────────────────────────────────────────────
// 9) BUILD TRACK LINES + RACER CIRCLES
// ──────────────────────────────────────────────────────────────────────────
function setupRacers() {
  clearTrack();

  const laneCount = racers.length;        // 16
  const contH = raceContainer.clientHeight;
  const spacing = contH / (laneCount + 1);

  // Determine container’s total width
  const baseW = 400, extra = 200;
  const totalW = baseW + extra * laneCount;
  raceContainer.style.width = `${totalW}px`;

  racers.forEach((r, idx) => {
    const yPos = spacing * (idx + 1);

    // Separator line (1px tall) across full width
    const line = document.createElement("div");
    line.className = "racer-track";
    line.style.bottom = `${yPos}px`;
    line.style.width = `${totalW}px`;
    raceContainer.appendChild(line);

    // Racer (circle + label)
    const wrapper = document.createElement("div");
    wrapper.className = "racer";
    wrapper.style.bottom = `${yPos - 17}px`; // center 34px circle
    wrapper.style.left = `0px`;

    const circle = document.createElement("div");
    circle.className = r.id.startsWith("f") ? "mouse-body mouse-female" : "mouse-body mouse-male";

    const label = document.createElement("div");
    label.className = "racer-label";
    label.textContent = r.id;

    wrapper.append(circle, label);
    raceContainer.appendChild(wrapper);
    r.el = wrapper;

    // Tooltip on hover
    tippy(circle, {
      content: "",
      allowHTML: true,
      placement: "top",
      onShow(inst) {
        const series = dataMap[r.id];
        const i = Math.min(r.minuteIdx, series.length - 1);
        const { activity, temperature, minute } = series[i];
        inst.setContent(
          `<strong>ID:</strong> ${r.id}<br>` +
          `<strong>Minute:</strong> ${minute}<br>` +
          `<strong>Act:</strong> ${activity.toFixed(2)}<br>` +
          `<strong>Temp:</strong> ${temperature.toFixed(2)} °C`
        );
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 10) CLEAR EXISTING TRACK LINES & RACERS
// ──────────────────────────────────────────────────────────────────────────
function clearTrack() {
  racers.forEach(r => {
    if (r.el) raceContainer.removeChild(r.el);
    r.el = null;
  });
  racers = racers.map(r => ({
    ...r,
    xPos: 0,
    minuteIdx: 0,
    finished: false
  }));

  Array.from(raceContainer.querySelectorAll(".racer-track")).forEach(line => {
    raceContainer.removeChild(line);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 11) MAIN LOOP: Move each mouse 1 simulated minute per 50 ms tick
// ──────────────────────────────────────────────────────────────────────────
function raceStep() {
  racers.forEach(r => {
    if (r.minuteIdx >= CHOSEN_TOTAL_MINUTES || r.finished) return;

    const point = dataMap[r.id][r.minuteIdx];
    const z       = point.temperature - 37.5;
    const sigmoid = 1 / (1 + Math.exp(-z));
    const v       = point.activity * (1 - 0.7 * sigmoid) * 0.1;
    // Advance 1 simulated minute:
    r.xPos += v * SIM_MINUTES_PER_TICK;

    anime({
      targets: r.el,
      left: `${r.xPos}px`,
      duration: 45,
      easing: "linear"
    });

    r.minuteIdx += SIM_MINUTES_PER_TICK;
  });

  timeTick += SIM_MINUTES_PER_TICK;

  // Update lights on/off every 12 hours (720 simulated minutes)
  updateLights();

  // Update timeline progress bar
  const pct = Math.min((timeTick / CHOSEN_TOTAL_MINUTES) * 100, 100);
  document.getElementById("timeline-progress").style.width = `${pct}%`;

  // Scroll ovulation timeline at 1× speed
  updateOvulationScroll(timeTick);

  // Live rankings: sort by xPos each tick
  const sorted = racers
    .slice()
    .sort((a, b) => b.xPos - a.xPos)
    .map(r => r.id);

  femaleOL.innerHTML = "";
  maleOL.innerHTML = "";
  sorted.forEach(id => {
    const li = document.createElement("li");
    li.textContent = id;
    if (id.startsWith("f")) {
      femaleOL.appendChild(li);
    } else {
      maleOL.appendChild(li);
    }
  });

  // Auto-scroll to keep leader near center
  let maxX = 0;
  racers.forEach(r => {
    if (r.xPos > maxX) maxX = r.xPos;
  });
  const centerPoint = maxX - raceWrapper.clientWidth / 2;
  raceWrapper.scrollLeft = Math.max(0, centerPoint);

  // End of the 4-day race
  if (timeTick >= CHOSEN_TOTAL_MINUTES) {
    clearInterval(raceTimer);
    isRunning = false;
    pauseBtn.disabled = true;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 12) UPDATE OVULATION TIMELINE SCROLL (1× speed)
// ──────────────────────────────────────────────────────────────────────────
function updateOvulationScroll(minuteIndex) {
  const totalWidth = ovTimeline.scrollWidth - ovWrapper.clientWidth;
  const scrollX = Math.min(
    (minuteIndex / CHOSEN_TOTAL_MINUTES) * totalWidth,
    totalWidth
  );
  ovWrapper.scrollLeft = scrollX;
}

// ──────────────────────────────────────────────────────────────────────────
// 13) UPDATE LIGHTS & PAUSE ON FIRST LIGHTS-OFF
// ──────────────────────────────────────────────────────────────────────────


function updateLights() {
  const lightCycle = Math.floor(timeTick / 720) % 2;

  if (lightCycle === 1) {
    document.body.classList.add("lights-off");

    if (!lightsOffHandled) {
      lightsOffHandled = true;

      // Pause race
      if (raceTimer) clearInterval(raceTimer);
      isRunning = false;
      pauseBtn.disabled = true;

      // Create or reuse message overlay
      let msg = document.getElementById("message-overlay");
      if (!msg) {
        msg = document.createElement("div");
        msg.id = "message-overlay";
        document.body.appendChild(msg);
      }

      // Directly wait 6 hours simulated (18 seconds real-time)
      setTimeout(() => {
        msg.innerHTML = `
          <h2>🐭 Mouse activity slows during sleep 💤</h2>
          <p>The lights are off.<br/>
          Mice tend to rest more during this period.<br/>
          Let’s continue the race!</p>
        `;
        msg.classList.remove("hidden");

        // Resume race after showing message for 4s
        setTimeout(() => {
          msg.classList.add("hidden");
          raceTimer = setInterval(raceStep, TICK_INTERVAL_MS);
          isRunning = true;
          pauseBtn.disabled = false;
        }, 4000);
      }, 1000); // 6 simulated hours = 360 ticks = 18 seconds real time
    }
  } else {
    document.body.classList.remove("lights-off");
  }
}

