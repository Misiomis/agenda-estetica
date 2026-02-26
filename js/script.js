const loginBtn = document.getElementById("loginBtn");

loginBtn.addEventListener("click", () => {
  const usuario = document.getElementById("usuarioInput").value.trim();

  if (!usuario) {
    alert("Ingresá un usuario");
    return;
  }

  localStorage.setItem("usuario", usuario);
  window.location.href = "panel.html";
});