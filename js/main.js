// js/main.js
// Punto de entrada: lee ?img= y &mode= de la URL y arranca el modo correspondiente.
(function () {
  "use strict";
  var params = new URLSearchParams(window.location.search);
  var imgId = params.get("img") || "lote-muestra";
  var isAdmin = params.get("mode") === "admin";

  if (isAdmin) {
    document.body.classList.add("mode-admin");
    window.PanoAdmin.init(imgId);
  } else {
    document.body.classList.add("mode-client");
    window.PanoClient.init(imgId);
  }
})();
