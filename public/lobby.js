const PLAYER_NAME_STORAGE_KEY = "border-tetris-player-name";

const form = document.getElementById("lobby-form");
const input = document.getElementById("player-name");
const activeCountEl = document.getElementById("active-count");
const maxCountEl = document.getElementById("max-count");

const initialName = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
input.value = initialName;

const updateCounts = (snapshot) => {
  if (!snapshot) {
    return;
  }

  activeCountEl.textContent = String(snapshot.ringOrder.length);
  maxCountEl.textContent = String(snapshot.players.length);
};

const loadSessionInfo = async () => {
  const response = await fetch("/api/session");

  if (!response.ok) {
    return;
  }

  const info = await response.json();
  updateCounts(info.snapshot);
};

const eventSource = new EventSource("/api/events");
eventSource.addEventListener("snapshot", (event) => {
  const snapshot = JSON.parse(event.data);
  updateCounts(snapshot);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = input.value.trim().slice(0, 12);
  window.sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, name || "Player");
  window.location.href = "/game.html";
});

loadSessionInfo();
