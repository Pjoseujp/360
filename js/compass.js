// js/compass.js
// Brújula tipo cinta (como en los juegos shooter): una franja horizontal que se desplaza
// (diseñada para 42 px de alto) según hacia dónde mira la cámara, con N / NE / E / SE / S / SO / O / NO y grados.
window.PanoCompass = (function () {
  "use strict";

  var PX_PER_DEG = 4.2;   // escala fija de la cinta (px por grado)
  var NAMES = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

  function mod360(a) { return ((a % 360) + 360) % 360; }

  // Rumbo (0° = norte, 90° = este, sentido horario) a partir del yaw de la cámara y
  // del yaw hacia el que apunta el norte en la imagen.
  // Al girar a la derecha el yaw disminuye, por eso se resta.
  function headingFrom(northYaw, viewYaw) { return mod360(northYaw - viewYaw); }

  function create(rootEl) {
    var canvas = rootEl.querySelector("canvas");
    var ctx = canvas.getContext("2d");
    var lastKey = null;

    function setVisible(v) {
      if (v) rootEl.classList.add("visible"); else rootEl.classList.remove("visible");
    }

    function update(heading) {
      if (!rootEl.classList.contains("visible")) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; lastKey = null; }
      var key = heading.toFixed(2) + "|" + cw + "|" + ch;
      if (key === lastKey) return; // nada cambió: no se redibuja
      lastKey = key;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 4;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineCap = "round";

      var half = w / 2;
      var from = heading - half / PX_PER_DEG - 6;
      var to = heading + half / PX_PER_DEG + 6;
      var bottom = h - 2;

      for (var d = Math.ceil(from / 5) * 5; d <= to; d += 5) {
        var x = half + (d - heading) * PX_PER_DEG;
        var n = mod360(d);
        var isCard = n % 90 === 0;
        var isInter = !isCard && n % 45 === 0;
        var isMid = n % 15 === 0;
        var len = isCard ? 9 : (isInter ? 7 : (isMid ? 5 : 3));
        var isNorth = n === 0;

        ctx.strokeStyle = isNorth ? "#ff6b5b" : "rgba(255,255,255," + (isCard ? 1 : 0.75) + ")";
        ctx.lineWidth = isCard ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        ctx.lineTo(x, bottom - len);
        ctx.stroke();

        if (isCard || isInter) {
          var name = NAMES[n / 45];
          ctx.font = (isCard ? "700 15px" : "600 11px") + " 'Segoe UI', Roboto, Arial, sans-serif";
          ctx.fillStyle = isNorth ? "#ff6b5b" : (isCard ? "#ffffff" : "rgba(255,255,255,0.8)");
          ctx.fillText(name, x, isCard ? 25 : 26);
        } else if (n % 30 === 0) {
          ctx.font = "500 10px 'Segoe UI', Roboto, Arial, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.fillText(String(n), x, 27);
        }
      }

      // Marcador central (triángulo) y lectura numérica del rumbo actual.
      ctx.shadowBlur = 3;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(half - 4.5, 11);
      ctx.lineTo(half + 4.5, 11);
      ctx.lineTo(half, 16);
      ctx.closePath();
      ctx.fill();

      var idx = Math.round(heading / 45) % 8;
      ctx.font = "600 11px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(NAMES[idx] + "  " + Math.round(heading) % 360 + "°", half, 5);
    }

    return { update: update, setVisible: setVisible };
  }

  return { create: create, headingFrom: headingFrom };
})();
