// js/client.js
// Modo cliente: muestra el panorama, los lotes y los puntos de interés, con hover/tap,
// un popup arrastrable y navegación entre panoramas (íconos de cámara) sin recargar la página.
window.PanoClient = (function () {
  "use strict";

  var TAP_THRESHOLD = 6;                    // px máximos para considerar un "tap" y no un arrastre de cámara
  var DEFAULT_TITLE = document.title;       // título de pestaña por defecto (si el JSON no trae "titulo")
  var DEFAULT_HUD = "Visualizador de lote";
  var CAMERA_ICON = "icons/camara.webp";    // ícono animado opcional para los enlaces entre panoramas

  function init(firstId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var errorEl = document.getElementById("error");
    var errorMsg = document.getElementById("error-msg");
    var toastEl = document.getElementById("toast");
    var tooltipEl = document.getElementById("tooltip");
    var compass = window.PanoCompass.create(document.getElementById("compass"));
    var northYaw = null;             // yaw hacia el que apunta el norte en el panorama actual (null = sin definir)

    var engine = window.PanoCore.createEngine(container);
    var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
    window.PanoCore.attachWheelZoom(renderer, camera);
    window.PanoCore.attachTouchPinchZoom(renderer, camera);

    var content = new THREE.Group(); // todo lo de la escena actual (panorama + lotes + puntos)
    scene.add(content);
    var interactive = [];            // mallas/sprites clicables de la escena actual
    var overlayEl = document.getElementById("overlay-icons");
    var overlays = [];               // sprites de cámara que se muestran como imagen HTML animada
    var currentId = null;            // panorama mostrado actualmente
    var loadToken = 0;               // evita que una carga lenta pise a una más reciente

    // ---------- Carga / cambio de panorama ----------
    function disposeContent() {
      content.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      while (content.children.length) content.remove(content.children[0]);
      interactive = [];
      overlays = [];
      overlayEl.innerHTML = "";
    }

    function urlFor(id) {
      var p = new URLSearchParams(window.location.search);
      p.set("img", id);
      p.delete("mode");
      return window.location.pathname + "?" + p.toString();
    }

    function loadScene(id, pushHistory) {
      var token = ++loadToken;
      closePopup();
      setHover(null);
      loadingEl.classList.remove("hidden");
      errorEl.classList.remove("visible");

      // El JSON es opcional: si no existe, se muestra el panorama limpio.
      var dataPromise = fetch("data/" + id + ".json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });

      var texturePromise = new Promise(function (resolve, reject) {
        window.PanoCore.loadPanoramaTexture("images/" + id + ".webp", renderer, resolve, reject);
      });

      Promise.all([dataPromise, texturePromise]).then(function (res) {
        if (token !== loadToken) { res[1].dispose(); return; } // llegó tarde: ya se pidió otro
        buildScene(id, res[0] || {}, res[1]);
        if (pushHistory) window.history.pushState({ img: id }, "", urlFor(id));
      }).catch(function () {
        if (token !== loadToken) return;
        loadingEl.classList.add("hidden");
        var msg = 'No se pudo abrir "' + id + '": falta el archivo images/' + id + '.webp en el repositorio (revisa el nombre del destino, distingue mayúsculas).';
        if (currentId === null) {
          errorMsg.textContent = msg;
          errorEl.classList.add("visible");
        } else {
          showToast(msg); // se conserva el panorama actual
        }
      });
    }

    function buildScene(id, data, texture) {
      disposeContent();
      content.add(window.PanoCore.buildPanoramaSphere(texture));

      (data.lotes || []).forEach(function (lot) {
        if (!lot.poligono || lot.poligono.length < 3) return;
        var visuals = window.PanoCore.buildLotVisuals(lot);
        content.add(visuals.fillMesh);
        content.add(visuals.outline);
        interactive.push(visuals.fillMesh);
      });

      var sceneToken = loadToken;
      (data.puntos || []).forEach(function (poi) {
        var sprite = window.PanoCore.createPoiSprite(poi);
        content.add(sprite);
        interactive.push(sprite);
        if (poi.tipo === "camara") attachAnimatedIcon(sprite, sceneToken);
      });

      document.title = data.titulo || DEFAULT_TITLE;
      document.getElementById("hud-title").textContent = data.titulo || DEFAULT_HUD;

      // Vista inicial: la definida en el JSON ("vista") o la predeterminada.
      // Sin "vista.fov" se conserva el nivel de zoom actual.
      var v = data.vista;
      if (v && typeof v.yaw === "number") {
        window.PanoCore.setView(camera, controls, typeof v.pitch === "number" ? v.pitch : 0, v.yaw, v.fov);
      } else {
        window.PanoCore.setView(camera, controls, 0, 180);
      }

      // Brújula: solo si el panorama define el norte.
      northYaw = (typeof data.norte === "number") ? data.norte : null;
      updateMenuAvailability();
      applyOptions(); // aplica lo que el visitante tenga activado/desactivado en el menú

      currentId = id;
      loadingEl.classList.add("hidden");
    }

    // Si existe icons/camara.webp, la cámara se muestra como imagen HTML (el navegador anima el
    // WebP; dentro de WebGL no se animaría). El sprite se deja invisible pero tocable, así que
    // el toque, el hover y el menú funcionan igual que con los demás íconos.
    function attachAnimatedIcon(sprite, token) {
      window.PanoCore.loadIcon(CAMERA_ICON).then(function (img) {
        if (!img || token !== loadToken || interactive.indexOf(sprite) === -1) return; // sin archivo, o ya se cambió de panorama
        var wrap = document.createElement("div");
        wrap.className = "cam-icon";
        var im = document.createElement("img");
        im.src = CAMERA_ICON; im.alt = ""; im.draggable = false;
        wrap.appendChild(im);
        overlayEl.appendChild(wrap);
        sprite.userData.overlayEl = wrap;
        sprite.material.opacity = 0;
        wrap.hidden = sprite.visible === false; // respeta lo que el menú tenga desactivado
        overlays.push(sprite);
      });
    }

    function updateOverlays() {
      if (!overlays.length) return;
      // Mismo tamaño aparente que un sprite de POI_SIZE unidades: se escala con el zoom.
      var pxPerUnit = container.clientHeight / (2 * window.PanoCore.RADIUS_POLY * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      var size = Math.round(window.PanoCore.POI_SIZE * pxPerUnit);
      overlays.forEach(function (o) {
        if (o.visible === false) return;
        var el = o.userData.overlayEl;
        var a = window.PanoCore.worldToScreen(o.position, camera, renderer);
        if (a.behind) { el.classList.add("behind"); return; }
        el.classList.remove("behind");
        if (el._size !== size) { el.style.width = size + "px"; el.style.height = size + "px"; el._size = size; }
        el.style.transform = "translate3d(" + Math.round(a.x - size / 2) + "px," + Math.round(a.y - size / 2) + "px,0)";
      });
    }

    var toastTimer = null;
    function showToast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove("visible"); }, 6500);
    }

    // Botón "atrás" / "adelante" del navegador entre panoramas visitados.
    window.addEventListener("popstate", function () {
      var id = new URLSearchParams(window.location.search).get("img") || "lote-muestra";
      if (id !== currentId) loadScene(id, false);
    });

    // ---------- Hover ----------
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var hovered = null;

    function isPoi(obj) { return !!obj.userData.poi; }
    // Íconos y polígonos comparten el mismo radio: si se superponen, gana el ícono.
    function pickInteractive(e) {
      var visibles = interactive.filter(function (o) { return o.visible !== false; });
      return window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, visibles, isPoi);
    }

    function isCameraLink(obj) {
      var poi = obj && obj.userData.poi;
      return !!(poi && poi.tipo === "camara" && poi.destino);
    }

    function setHover(obj) {
      if (hovered === obj) return;
      if (hovered) {
        if (hovered.userData.lot) hovered.material.opacity = hovered.userData.baseOpacity;
        else if (hovered.userData.poi) hovered.scale.set(hovered.userData.baseScale, hovered.userData.baseScale, 1);
        if (hovered.userData.overlayEl) hovered.userData.overlayEl.classList.remove("hover");
      }
      hovered = obj;
      if (hovered) {
        if (hovered.userData.lot) hovered.material.opacity = hovered.userData.hoverOpacity;
        else if (hovered.userData.poi) hovered.scale.set(hovered.userData.hoverScale, hovered.userData.hoverScale, 1);
        if (hovered.userData.overlayEl) hovered.userData.overlayEl.classList.add("hover");
        renderer.domElement.style.cursor = "pointer";
      } else {
        renderer.domElement.style.cursor = "grab";
      }
      // Tooltip solo para enlaces de cámara: indica a dónde llevan.
      if (isCameraLink(hovered)) {
        tooltipEl.textContent = "📷 " + (hovered.userData.poi.nombre || hovered.userData.poi.destino);
        tooltipEl.classList.add("visible");
      } else {
        tooltipEl.classList.remove("visible");
      }
    }

    renderer.domElement.addEventListener("mousemove", function (e) {
      var hit = pickInteractive(e);
      setHover(hit ? hit.object : null);
      if (tooltipEl.classList.contains("visible")) {
        tooltipEl.style.left = (e.clientX + 16) + "px";
        tooltipEl.style.top = (e.clientY + 16) + "px";
      }
    });

    // ---------- Tap / clic (distingue un tap real de un arrastre de cámara) ----------
    var downPos = null;
    renderer.domElement.addEventListener("pointerdown", function (e) {
      downPos = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener("pointerup", function (e) {
      if (!downPos) return;
      var dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
      downPos = null;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) return;
      var hit = pickInteractive(e);
      if (!hit) return;
      if (isCameraLink(hit.object)) {
        loadScene(hit.object.userData.poi.destino, true); // navegar a otro panorama, sin recargar
      } else {
        showPopup(hit.object);
      }
    });

    // ---------- Popup de información ----------
    var popup = document.getElementById("popup");
    var popupHeader = document.getElementById("popup-header");
    var popupLine = document.getElementById("popup-line-svg");
    var lineEl = document.getElementById("popup-line");
    var openTarget = null;  // objeto (lote o punto) cuyo popup está abierto
    var popupPos = null;    // {x,y} posición manual del popup mientras está abierto
    var draggingPopup = false, dragOffset = { x: 0, y: 0 };

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

      stopDragPopup();
      openTarget = obj;
      popup.classList.remove("dragged");
      popup.classList.add("visible");
      popupLine.classList.add("visible");
      popupPos = null; // se recalcula una posición inicial cerca del objeto
    }

    function closePopup() {
      popup.classList.remove("visible");
      popupLine.classList.remove("visible");
      popupLine.style.opacity = ""; // limpia el estilo en línea que escribe el loop de animación
      openTarget = null;
      popupPos = null;
      stopDragPopup();
      popup.classList.remove("dragged");
    }
    document.getElementById("popup-close").addEventListener("click", closePopup);

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
    // Safari en iPhone no permite pantalla completa en páginas web: ahí el botón se oculta.
    var fsBtn = document.getElementById("fullscreenBtn");
    var rootEl = document.documentElement;
    var fsEnter = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
    var fsExit = document.exitFullscreen || document.webkitExitFullscreen;
    function fsActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    if (!fsEnter) fsBtn.hidden = true;
    fsBtn.addEventListener("click", function () {
      if (!fsActive()) {
        var res = fsEnter.call(rootEl);
        if (res && res.catch) res.catch(function () { showToast("No se pudo activar la pantalla completa en este dispositivo."); });
      } else if (fsExit) {
        fsExit.call(document);
      }
    });

    // ---------- Menú de opciones: mostrar/ocultar por separado ----------
    // Cámaras (enlaces) y puntos de interés se controlan por separado, para poder ocultar
    // los puntos de interés sin perder los enlaces a otros panoramas.
    var opts = { title: true, compass: true, poi: true, cam: true };
    var optInputs = {
      title: document.getElementById("optTitle"),
      compass: document.getElementById("optCompass"),
      poi: document.getElementById("optPoi"),
      cam: document.getElementById("optCam")
    };

    function hasPois(camaras) {
      return interactive.some(function (o) {
        var p = o.userData.poi;
        return !!p && ((p.tipo === "camara") === camaras);
      });
    }

    // Las opciones sin nada que mostrar en este panorama quedan deshabilitadas (conservan su valor).
    function updateMenuAvailability() {
      optInputs.poi.disabled = !hasPois(false);
      optInputs.cam.disabled = !hasPois(true);
      optInputs.compass.disabled = northYaw === null;
    }

    function applyOptions() {
      interactive.forEach(function (o) {
        var p = o.userData.poi;
        if (p) {
          o.visible = (p.tipo === "camara") ? opts.cam : opts.poi;
          if (o.userData.overlayEl) o.userData.overlayEl.hidden = !o.visible;
        }
      });
      compass.setVisible(opts.compass && northYaw !== null);
      if (opts.title) document.body.classList.remove("hide-title"); else document.body.classList.add("hide-title");
      if (hovered && hovered.visible === false) setHover(null);
      if (openTarget && openTarget.visible === false) closePopup();
    }

    Object.keys(optInputs).forEach(function (key) {
      optInputs[key].addEventListener("change", function () {
        opts[key] = optInputs[key].checked;
        applyOptions();
      });
    });

    var menuEl = document.getElementById("menu");
    var menuBtn = document.getElementById("menuBtn");
    function setMenuOpen(open) {
      if (open) menuEl.classList.add("open"); else menuEl.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    menuBtn.addEventListener("click", function () { setMenuOpen(!menuEl.classList.contains("open")); });
    document.addEventListener("pointerdown", function (e) {
      if (menuEl.classList.contains("open") && !menuEl.contains(e.target)) setMenuOpen(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenuOpen(false); });

    // ---------- Loop de render ----------
    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);

      updateOverlays();

      if (northYaw !== null) {
        compass.update(window.PanoCompass.headingFrom(northYaw, window.PanoCore.getViewAngles(camera).yaw));
      }

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

    loadScene(firstId, false);
  }

  return { init: init };
})();
