// js/admin.js
// Modo administrador: dibuja/edita polígonos de lotes y coloca puntos de interés
// con íconos, con un flujo simple (clic para agregar, arrastrar para ajustar).
window.PanoAdmin = (function () {
  "use strict";

  var TAP_THRESHOLD = 6; // px: distingue un tap (agregar punto) de un arrastre de cámara

  function init(imgId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var panelSub = document.getElementById("panelSub");
    document.getElementById("imgIdInput").value = imgId;

    var engine = window.PanoCore.createEngine(container);
    var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
    window.PanoCore.attachWheelZoom(renderer, camera);
    window.PanoCore.attachTouchPinchZoom(renderer, camera);

    // Esfera invisible siempre presente: sirve para ubicar puntos con precisión
    // aunque la imagen todavía no haya cargado.
    var pickingSphere = window.PanoCore.createPickingSphere();
    scene.add(pickingSphere);

    var panoSphere = null;
    var savedLots = [];
    var savedPoints = [];
    var savedGroup = new THREE.Group(); // render de los lotes ya guardados
    var poiGroup = new THREE.Group();   // render de los puntos de interés
    scene.add(savedGroup);
    scene.add(poiGroup);

    // ---------- Cambios sin descargar ----------
    // Nada se guarda en un servidor: los datos viven en este editor hasta que se descarga el JSON.
    var dirty = false;
    var downloadBtn = document.getElementById("downloadBtn");
    var downloadInfo = document.getElementById("downloadInfo");
    var DOWNLOAD_HINT = downloadInfo.innerHTML;
    function setDirty(v) {
      dirty = v;
      downloadBtn.textContent = v ? "Descargar JSON ●" : "Descargar JSON";
      if (v) {
        downloadInfo.className = "sub dirty";
        downloadInfo.textContent = "● Hay cambios sin descargar. Descarga el JSON y súbelo a data/ para que el cliente los vea.";
      } else {
        downloadInfo.className = "sub";
        downloadInfo.innerHTML = DOWNLOAD_HINT;
      }
    }
    window.addEventListener("beforeunload", function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    });
    document.getElementById("fTitulo").addEventListener("input", function () { setDirty(true); });

    function openDestination(dest) {
      var msg = '¿Abrir "' + dest + '" en el editor?' + (dirty ? "\n\nTienes cambios sin descargar que se perderán." : "");
      if (!window.confirm(msg)) return;
      dirty = false; // ya confirmó: evita el aviso doble del navegador
      window.location.href = window.location.pathname + "?img=" + encodeURIComponent(dest) + "&mode=admin";
    }

    // ---------- Vista de inicio y norte (por panorama) ----------
    var northMarker = null;    // insignia "N" en el horizonte, solo en el editor
    var vistaInicial = null;   // {pitch, yaw, fov} o null
    var norteYaw = null;       // yaw hacia el que apunta el norte, o null
    var compass = window.PanoCompass.create(document.getElementById("compass"));
    var startViewInfo = document.getElementById("startViewInfo");
    var northInfo = document.getElementById("northInfo");
    var DEFAULT_PITCH = 0, DEFAULT_YAW = 180;

    function round2(n) { return Math.round(n * 100) / 100; }

    function updateViewInfo() {
      startViewInfo.textContent = vistaInicial
        ? "Vista inicial definida (dirección " + Math.round(vistaInicial.yaw) + "°, inclinación " +
          Math.round(vistaInicial.pitch) + "°, zoom " + Math.round(vistaInicial.fov) + "°)."
        : "Sin vista inicial: se usa la predeterminada.";
      northInfo.textContent = norteYaw !== null
        ? "Norte definido (insignia N sobre el horizonte). La brújula se mostrará al cliente."
        : "Norte sin definir: la brújula no se mostrará al cliente.";
      compass.setVisible(norteYaw !== null);
      updateNorthMarker();
    }

    function updateNorthMarker() {
      if (northMarker) {
        scene.remove(northMarker);
        northMarker.material.map.dispose(); northMarker.material.dispose();
        northMarker = null;
      }
      if (norteYaw !== null) {
        northMarker = window.PanoCore.createBadgeSprite("N", "#d9483b", 0, norteYaw);
        scene.add(northMarker);
      }
    }

    function applyStartView() {
      if (vistaInicial) window.PanoCore.setView(camera, controls, vistaInicial.pitch, vistaInicial.yaw, vistaInicial.fov);
      else window.PanoCore.setView(camera, controls, DEFAULT_PITCH, DEFAULT_YAW);
    }
    applyStartView();
    updateViewInfo();

    // Selección por toque: el botón arma el modo y el siguiente toque sobre la imagen define el punto.
    var picking = null; // "start" | "north" | null
    var pickStatus = document.getElementById("pickStatus");
    var pickText = document.getElementById("pickText");

    function beginPick(kind) {
      picking = kind;
      pickText.textContent = kind === "start"
        ? "Toca la imagen en el punto que debe quedar al CENTRO al abrir el panorama. Ajusta antes el zoom: también se guarda."
        : "Toca la imagen en un punto que esté exactamente hacia el NORTE (usa un mapa o una referencia conocida).";
      pickStatus.classList.add("active");
      renderer.domElement.style.cursor = "crosshair";
    }
    function endPick() {
      picking = null;
      pickStatus.classList.remove("active");
      renderer.domElement.style.cursor = "";
    }
    function finishPick(angles) {
      var kind = picking;
      endPick();
      if (kind === "start") {
        vistaInicial = { pitch: round2(angles.pitch), yaw: round2(angles.yaw), fov: Math.round(camera.fov * 10) / 10 };
        applyStartView(); // centra la vista en el punto elegido, para confirmarlo a simple vista
      } else if (kind === "north") {
        norteYaw = round2(angles.yaw);
      }
      setDirty(true);
      updateViewInfo();
    }

    document.getElementById("setStartView").addEventListener("click", function () { beginPick("start"); });
    document.getElementById("setNorth").addEventListener("click", function () { beginPick("north"); });
    document.getElementById("pickUseCenter").addEventListener("click", function () {
      if (picking) finishPick(window.PanoCore.getViewAngles(camera)); // alternativa: usar el centro (+) de la pantalla
    });
    document.getElementById("pickCancel").addEventListener("click", endPick);
    document.getElementById("goStartView").addEventListener("click", applyStartView);
    document.getElementById("clearStartView").addEventListener("click", function () {
      vistaInicial = null; setDirty(true); updateViewInfo();
    });
    document.getElementById("clearNorth").addEventListener("click", function () {
      norteYaw = null; setDirty(true); updateViewInfo();
    });

    var loadSeq = 0;
    function loadPanorama(id) {
      var seq = ++loadSeq;
      endPick();
      loadingEl.classList.remove("hidden");
      panelSub.textContent = "Cargando imagen…";
      if (panoSphere) { scene.remove(panoSphere); panoSphere = null; }

      window.PanoCore.loadPanoramaTexture("images/" + id + ".webp", renderer, function (texture) {
        panoSphere = window.PanoCore.buildPanoramaSphere(texture);
        scene.add(panoSphere);
        loadingEl.classList.add("hidden");
        panelSub.textContent = "images/" + id + ".webp";
      }, function () {
        loadingEl.classList.add("hidden");
        panelSub.textContent = 'No se encontró images/' + id + '.webp (puedes seguir dibujando de todas formas).';
      });

      // cache: "no-store" evita ver un JSON viejo (GitHub Pages guarda archivos en caché unos minutos).
      fetch("data/" + id + ".json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (seq !== loadSeq) return;
          savedLots = (data && data.lotes) || [];
          savedPoints = (data && data.puntos) || [];
          document.getElementById("fTitulo").value = (data && data.titulo) || "";
          var v = data && data.vista;
          vistaInicial = (v && typeof v.yaw === "number")
            ? { pitch: typeof v.pitch === "number" ? v.pitch : 0, yaw: v.yaw, fov: typeof v.fov === "number" ? v.fov : camera.fov }
            : null;
          norteYaw = (data && typeof data.norte === "number") ? data.norte : null;
          updateViewInfo();
          applyStartView();
          renderLotList();
          renderPoiList();
          rebuildSavedGroup();
          rebuildPoiGroup();
          setDirty(false);
        }).catch(function () {
          if (seq !== loadSeq) return;
          savedLots = []; savedPoints = []; vistaInicial = null; norteYaw = null;
          updateViewInfo(); renderLotList(); renderPoiList(); rebuildSavedGroup(); rebuildPoiGroup();
          setDirty(false);
        });
    }
    loadPanorama(imgId);

    document.getElementById("reloadBtn").addEventListener("click", function () {
      if (dirty && !window.confirm("Hay cambios sin descargar. ¿Cargar otro panorama y descartarlos?")) return;
      imgId = document.getElementById("imgIdInput").value.trim() || "lote-muestra";
      loadPanorama(imgId);
    });

    // =======================================================================
    //  LOTES: dibujar / editar polígonos (estilo simple, tipo Google Earth Pro:
    //  clic para agregar vértices, arrastrar cualquier punto para ajustarlo,
    //  deshacer el último, guardar cuando esté listo).
    // =======================================================================
    var currentPoints = [];   // Vector3[] del lote que se está dibujando o editando
    var markerMeshes = [];    // esferas blancas arrastrables, una por vértice
    var editingIndex = null;  // índice en savedLots si se edita uno existente, o null si es nuevo
    var active = false;       // true mientras hay un dibujo/edición de lote en curso
    var addingVertices = false; // true si un tap en área vacía agrega un vértice nuevo
    var previewGroup = new THREE.Group();
    scene.add(previewGroup);
    var previewLine = null;

    var startDrawBtn = document.getElementById("startDraw");
    var undoPointBtn = document.getElementById("undoPoint");
    var finishDrawBtn = document.getElementById("finishDraw");
    var cancelDrawBtn = document.getElementById("cancelDraw");
    var addLotBtn = document.getElementById("addLotBtn");
    var drawStatus = document.getElementById("drawStatus");
    var vertCountEl = document.getElementById("vertCount");

    function redrawLine() {
      if (previewLine) { previewGroup.remove(previewLine); previewLine.geometry.dispose(); previewLine.material.dispose(); previewLine = null; }
      if (currentPoints.length > 1) {
        previewLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(currentPoints),
          new THREE.LineBasicMaterial({ color: 0xffffff })
        );
        previewGroup.add(previewLine);
      }
      vertCountEl.textContent = String(currentPoints.length);
      undoPointBtn.disabled = currentPoints.length === 0;
      addLotBtn.disabled = currentPoints.length < 3;
    }

    function addMarker(pos) {
      var dot = new THREE.Mesh(
        new THREE.SphereGeometry(4.5, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      dot.position.copy(pos);
      previewGroup.add(dot);
      markerMeshes.push(dot);
    }

    function clearDraft() {
      currentPoints = [];
      markerMeshes.forEach(function (m) { previewGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
      markerMeshes = [];
      if (previewLine) { previewGroup.remove(previewLine); previewLine.geometry.dispose(); previewLine.material.dispose(); previewLine = null; }
      vertCountEl.textContent = "0";
    }

    function rebuildSavedGroup() {
      while (savedGroup.children.length) {
        var c = savedGroup.children.pop();
        c.geometry.dispose(); c.material.dispose();
      }
      savedLots.forEach(function (lot, idx) {
        if (idx === editingIndex) return; // se omite el que está en edición
        if (!lot.poligono || lot.poligono.length < 3) return;
        var visuals = window.PanoCore.buildLotVisuals(lot);
        savedGroup.add(visuals.fillMesh);
        savedGroup.add(visuals.outline);
      });
    }

    function setButtonsIdle() {
      startDrawBtn.disabled = false;
      undoPointBtn.disabled = true;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = true;
      addLotBtn.disabled = true;
      addLotBtn.textContent = "Guardar lote";
      drawStatus.classList.remove("active");
    }

    function beginNewLot() {
      if (active) return;
      active = true; addingVertices = true; editingIndex = null;
      clearDraft();
      document.getElementById("fNombre").value = "";
      document.getElementById("fArea").value = "";
      document.getElementById("fDesc").value = "";
      document.getElementById("fCaract").value = "";
      drawStatus.classList.add("active");
      startDrawBtn.disabled = true;
      undoPointBtn.disabled = true;
      finishDrawBtn.disabled = false;
      cancelDrawBtn.disabled = false;
      addLotBtn.disabled = true;
      addLotBtn.textContent = "Guardar lote";
    }

    function beginEditLot(idx) {
      if (active) return;
      active = true; addingVertices = false; editingIndex = idx;
      var lot = savedLots[idx];
      clearDraft();
      currentPoints = lot.poligono.map(function (p) {
        return window.PanoCore.pitchYawToVector(p.pitch, p.yaw, window.PanoCore.RADIUS_POLY);
      });
      currentPoints.forEach(addMarker);
      redrawLine();
      document.getElementById("fNombre").value = lot.nombre || "";
      document.getElementById("fArea").value = lot.area || "";
      document.getElementById("fDesc").value = lot.descripcion || "";
      document.getElementById("fCaract").value = (lot.caracteristicas || []).join(", ");
      drawStatus.classList.add("active");
      startDrawBtn.disabled = true;
      undoPointBtn.disabled = currentPoints.length === 0;
      finishDrawBtn.disabled = true; // ya está "cerrado": se arrastran puntos o se agregan más con "+"
      cancelDrawBtn.disabled = false;
      addLotBtn.disabled = false;
      addLotBtn.textContent = "Guardar cambios";
      rebuildSavedGroup(); // oculta el lote en edición de la vista "guardada"
    }

    function endLotEditing() {
      active = false; addingVertices = false; editingIndex = null;
      clearDraft();
      setButtonsIdle();
      rebuildSavedGroup();
    }

    startDrawBtn.addEventListener("click", beginNewLot);
    cancelDrawBtn.addEventListener("click", endLotEditing);

    undoPointBtn.addEventListener("click", function () {
      if (!currentPoints.length) return;
      currentPoints.pop();
      var lastMarker = markerMeshes.pop();
      if (lastMarker) { previewGroup.remove(lastMarker); lastMarker.geometry.dispose(); lastMarker.material.dispose(); }
      redrawLine();
    });

    // "Terminar de agregar puntos": deja de sumar vértices al tocar el fondo,
    // pero los puntos ya colocados se pueden seguir arrastrando y guardando.
    finishDrawBtn.addEventListener("click", function () {
      addingVertices = false;
      finishDrawBtn.disabled = true;
    });

    addLotBtn.addEventListener("click", function () {
      var nombre = document.getElementById("fNombre").value.trim();
      if (!nombre) { alert("Escribe un nombre para el lote."); return; }
      if (currentPoints.length < 3) { alert("Dibuja al menos 3 vértices."); return; }

      var poligono = currentPoints.map(function (v) {
        var py = window.PanoCore.vectorToPitchYaw(v);
        return { pitch: Math.round(py.pitch * 100) / 100, yaw: Math.round(py.yaw * 100) / 100 };
      });
      var caract = document.getElementById("fCaract").value.split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);

      var lotData = {
        id: editingIndex !== null ? savedLots[editingIndex].id : "lote-" + (savedLots.length + 1),
        nombre: nombre,
        area: document.getElementById("fArea").value.trim(),
        descripcion: document.getElementById("fDesc").value.trim(),
        caracteristicas: caract,
        color: "#2ecc71",
        poligono: poligono
      };

      if (editingIndex !== null) { savedLots[editingIndex] = lotData; }
      else { savedLots.push(lotData); }

      endLotEditing();
      renderLotList();
      setDirty(true);
    });

    function renderLotList() {
      var list = document.getElementById("lotList");
      list.innerHTML = "";
      if (!savedLots.length) {
        list.innerHTML = '<p class="sub">Aún no hay lotes agregados.</p>';
        return;
      }
      savedLots.forEach(function (lot, idx) {
        var item = document.createElement("div");
        item.className = "lot-item";
        item.innerHTML = "<div>" + esc(lot.nombre) + "<br><span>" + lot.poligono.length + " vértices · " + esc(lot.area || "sin área") + "</span></div>";
        var actions = document.createElement("div");
        actions.style.display = "flex";
        var edit = document.createElement("button");
        edit.className = "x"; edit.textContent = "✏️"; edit.title = "Editar puntos y datos";
        edit.addEventListener("click", function () { beginEditLot(idx); });
        var del = document.createElement("button");
        del.className = "x"; del.textContent = "×"; del.title = "Eliminar lote";
        del.addEventListener("click", function () {
          if (editingIndex === idx) endLotEditing();
          savedLots.splice(idx, 1);
          renderLotList();
          rebuildSavedGroup();
          setDirty(true);
        });
        actions.appendChild(edit); actions.appendChild(del);
        item.appendChild(actions);
        list.appendChild(item);
      });
    }
    renderLotList();

    // =======================================================================
    //  PUNTOS DE INTERÉS: un solo clic para colocar un ícono (muelle, parque,
    //  bomberos, PNC, etc.). Se pueden arrastrar directamente para reubicarlos.
    // =======================================================================
    var placingPoi = false;
    var editingPoiIndex = null;
    var poiTipoSelect = document.getElementById("poiTipo");
    var poiNombreInput = document.getElementById("poiNombre");
    var poiDescInput = document.getElementById("poiDesc");
    var poiActionBtn = document.getElementById("poiActionBtn");
    var poiCancelBtn = document.getElementById("poiCancelBtn");
    var poiStatus = document.getElementById("poiStatus");
    var poiDestinoField = document.getElementById("poiDestinoField");
    var poiDestinoInput = document.getElementById("poiDestino");

    function esc(t) {
      return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    // El campo "Destino" solo aplica al tipo cámara (enlace a otro panorama 360).
    function updateDestinoVisibility() {
      poiDestinoField.hidden = poiTipoSelect.value !== "camara";
    }
    poiTipoSelect.addEventListener("change", updateDestinoVisibility);

    Object.keys(window.PanoCore.ICON_TYPES).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = window.PanoCore.ICON_TYPES[key].emoji + " " + window.PanoCore.ICON_TYPES[key].label;
      poiTipoSelect.appendChild(opt);
    });

    function rebuildPoiGroup() {
      while (poiGroup.children.length) {
        var c = poiGroup.children.pop();
        c.material.map.dispose(); c.material.dispose();
      }
      savedPoints.forEach(function (poi) {
        poiGroup.add(window.PanoCore.createPoiSprite(poi));
      });
    }

    function resetPoiForm() {
      placingPoi = false; editingPoiIndex = null;
      poiNombreInput.value = ""; poiDescInput.value = ""; poiDestinoInput.value = "";
      updateDestinoVisibility();
      poiActionBtn.textContent = "Colocar punto en el mapa";
      poiCancelBtn.disabled = true;
      poiStatus.classList.remove("active");
    }
    resetPoiForm();

    poiActionBtn.addEventListener("click", function () {
      if (editingPoiIndex !== null) {
        // Guardar cambios de tipo/nombre/descripción de un punto existente (sin recolocarlo).
        var poi = savedPoints[editingPoiIndex];
        poi.tipo = poiTipoSelect.value;
        poi.nombre = poiNombreInput.value.trim() || poi.nombre;
        poi.descripcion = poiDescInput.value.trim();
        if (poi.tipo === "camara") {
          var dest = poiDestinoInput.value.trim();
          if (!dest) { alert("Indica el nombre del panorama de destino."); return; }
          poi.destino = dest;
        } else {
          delete poi.destino;
        }
        rebuildPoiGroup();
        renderPoiList();
        resetPoiForm();
        setDirty(true);
        return;
      }
      if (!poiNombreInput.value.trim()) { alert("Escribe un nombre para el punto."); return; }
      if (poiTipoSelect.value === "camara" && !poiDestinoInput.value.trim()) {
        alert("Indica el nombre del panorama de destino (el mismo nombre de su archivo .webp, sin extensión).");
        return;
      }
      placingPoi = true;
      poiActionBtn.textContent = "Toca la imagen para colocarlo…";
      poiCancelBtn.disabled = false;
      poiStatus.classList.add("active");
    });

    poiCancelBtn.addEventListener("click", resetPoiForm);

    function renderPoiList() {
      var list = document.getElementById("poiList");
      list.innerHTML = "";
      if (!savedPoints.length) {
        list.innerHTML = '<p class="sub">Aún no hay puntos de interés.</p>';
        return;
      }
      savedPoints.forEach(function (poi, idx) {
        var item = document.createElement("div");
        item.className = "lot-item";
        var info = window.PanoCore.ICON_TYPES[poi.tipo] || window.PanoCore.ICON_TYPES.generico;
        item.innerHTML = "<div>" + info.emoji + " " + esc(poi.nombre) + "<br><span>" + esc(info.label) +
          (poi.destino ? " → " + esc(poi.destino) : "") + "</span></div>";
        var actions = document.createElement("div");
        actions.style.display = "flex";
        var edit = document.createElement("button");
        edit.className = "x"; edit.textContent = "✏️"; edit.title = "Editar nombre/tipo (arrástralo en el mapa para moverlo)";
        edit.addEventListener("click", function () {
          editingPoiIndex = idx; placingPoi = false;
          poiTipoSelect.value = poi.tipo;
          poiNombreInput.value = poi.nombre;
          poiDescInput.value = poi.descripcion || "";
          poiDestinoInput.value = poi.destino || "";
          updateDestinoVisibility();
          poiActionBtn.textContent = "Guardar cambios";
          poiCancelBtn.disabled = false;
        });
        var del = document.createElement("button");
        del.className = "x"; del.textContent = "×"; del.title = "Eliminar punto";
        del.addEventListener("click", function () {
          savedPoints.splice(idx, 1);
          setDirty(true);
          rebuildPoiGroup();
          renderPoiList();
          if (editingPoiIndex === idx) resetPoiForm();
        });
        if (poi.tipo === "camara" && poi.destino) {
          var go = document.createElement("button");
          go.className = "x"; go.textContent = "↗"; go.title = "Abrir el panorama de destino en el editor";
          go.addEventListener("click", function () { openDestination(poi.destino); });
          actions.appendChild(go);
        }
        actions.appendChild(edit); actions.appendChild(del);
        item.appendChild(actions);
        list.appendChild(item);
      });
    }
    renderPoiList();

    // =======================================================================
    //  Interacción compartida: agregar vértice/punto (tap) o arrastrar uno
    //  existente (vértice de lote o ícono de punto de interés).
    // =======================================================================
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var draggingObject = null; // marcador de vértice o sprite de POI que se arrastra
    var downInfo = null;       // {x,y} del pointerdown, para distinguir tap de arrastre

    function draggableTargets() {
      return markerMeshes.concat(poiGroup.children);
    }

    renderer.domElement.addEventListener("pointerdown", function (e) {
      downInfo = { x: e.clientX, y: e.clientY };
      if (picking) return; // en modo "tocar la imagen" no se arrastran puntos
      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, draggableTargets());
      if (hit) {
        draggingObject = hit.object;
        controls.enabled = false; // evita que la cámara rote mientras se arrastra
      }
    });

    renderer.domElement.addEventListener("pointermove", function (e) {
      if (!draggingObject) return;
      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, [pickingSphere]);
      if (!hit) return;
      var idx = markerMeshes.indexOf(draggingObject);
      if (idx !== -1) {
        draggingObject.position.copy(hit.point);
        currentPoints[idx] = hit.point.clone();
        redrawLine();
      } else if (draggingObject.userData.poi) {
        draggingObject.position.copy(hit.point);
        var py = window.PanoCore.vectorToPitchYaw(hit.point);
        draggingObject.userData.poi.pitch = Math.round(py.pitch * 100) / 100;
        draggingObject.userData.poi.yaw = Math.round(py.yaw * 100) / 100;
      }
    });

    renderer.domElement.addEventListener("pointerup", function (e) {
      if (draggingObject) {
        var obj = draggingObject;
        var moved = downInfo ? Math.sqrt(Math.pow(e.clientX - downInfo.x, 2) + Math.pow(e.clientY - downInfo.y, 2)) : Infinity;
        draggingObject = null;
        controls.enabled = true;
        downInfo = null; // fue un arrastre o un toque sobre un ícono, no un tap sobre el fondo
        var poiData = obj.userData && obj.userData.poi;
        if (poiData && moved > TAP_THRESHOLD) setDirty(true); // el ícono se reubicó
        // Un toque (sin arrastrar) sobre una cámara abre su panorama de destino en el editor.
        if (poiData && moved <= TAP_THRESHOLD && poiData.tipo === "camara" && poiData.destino) openDestination(poiData.destino);
        return;
      }
      if (!downInfo) return;
      var dx = e.clientX - downInfo.x, dy = e.clientY - downInfo.y;
      downInfo = null;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) return; // fue un arrastre de cámara, no un tap

      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, [pickingSphere]);
      if (!hit) return;

      if (picking) {
        finishPick(window.PanoCore.vectorToPitchYaw(hit.point));
        return;
      }

      if (active && addingVertices) {
        currentPoints.push(hit.point.clone());
        addMarker(hit.point.clone());
        redrawLine();
      } else if (placingPoi) {
        var py = window.PanoCore.vectorToPitchYaw(hit.point);
        var poi = {
          id: "poi-" + (savedPoints.length + 1),
          tipo: poiTipoSelect.value,
          nombre: poiNombreInput.value.trim(),
          descripcion: poiDescInput.value.trim(),
          pitch: Math.round(py.pitch * 100) / 100,
          yaw: Math.round(py.yaw * 100) / 100
        };
        if (poi.tipo === "camara") poi.destino = poiDestinoInput.value.trim();
        savedPoints.push(poi);
        setDirty(true);
        rebuildPoiGroup();
        renderPoiList();
        resetPoiForm();
      }
    });

    // ---------- Descargar JSON ----------
    document.getElementById("downloadBtn").addEventListener("click", function () {
      var payload = {
        titulo: document.getElementById("fTitulo").value.trim() || undefined,
        vista: vistaInicial || undefined,
        norte: norteYaw !== null ? norteYaw : undefined,
        lotes: savedLots,
        puntos: savedPoints
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = (document.getElementById("imgIdInput").value.trim() || "lote") + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      var fileName = a.download;
      setDirty(false);
      downloadInfo.className = "sub saved";
      downloadInfo.textContent = "✔ Descargado " + fileName + ". Súbelo a data/ en el repositorio (reemplaza el anterior) para publicar los cambios.";
    });

    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      if (norteYaw !== null) {
        compass.update(window.PanoCompass.headingFrom(norteYaw, window.PanoCore.getViewAngles(camera).yaw));
      }
    })();
  }

  return { init: init };
})();
