const socket = io();

const banner = document.getElementById("banner");
const teamName = document.getElementById("teamName");
const questionArea = document.getElementById("questionArea");
const answerArea = document.getElementById("answerArea");
const submitAnswer = document.getElementById("submitAnswer");
const submitStatus = document.getElementById("submitStatus");
const openStatus = document.getElementById("openStatus");

const token = window.location.pathname.split("/").pop();
const timerDisplay = document.getElementById("timerDisplay");
let currentQuestion = null;
let submitted = false;
let selectedChoice = null;
let lastState = { is_open: false, reveal_answer: false };
let timerInterval = null;
let questionOpenedAt = null;
let countdownAudio = null;

function setBanner(text, type = "") {
  banner.textContent = text;
  banner.classList.toggle("error", type === "error");
}

async function joinTeam() {
  const resp = await fetch(`/api/join/${token}`, { method: "POST" });
  const data = await resp.json();
  if (!resp.ok) {
    if (data.error === "in_use") {
      setBanner("Team already in use on another device. Ask admin to release.", "error");
    } else {
      setBanner("Invalid or expired team token.", "error");
    }
    submitAnswer.disabled = true;
    return;
  }
  teamName.textContent = data.team.name;
  submitted = data.submitted_for_current;
  setBanner("Connected. Waiting for question.");
  loadState();
}

async function loadState() {
  const state = await fetch("/api/state").then((r) => r.json());
  currentQuestion = state.question;
  updateQuestion(state);
}

function updateQuestion(state) {
  lastState = state;
  currentQuestion = state.question;
  
  // Clear existing timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Stop countdown audio
  if (countdownAudio) {
    countdownAudio.pause();
    countdownAudio = null;
  }
  
  if (!currentQuestion) {
    questionArea.innerHTML = `<p class="muted">No question yet.</p>`;
    answerArea.innerHTML = "";
    submitAnswer.disabled = true;
    openStatus.textContent = "Waiting";
    timerDisplay.style.display = "none";
    return;
  }
  
  questionArea.innerHTML = `
    <h3>${currentQuestion.prompt}</h3>
    <p class="muted">Points: ${currentQuestion.points}</p>
  `;
  if (state.reveal_answer) {
    questionArea.innerHTML += `<p class="muted">Answer: ${currentQuestion.correct_answer}</p>`;
  }
  openStatus.textContent = state.is_open ? "Open" : "Closed";
  openStatus.classList.toggle("closed", !state.is_open);

  if (!state.is_open) {
    submitAnswer.disabled = true;
  }
  
  // Handle timer for questions with time limits
  if (currentQuestion.time_limit_seconds && state.is_open) {
    questionOpenedAt = state.opened_at || Date.now();
    startTimer(currentQuestion.time_limit_seconds);
  } else {
    timerDisplay.style.display = "none";
  }

  renderAnswerInputs();
  updateSubmitStatus(state);
}

function startTimer(limitSeconds) {
  timerDisplay.style.display = "block";
  
  // Play countdown audio based on time limit
  if (countdownAudio) {
    countdownAudio.pause();
    countdownAudio = null;
  }
  
  const audioFile = limitSeconds === 10 ? "/audio/10-sec-countdown.mp3" : 
                    limitSeconds === 20 ? "/audio/20-sec-countdown.mp3" : null;
  
  if (audioFile) {
    countdownAudio = new Audio(audioFile);
    countdownAudio.volume = 0.7;
    countdownAudio.play().catch(() => {
      // Audio play blocked, ignore
    });
  }
  
  function updateTimerDisplay() {
    const elapsed = Date.now() - questionOpenedAt;
    const remaining = Math.max(0, limitSeconds * 1000 - elapsed);
    const seconds = Math.floor(remaining / 1000);
    const ms = remaining % 1000;
    
    timerDisplay.textContent = `Time: ${seconds}s ${ms}ms`;
    
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerDisplay.textContent = "Time's up!";
      timerDisplay.classList.add("error");
      if (countdownAudio) {
        countdownAudio.pause();
        countdownAudio = null;
      }
    } else if (remaining <= 5000) {
      timerDisplay.classList.add("error");
    } else {
      timerDisplay.classList.remove("error");
    }
  }
  
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 50);
}

function renderAnswerInputs() {
  if (!currentQuestion) return;
  selectedChoice = null;
  if (currentQuestion.type === "multiple_choice") {
    const choices = currentQuestion.choices || [];
    
    // Helper function to check if choice is an image URL
    const isImageUrl = (str) => {
      return str && /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(str) || str.startsWith('data:image/');
    };
    
    answerArea.innerHTML = `
      <div class="choice-grid">
        ${choices
          .map(
            (choice, idx) => {
              const letter = String.fromCharCode(65 + idx);
              if (isImageUrl(choice)) {
                return `<button type="button" data-choice="${choice}" class="choice-image">
                  <span class="choice-letter">${letter}</span>
                  <img src="${choice}" alt="Choice ${letter}" />
                </button>`;
              } else {
                return `<button type="button" data-choice="${choice}">${letter}. ${choice}</button>`;
              }
            }
          )
          .join("")}
      </div>
    `;
    answerArea.querySelectorAll("button[data-choice]").forEach((btn) => {
      btn.addEventListener("click", () => {
        answerArea.querySelectorAll("button[data-choice]").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedChoice = btn.getAttribute("data-choice");
      });
    });
  } else {
    answerArea.innerHTML = `<input id="textAnswer" placeholder="Type your answer" />`;
  }
}

function updateSubmitStatus(state) {
  if (submitted) {
    submitStatus.textContent = state.is_open
      ? "Answer submitted. Waiting for close."
      : "Answer submitted. Question closed.";
    submitAnswer.disabled = true;
    setInputsDisabled(true);
  } else {
    submitStatus.textContent = state.is_open ? "Ready to submit." : "Question closed.";
    submitAnswer.disabled = !state.is_open;
    setInputsDisabled(!state.is_open);
  }
}

function setInputsDisabled(disabled) {
  if (currentQuestion?.type === "multiple_choice") {
    answerArea.querySelectorAll("button[data-choice]").forEach((btn) => {
      btn.disabled = disabled;
    });
  } else {
    const input = document.getElementById("textAnswer");
    if (input) input.disabled = disabled;
  }
}

submitAnswer.addEventListener("click", async () => {
  if (!currentQuestion) return;
  let answer = "";
  if (currentQuestion.type === "multiple_choice") {
    answer = selectedChoice || "";
  } else {
    const input = document.getElementById("textAnswer");
    answer = input ? input.value.trim() : "";
  }
  if (!answer) {
    setBanner("Please provide an answer before submitting.", "error");
    return;
  }
  const resp = await fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, answer }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    setBanner("Unable to submit. " + (data.error || ""), "error");
    return;
  }
  submitted = true;
  setBanner("Submitted!", "");
  updateSubmitStatus({ is_open: true });
});

socket.on("state_update", (state) => {
  if (currentQuestion && state.question && currentQuestion.id !== state.question.id) {
    submitted = false;
  }
  updateQuestion(state);
});

socket.on("question_reset", (payload) => {
  if (currentQuestion && payload.question_id === currentQuestion.id) {
    submitted = false;
    updateSubmitStatus(lastState);
  }
});

joinTeam();
