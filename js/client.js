// js/client.js
// Modo cliente: muestra el panorama y los lotes, con hover/tap y popup arrastrable.
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

    // El JSON es opcional: si no existe, se muestra el panorama limpio sin lotes.
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

      var lotMeshes = [];
      (data.lotes || []).forEach(function (lot) {
        if (!lot.poligono || lot.poligono.length < 3) return;
        var visuals = window.PanoCore.buildLotVisuals(lot);
        scene.add(visuals.fillMesh);
        scene.add(visuals.outline);
        lotMeshes.push(visuals.fillMesh);
      });

      var raycaster = new THREE.Raycaster();
      var mouse = new THREE.Vector2();
      var hovered = null;
      var popup = document.getElementById("popup");
      var popupHeader = document.getElementById("popup-header");
      var popupLine = document.getElementById("popup-line-svg");
      var lineEl = document.getElementById("popup-line");
      var openLot = null; // mesh del lote cuyo popup está abierto (para la línea guía)
      var popupPos = null; // {x,y} posición manual del popup mientras está abierto

      function setHover(mesh) {
        if (hovered === mesh) return;
        if (hovered) hovered.material.opacity = hovered.userData.baseOpacity;
        hovered = mesh;
        if (hovered) {
          hovered.material.opacity = hovered.userData.hoverOpacity;
          renderer.domElement.style.cursor = "pointer";
        } else {
          renderer.domElement.style.cursor = "grab";
        }
      }

      renderer.domElement.addEventListener("mousemove", function (e) {
        var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, lotMeshes);
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
        var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, lotMeshes);
        if (hit) showPopup(hit.object);
      });

      function showPopup(mesh) {
        var lot = mesh.userData.lot;
        document.getElementById("popup-title").textContent = lot.nombre || "Lote";
        document.getElementById("popup-area").textContent = lot.area ? ("Área: " + lot.area) : "";
        document.getElementById("popup-desc").textContent = lot.descripcion || "";
        var list = document.getElementById("popup-caract");
        list.innerHTML = "";
        (lot.caracteristicas || []).forEach(function (c) {
          var li = document.createElement("li");
          li.textContent = c;
          list.appendChild(li);
        });

        openLot = mesh;
        popup.classList.remove("dragged");
        popup.classList.add("visible");
        popupLine.classList.add("visible");
        popupPos = null; // se recalcula una posición inicial cerca del lote
      }

      document.getElementById("popup-close").addEventListener("click", function () {
        popup.classList.remove("visible");
        popupLine.classList.remove("visible");
        openLot = null;
      });

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
        if (openLot) {
          var anchor = window.PanoCore.worldToScreen(openLot.userData.centroid, camera, renderer);
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
