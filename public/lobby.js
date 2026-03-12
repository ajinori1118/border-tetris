const PLAYER_NAME_STORAGE_KEY = "border-tetris-player-name";

const form = document.getElementById("lobby-form");
const input = document.getElementById("player-name");

const initialName = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
input.value = initialName;

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = input.value.trim().slice(0, 12);
  window.sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, name || "Player");
  window.location.href = "/game.html";
});
