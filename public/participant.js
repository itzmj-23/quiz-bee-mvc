const socket = io();

const banner = document.getElementById("banner");
const teamName = document.getElementById("teamName");
const questionArea = document.getElementById("questionArea");
const answerArea = document.getElementById("answerArea");
const submitAnswer = document.getElementById("submitAnswer");
const submitStatus = document.getElementById("submitStatus");
const openStatus = document.getElementById("openStatus");

const token = window.location.pathname.split("/").pop();
let currentQuestion = null;
let submitted = false;
let selectedChoice = null;
let lastState = { is_open: false, reveal_answer: false };

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
  if (!currentQuestion) {
    questionArea.innerHTML = `<p class="muted">No question yet.</p>`;
    answerArea.innerHTML = "";
    submitAnswer.disabled = true;
    openStatus.textContent = "Waiting";
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

  renderAnswerInputs();
  updateSubmitStatus(state);
}

function renderAnswerInputs() {
  if (!currentQuestion) return;
  selectedChoice = null;
  if (currentQuestion.type === "multiple_choice") {
    const choices = currentQuestion.choices || [];
    answerArea.innerHTML = `
      <div class="choice-grid">
        ${choices
          .map(
            (choice, idx) =>
              `<button type="button" data-choice="${choice}">${String.fromCharCode(65 + idx)}. ${choice}</button>`
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
