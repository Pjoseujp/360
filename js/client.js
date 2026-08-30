// js/client.js
// Modo cliente: muestra el panorama, los lotes y los puntos de interés,
// con hover/tap y un popup arrastrable.
window.PanoClient = (function () {
  "use strict";

  var TAP_THRESHOLD = 6; // px de movimiento máximo para considerarlo un "tap", no un arrastre de cámara

  function init(imgId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var errorEl = document.getElementById("error");
    var errorMsg = document.getElementById("error-msg");

    var imageUrl = "images/" + imgId + ".webp";
    var dataUrl = "data/" + imgId + ".json";

    // El JSON es opcional: si no existe, se muestra el panorama limpio sin lotes ni puntos.
    fetch(dataUrl)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) { start(data || {}); });

    function start(data) {
      if (data.titulo) {
        document.getElementById("hud-title").textContent = data.titulo;
        document.title = data.titulo;
      }

      var engine = window.PanoCore.createEngine(container);
      var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
      window.PanoCore.attachWheelZoom(renderer, camera);
      window.PanoCore.attachTouchPinchZoom(renderer, camera);

      window.PanoCore.loadPanoramaTexture(imageUrl, renderer, function (texture) {
        scene.add(window.PanoCore.buildPanoramaSphere(texture));
        loadingEl.classList.add("hidden");
      }, function () {
        errorMsg.textContent = 'No se encontró la imagen "' + imageUrl + '" en el repositorio.';
        errorEl.classList.add("visible");
        loadingEl.classList.add("hidden");
      });

      var interactive = []; // mallas/sprites clicables: lotes + puntos de interés

      (data.lotes || []).forEach(function (lot) {
        if (!lot.poligono || lot.poligono.length < 3) return;
        var visuals = window.PanoCore.buildLotVisuals(lot);
        scene.add(visuals.fillMesh);
        scene.add(visuals.outline);
        interactive.push(visuals.fillMesh);
      });

      (data.puntos || []).forEach(function (poi) {
        var sprite = window.PanoCore.createPoiSprite(poi);
        scene.add(sprite);
        interactive.push(sprite);
      });

      var raycaster = new THREE.Raycaster();
      var mouse = new THREE.Vector2();
      var hovered = null;
      var popup = document.getElementById("popup");
      var popupHeader = document.getElementById("popup-header");
      var popupLine = document.getElementById("popup-line-svg");
      var lineEl = document.getElementById("popup-line");
      var openTarget = null;  // objeto (lote o punto) cuyo popup está abierto
      var popupPos = null;    // {x,y} posición manual del popup mientras está abierto

      function setHover(obj) {
        if (hovered === obj) return;
        if (hovered) {
          if (hovered.userData.lot) hovered.material.opacity = hovered.userData.baseOpacity;
          else if (hovered.userData.poi) hovered.scale.set(hovered.userData.baseScale, hovered.userData.baseScale, 1);
        }
        hovered = obj;
        if (hovered) {
          if (hovered.userData.lot) hovered.material.opacity = hovered.userData.hoverOpacity;
          else if (hovered.userData.poi) hovered.scale.set(hovered.userData.hoverScale, hovered.userData.hoverScale, 1);
          renderer.domElement.style.cursor = "pointer";
        } else {
          renderer.domElement.style.cursor = "grab";
        }
      }

      renderer.domElement.addEventListener("mousemove", function (e) {
        var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, interactive);
        setHover(hit ? hit.object : null);
      });

      // Distingue un "tap" real de un arrastre de cámara: solo abre el popup si el puntero
      // no se movió más de TAP_THRESHOLD px entre pointerdown y pointerup.
      var downPos = null;
      renderer.domElement.addEventListener("pointerdown", function (e) {
        downPos = { x: e.clientX, y: e.clientY };
      });
      renderer.domElement.addEventListener("pointerup", function (e) {
        if (!downPos) return;
        var dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
        downPos = null;
        if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) return;
        var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, interactive);
        if (hit) showPopup(hit.object);
      });

      function showPopup(obj) {
        var info = obj.userData.lot || obj.userData.poi;
        document.getElementById("popup-title").textContent = info.nombre || "Sitio";
        document.getElementById("popup-area").textContent = info.area ? ("Área: " + info.area) : "";
        document.getElementById("popup-desc").textContent = info.descripcion || "";
        var list = document.getElementById("popup-caract");
        list.innerHTML = "";
        (info.caracteristicas || []).forEach(function (c) {
          var li = document.createElement("li");
          li.textContent = c;
          list.appendChild(li);
        });

        openTarget = obj;
        popup.classList.remove("dragged");
        popup.classList.add("visible");
        popupLine.classList.add("visible");
        popupPos = null; // se recalcula una posición inicial cerca del objeto
      }

      document.getElementById("popup-close").addEventListener("click", closePopup);

      function closePopup() {
        popup.classList.remove("visible");
        popupLine.classList.remove("visible");
        popupLine.style.opacity = ""; // limpia el estilo en línea que el loop de animación va escribiendo;
                                       // si no se limpia, queda "pegado" y gana sobre la clase CSS al cerrar
        openTarget = null;
        popupPos = null;
        stopDragPopup();
        popup.classList.remove("dragged");
      }

      // ---------- Arrastrar el popup ----------
      var draggingPopup = false, dragOffset = { x: 0, y: 0 };
      popupHeader.addEventListener("pointerdown", function (e) {
        draggingPopup = true;
        document.body.classList.add("dragging-popup");
        var rect = popup.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        popupHeader.setPointerCapture(e.pointerId);
      });
      popupHeader.addEventListener("pointermove", function (e) {
        if (!draggingPopup) return;
        var w = popup.offsetWidth, h = popup.offsetHeight;
        var x = THREE.MathUtils.clamp(e.clientX - dragOffset.x, 8, window.innerWidth - w - 8);
        var y = THREE.MathUtils.clamp(e.clientY - dragOffset.y, 8, window.innerHeight - h - 8);
        popupPos = { x: x, y: y };
        popup.classList.add("dragged");
        popup.style.left = x + "px";
        popup.style.top = y + "px";
      });
      function stopDragPopup() {
        draggingPopup = false;
        document.body.classList.remove("dragging-popup");
      }
      popupHeader.addEventListener("pointerup", stopDragPopup);
      popupHeader.addEventListener("pointercancel", stopDragPopup);

      // ---------- Botón de pantalla completa ----------
      var fsBtn = document.getElementById("fullscreenBtn");
      fsBtn.addEventListener("click", function () {
        if (!document.fullscreenElement) {
          (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
        } else {
          (document.exitFullscreen || function () {}).call(document);
        }
      });

      (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);

        // Actualiza posición del popup (si aún no fue arrastrado) y la línea guía.
        if (openTarget) {
          var anchor = window.PanoCore.worldToScreen(openTarget.userData.centroid, camera, renderer);
          if (!popupPos) {
            var w = popup.offsetWidth || 340, h = popup.offsetHeight || 220;
            popupPos = {
              x: THREE.MathUtils.clamp(anchor.x + 26, 8, window.innerWidth - w - 8),
              y: THREE.MathUtils.clamp(anchor.y - h / 2, 8, window.innerHeight - h - 8)
            };
          }
          if (!draggingPopup && !popup.classList.contains("dragged")) {
            popup.style.left = popupPos.x + "px";
            popup.style.top = popupPos.y + "px";
          }
          var rect = popup.getBoundingClientRect();
          var targetX = anchor.x < rect.left ? rect.left : (anchor.x > rect.right ? rect.right : rect.left);
          var targetY = THREE.MathUtils.clamp(anchor.y, rect.top, rect.bottom);
          lineEl.setAttribute("x1", anchor.x);
          lineEl.setAttribute("y1", anchor.y);
          lineEl.setAttribute("x2", targetX);
          lineEl.setAttribute("y2", targetY);
          popupLine.style.opacity = anchor.behind ? "0" : "0.55";
        }
      })();
    }
  }

  return { init: init };
})();
