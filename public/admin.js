const socket = io();

const adminPasswordInput = document.getElementById("adminPassword");
const savePasswordBtn = document.getElementById("savePassword");
const authStatus = document.getElementById("authStatus");

const qType = document.getElementById("qType");
const qPrompt = document.getElementById("qPrompt");
const choiceBlock = document.getElementById("choiceBlock");
const choiceA = document.getElementById("choiceA");
const choiceB = document.getElementById("choiceB");
const choiceC = document.getElementById("choiceC");
const choiceD = document.getElementById("choiceD");
const qAnswer = document.getElementById("qAnswer");
const qPoints = document.getElementById("qPoints");
const qTime = document.getElementById("qTime");
const createQuestion = document.getElementById("createQuestion");
const cancelEdit = document.getElementById("cancelEdit");
const questionFormTitle = document.getElementById("questionFormTitle");
const questionTable = document.getElementById("questionTable");

const teamName = document.getElementById("teamName");
const createTeam = document.getElementById("createTeam");
const teamList = document.getElementById("teamList");

const currentQuestion = document.getElementById("currentQuestion");
const setCurrent = document.getElementById("setCurrent");
const openQuestion = document.getElementById("openQuestion");
const closeQuestion = document.getElementById("closeQuestion");
const revealAnswer = document.getElementById("revealAnswer");
const stateBanner = document.getElementById("stateBanner");

const adjustTeam = document.getElementById("adjustTeam");
const adjustDelta = document.getElementById("adjustDelta");
const applyAdjust = document.getElementById("applyAdjust");
const resetQuestion = document.getElementById("resetQuestion");
const resetSubmissions = document.getElementById("resetSubmissions");

const rankingsBody = document.getElementById("rankingsBody");
const fastestBody = document.getElementById("fastestBody");
const submissionBody = document.getElementById("submissionBody");
const adminTabs = document.getElementById("adminTabs");
const enableAudio = document.getElementById("enableAudio");
const toggleMusic = document.getElementById("toggleMusic");
const musicVolume = document.getElementById("musicVolume");
const sfxVolume = document.getElementById("sfxVolume");
const bgMusic = document.getElementById("bgMusic");
const sfxSubmit = document.getElementById("sfxSubmit");
const sfxOpen = document.getElementById("sfxOpen");
const sfxClose = document.getElementById("sfxClose");
const sfxReveal = document.getElementById("sfxReveal");
const sfxSet = document.getElementById("sfxSet");
const audioStatus = document.getElementById("audioStatus");
const testSfx = document.getElementById("testSfx");

let adminPassword = localStorage.getItem("adminPassword") || "";
adminPasswordInput.value = adminPassword;
let editingQuestionId = null;
let lastStateSnapshot = { current_question_id: null, is_open: false, reveal_answer: false };
let audioEnabled = false;
let wantsMusic = true;
let bgMusicFallback = null;
let toggleMusicBusy = false;

function setActiveTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

if (adminTabs) {
  adminTabs.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-tab]");
    if (!btn) return;
    setActiveTab(btn.getAttribute("data-tab"));
  });
}

function setAudioVolume() {
  const musicVol = Number(musicVolume?.value || 0.4);
  const sfxVol = Number(sfxVolume?.value || 0.7);
  if (bgMusic) bgMusic.volume = musicVol;
  [sfxSubmit, sfxOpen, sfxClose, sfxReveal, sfxSet].forEach((sfx) => {
    if (sfx) sfx.volume = sfxVol;
  });
}

function setAudioStatus(text) {
  if (audioStatus) audioStatus.textContent = text;
}

function safePlay(audio) {
  if (!audioEnabled || !audio) return;
  audio.currentTime = 0;
  audio.play().catch((err) => {
    setAudioStatus(`Audio: play blocked (${err?.name || "error"})`);
  });
}

function playSfxUrl(url) {
  if (!audioEnabled) return;
  const temp = new Audio(url);
  temp.volume = Number(sfxVolume?.value || 1);
  temp.play().catch((err) => {
    setAudioStatus(`Audio: url blocked (${err?.name || "error"})`);
  });
}

function playSfx(kind) {
  const map = {
    submit: "/audio/submitted.mp3",
    open: "/audio/open.mp3",
    close: "/audio/close.mp3",
    reveal: "/audio/reveal.mp3",
    set: "/audio/setcurrent.mp3",
  };
  const url = map[kind];
  if (!url) return;
  playSfxUrl(url);
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // ignore
  }
}

async function unlockAudio() {
  audioEnabled = true;
  setAudioVolume();
  if (sfxSubmit) {
    await sfxSubmit.play().catch(() => {});
    sfxSubmit.pause();
    sfxSubmit.currentTime = 0;
  }
}

async function enableAudioPlayback(autoplay = false) {
  await unlockAudio();
  if (bgMusic && autoplay && wantsMusic) {
    await bgMusic.play().catch((err) => {
      setAudioStatus(`Audio: music blocked (${err?.name || "error"})`);
    });
    toggleMusic.textContent = bgMusic.paused ? "Play Music" : "Pause Music";
    if (!bgMusic.paused) {
      setAudioStatus("Audio: music playing");
    }
  }
  if (enableAudio) enableAudio.textContent = "Enable Audio";
  if (!autoplay) setAudioStatus("Audio: ready (tap Play Music)");
}

if (enableAudio) {
  enableAudio.addEventListener("click", async () => {
    wantsMusic = true;
    await enableAudioPlayback(true);
    if (bgMusic && !bgMusic.paused) {
      toggleMusic.textContent = "Pause Music";
      setAudioStatus("Audio: music playing");
    }
  });
}

async function handleToggleMusicClick() {
  if (toggleMusicBusy) return;
  toggleMusicBusy = true;
  try {
    if (!bgMusic) return;
    setAudioStatus("Audio: toggle click");
    if (!audioEnabled) await enableAudioPlayback(true);
    wantsMusic = true;
    if (bgMusic.paused) {
      await bgMusic.play().catch((err) => {
        setAudioStatus(`Audio: music blocked (${err?.name || "error"})`);
      });
      if (!bgMusic.paused) {
        toggleMusic.textContent = "Pause Music";
        setAudioStatus("Audio: music playing");
      } else {
        if (!bgMusicFallback) {
          bgMusicFallback = new Audio("/audio/mario.mp3");
          bgMusicFallback.loop = true;
          bgMusicFallback.volume = Number(musicVolume?.value || 0.4);
        }
        await bgMusicFallback
          .play()
          .then(() => {
            toggleMusic.textContent = "Pause Music";
            setAudioStatus("Audio: music playing (fallback)");
          })
          .catch((err) => {
            setAudioStatus(`Audio: music failed (${err?.name || "error"})`);
          });
      }
    } else {
      bgMusic.pause();
      if (bgMusicFallback) bgMusicFallback.pause();
      wantsMusic = false;
      toggleMusic.textContent = "Play Music";
      setAudioStatus("Audio: music paused");
    }
  } finally {
    toggleMusicBusy = false;
  }
}

if (toggleMusic) {
  toggleMusic.addEventListener("click", handleToggleMusicClick);
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest("#toggleMusic");
  if (btn) {
    handleToggleMusicClick();
  }
});

musicVolume?.addEventListener("input", setAudioVolume);
sfxVolume?.addEventListener("input", setAudioVolume);

if (testSfx) {
  testSfx.addEventListener("click", () => {
    enableAudioPlayback(true).then(() => {
      setAudioStatus("Audio: test sfx");
      playSfx("submit");
      playBeep();
    });
  });
}

document.addEventListener(
  "click",
  () => {
    if (!audioEnabled) {
      unlockAudio();
      if (audioStatus && audioStatus.textContent === "Audio: idle") {
        setAudioStatus("Audio: ready (tap Play Music)");
      }
    }
  },
  { once: true }
);

document.addEventListener(
  "keydown",
  () => {
    if (!audioEnabled) {
      unlockAudio();
      if (audioStatus && audioStatus.textContent === "Audio: idle") {
        setAudioStatus("Audio: ready (tap Play Music)");
      }
    }
  },
  { once: true }
);

document.addEventListener(
  "touchstart",
  () => {
    if (!audioEnabled) {
      unlockAudio();
      if (audioStatus && audioStatus.textContent === "Audio: idle") {
        setAudioStatus("Audio: ready (tap Play Music)");
      }
    }
  },
  { once: true, passive: true }
);

[bgMusic, sfxSubmit, sfxOpen, sfxClose, sfxReveal, sfxSet].forEach((audio) => {
  if (!audio) return;
  audio.addEventListener("error", () => {
    setAudioStatus("Audio: failed to load a sound file.");
  });
});

async function verifyAudioFiles() {
  const files = [
    "/audio/mario.mp3",
    "/audio/submitted.mp3",
    "/audio/open.mp3",
    "/audio/close.mp3",
    "/audio/reveal.mp3",
    "/audio/setcurrent.mp3",
  ];
  try {
    const results = await Promise.all(
      files.map((file) =>
        fetch(file, { method: "HEAD" })
          .then((r) => r.ok)
          .catch(() => false)
      )
    );
    if (results.every(Boolean)) {
      setAudioStatus("Audio: files OK (server) ");
    } else {
      setAudioStatus("Audio: one or more files missing (server).");
    }
  } catch {
    setAudioStatus("Audio: unable to verify files.");
  }
}

verifyAudioFiles();

// Initialize with tabs hidden
setAuth(false);

function setAuth(ok) {
  authStatus.textContent = ok ? "Verified" : "Not verified";
  authStatus.classList.toggle("closed", !ok);
  
  // Show/hide the entire content area based on authentication
  const wrapContainer = document.querySelector(".wrap");
  
  if (wrapContainer) {
    wrapContainer.style.display = ok ? "block" : "none";
  }
}

savePasswordBtn.addEventListener("click", () => {
  adminPassword = adminPasswordInput.value.trim();
  localStorage.setItem("adminPassword", adminPassword);
  loadAll();
});

qType.addEventListener("change", () => {
  choiceBlock.style.display = qType.value === "multiple_choice" ? "block" : "none";
});

async function api(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword,
      ...(options.headers || {}),
    },
  });
  if (resp.status === 401) {
    setAuth(false);
    throw new Error("unauthorized");
  }
  setAuth(true);
  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(msg || "request_failed");
  }
  if (resp.headers.get("content-type")?.includes("application/json")) {
    return resp.json();
  }
  return resp.text();
}

createQuestion.addEventListener("click", async () => {
  const payload = {
    type: qType.value,
    prompt: qPrompt.value.trim(),
    choices: qType.value === "multiple_choice" ? [choiceA.value, choiceB.value, choiceC.value, choiceD.value] : null,
    correct_answer: qAnswer.value.trim(),
    points: Number(qPoints.value || 0),
    time_limit_seconds: qTime.value ? Number(qTime.value) : null,
  };
  if (editingQuestionId) {
    await api(`/api/questions/${editingQuestionId}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await api("/api/questions", { method: "POST", body: JSON.stringify(payload) });
  }
  qPrompt.value = "";
  qAnswer.value = "";
  choiceA.value = "";
  choiceB.value = "";
  choiceC.value = "";
  choiceD.value = "";
  editingQuestionId = null;
  questionFormTitle.textContent = "Create Question";
  createQuestion.textContent = "Create Question";
  cancelEdit.style.display = "none";
  await loadQuestions();
});

cancelEdit.addEventListener("click", () => {
  editingQuestionId = null;
  questionFormTitle.textContent = "Create Question";
  createQuestion.textContent = "Create Question";
  cancelEdit.style.display = "none";
  qPrompt.value = "";
  qAnswer.value = "";
  choiceA.value = "";
  choiceB.value = "";
  choiceC.value = "";
  choiceD.value = "";
});

createTeam.addEventListener("click", async () => {
  const name = teamName.value.trim();
  if (!name) return;
  await api("/api/teams", { method: "POST", body: JSON.stringify({ team_name: name }) });
  teamName.value = "";
  await loadTeams();
});

setCurrent.addEventListener("click", async () => {
  await api("/api/game/set_current", {
    method: "POST",
    body: JSON.stringify({ question_id: Number(currentQuestion.value) || null }),
  });
  playSfx("set");
  await refreshSubmissions();
});

openQuestion.addEventListener("click", async () => {
  await api("/api/game/open", { method: "POST" });
});

closeQuestion.addEventListener("click", async () => {
  await api("/api/game/close", { method: "POST" });
  await refreshSubmissions();
});

revealAnswer.addEventListener("click", async () => {
  await api("/api/game/reveal", { method: "POST" });
});

applyAdjust.addEventListener("click", async () => {
  const teamId = Number(adjustTeam.value);
  const delta = Number(adjustDelta.value || 0);
  if (!teamId || !Number.isFinite(delta)) return;
  await api(`/api/teams/${teamId}/adjust`, { method: "POST", body: JSON.stringify({ delta }) });
  adjustDelta.value = "";
  await loadRankings();
});

resetSubmissions.addEventListener("click", async () => {
  const questionId = Number(resetQuestion.value);
  if (!questionId) return;
  await api("/api/game/reset_submissions", { method: "POST", body: JSON.stringify({ question_id: questionId }) });
  await refreshSubmissions();
});

async function loadQuestions() {
  const questions = await api("/api/questions");
  currentQuestion.innerHTML = "";
  resetQuestion.innerHTML = "";
  questionTable.innerHTML = "";
  questions.forEach((q) => {
    const option = document.createElement("option");
    option.value = q.id;
    option.textContent = `#${q.id} ${q.prompt.slice(0, 40)}`;
    currentQuestion.appendChild(option);
    resetQuestion.appendChild(option.cloneNode(true));

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${q.id}</td>
      <td>${q.prompt}</td>
      <td>${q.type}</td>
      <td>${q.points}</td>
      <td>
        <button data-edit="${q.id}">Edit</button>
        <button class="ghost" data-delete="${q.id}">Delete</button>
      </td>
    `;
    questionTable.appendChild(row);
  });

  questionTable.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = questions.find((item) => String(item.id) === btn.getAttribute("data-edit"));
      if (!q) return;
      editingQuestionId = q.id;
      questionFormTitle.textContent = `Edit Question #${q.id}`;
      createQuestion.textContent = "Save Changes";
      cancelEdit.style.display = "inline-block";
      qType.value = q.type;
      qPrompt.value = q.prompt;
      qAnswer.value = q.correct_answer;
      qPoints.value = q.points;
      qTime.value = q.time_limit_seconds || "";
      choiceBlock.style.display = q.type === "multiple_choice" ? "block" : "none";
      if (q.type === "multiple_choice" && q.choices) {
        [choiceA.value, choiceB.value, choiceC.value, choiceD.value] = q.choices;
      }
    });
  });

  questionTable.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete");
      await api(`/api/questions/${id}`, { method: "DELETE" });
      await loadQuestions();
    });
  });
}

async function loadTeams() {
  const teams = await api("/api/teams");
  if (!teams.length) {
    teamList.textContent = "No teams yet.";
  } else {
    teamList.innerHTML = "";
    teams.forEach((team) => {
      const joinUrl = `${window.location.origin}/join/${team.token}`;
      const wrapper = document.createElement("div");
      wrapper.className = "card";
      wrapper.style.margin = "12px 0";
      wrapper.innerHTML = `
        <div class="flex-row">
          <div>
            <strong>${team.name}</strong><br />
            <span class="muted">${joinUrl}</span>
          </div>
          <img class="qr" src="/api/qr/${team.token}?admin_password=${encodeURIComponent(adminPassword)}" alt="QR code" />
          <button class="ghost" data-release="${team.id}">Release Device</button>
        </div>
      `;
      teamList.appendChild(wrapper);
    });
  }

  adjustTeam.innerHTML = "";
  teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    adjustTeam.appendChild(option);
  });

  teamList.querySelectorAll("button[data-release]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-release");
      await api(`/api/teams/${id}/release`, { method: "POST" });
    });
  });
}

async function loadRankings() {
  const rankings = await api("/api/rankings");
  rankingsBody.innerHTML = "";
  rankings.forEach((team, idx) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${team.name}</td>
      <td>${team.points}</td>
      <td>${team.total_time_ms}</td>
    `;
    rankingsBody.appendChild(row);
  });
}

async function refreshSubmissions() {
  const state = await fetch("/api/state").then((r) => r.json());
  if (!state.current_question_id) {
    submissionBody.innerHTML = "<tr><td colspan='6'>No current question.</td></tr>";
    fastestBody.innerHTML = "<tr><td colspan='3'>No current question.</td></tr>";
    return;
  }
  const submissions = await api(`/api/submissions?question_id=${state.current_question_id}`);
  submissionBody.innerHTML = "";
  submissions.forEach((sub) => {
    const row = document.createElement("tr");
    const correctLabel = sub.is_correct === null ? "Pending" : sub.is_correct ? "Yes" : "No";
    row.innerHTML = `
      <td>${sub.team_name}</td>
      <td>${sub.answer}</td>
      <td>${correctLabel}</td>
      <td>${sub.ms_since_open}</td>
      <td>${sub.points_awarded}</td>
      <td>
        <button data-mark="${sub.id}" data-correct="1">Correct</button>
        <button class="ghost" data-mark="${sub.id}" data-correct="0">Wrong</button>
      </td>
    `;
    submissionBody.appendChild(row);
  });

  const fastest = [...submissions].sort((a, b) => a.ms_since_open - b.ms_since_open).slice(0, 5);
  fastestBody.innerHTML = "";
  fastest.forEach((sub) => {
    const row = document.createElement("tr");
    const time = new Date(sub.submitted_at).toLocaleTimeString();
    row.innerHTML = `
      <td>${sub.team_name}</td>
      <td>${sub.ms_since_open}</td>
      <td>${time}</td>
    `;
    fastestBody.appendChild(row);
  });

  submissionBody.querySelectorAll("button[data-mark]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-mark");
      const correct = btn.getAttribute("data-correct") === "1";
      await api(`/api/submissions/${id}/mark`, {
        method: "POST",
        body: JSON.stringify({ is_correct: correct }),
      });
      await refreshSubmissions();
    });
  });
}

async function loadAll() {
  if (!adminPassword) {
    setAuth(false);
    return;
  }
  await Promise.all([loadQuestions(), loadTeams(), loadRankings(), refreshSubmissions()]);
}

socket.on("state_update", (state) => {
  const status = state.is_open ? "OPEN" : "CLOSED";
  stateBanner.textContent = state.question
    ? `Current: #${state.question.id} (${status})` + (state.reveal_answer ? ` | Answer: ${state.question.correct_answer}` : "")
    : "No current question";
  stateBanner.classList.toggle("error", !state.question);
  if (state.current_question_id !== lastStateSnapshot.current_question_id) {
    playSfx("set");
  }
  if (state.is_open && !lastStateSnapshot.is_open) {
    playSfx("open");
  }
  if (!state.is_open && lastStateSnapshot.is_open) {
    playSfx("close");
  }
  if (state.reveal_answer && !lastStateSnapshot.reveal_answer) {
    playSfx("reveal");
  }
  lastStateSnapshot = {
    current_question_id: state.current_question_id,
    is_open: state.is_open,
    reveal_answer: state.reveal_answer,
  };
  refreshSubmissions();
});

socket.on("rankings_update", () => {
  loadRankings();
});

socket.on("submission_received", () => {
  playSfx("submit");
  refreshSubmissions();
});

loadAll();
