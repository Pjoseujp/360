// js/admin.js
// Modo administrador: dibuja y edita polígonos sobre el panorama, y exporta el JSON del lote.
window.PanoAdmin = (function () {
  "use strict";

  var TAP_THRESHOLD = 6; // px: distingue un tap (agregar vértice) de un arrastre de cámara

  function init(imgId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var panelSub = document.getElementById("panelSub");
    document.getElementById("imgIdInput").value = imgId;

    var engine = window.PanoCore.createEngine(container);
    var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
    window.PanoCore.attachWheelZoom(renderer, camera);
    window.PanoCore.attachTouchPinchZoom(renderer, camera);

    // Esfera invisible siempre presente: sirve para ubicar vértices con precisión
    // aunque la imagen todavía no haya cargado.
    var pickingSphere = window.PanoCore.createPickingSphere();
    scene.add(pickingSphere);

    var panoSphere = null;
    var savedLots = [];
    var savedGroup = new THREE.Group(); // render de los lotes ya guardados
    scene.add(savedGroup);

    function loadPanorama(id) {
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

      fetch("data/" + id + ".json").then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          savedLots = (data && data.lotes) || [];
          document.getElementById("fTitulo").value = (data && data.titulo) || "";
          renderLotList();
        }).catch(function () { savedLots = []; renderLotList(); });
    }
    loadPanorama(imgId);

    document.getElementById("reloadBtn").addEventListener("click", function () {
      imgId = document.getElementById("imgIdInput").value.trim() || "lote-muestra";
      loadPanorama(imgId);
    });

    // ---------- Estado de dibujo / edición ----------
    var currentPoints = [];   // Vector3[] del lote que se está dibujando o editando
    var markerMeshes = [];    // esferas blancas arrastrables, una por vértice
    var editingIndex = null;  // índice en savedLots si se está editando uno existente, o null si es nuevo
    var active = false;       // true mientras hay un dibujo/edición en curso
    var addingVertices = false; // true si un tap en área vacía agrega un vértice nuevo
    var previewGroup = new THREE.Group();
    scene.add(previewGroup);
    var previewLine = null;

    var startDrawBtn = document.getElementById("startDraw");
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

    function renderSavedLot(idx) {
      // (re)dibuja el relleno+contorno de un lote guardado; se omite el que está en edición.
      if (idx === editingIndex) return;
      var lot = savedLots[idx];
      if (!lot.poligono || lot.poligono.length < 3) return;
      var visuals = window.PanoCore.buildLotVisuals(lot);
      savedGroup.add(visuals.fillMesh);
      savedGroup.add(visuals.outline);
    }
    function rebuildSavedGroup() {
      while (savedGroup.children.length) {
        var c = savedGroup.children.pop();
        c.geometry.dispose(); c.material.dispose();
      }
      savedLots.forEach(function (_, idx) { renderSavedLot(idx); });
    }

    function setButtonsForNew() {
      startDrawBtn.disabled = false;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = true;
      addLotBtn.disabled = true;
      addLotBtn.textContent = "Agregar lote a la lista";
      drawStatus.classList.remove("active");
    }

    function beginNewLot() {
      active = true; addingVertices = true; editingIndex = null;
      clearDraft();
      document.getElementById("fNombre").value = "";
      document.getElementById("fArea").value = "";
      document.getElementById("fDesc").value = "";
      document.getElementById("fCaract").value = "";
      drawStatus.classList.add("active");
      startDrawBtn.disabled = true;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = false;
      addLotBtn.disabled = true;
      addLotBtn.textContent = "Agregar lote a la lista";
      rebuildSavedGroup();
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
      finishDrawBtn.disabled = true; // ya está "cerrado"; solo se arrastran puntos o se guarda
      cancelDrawBtn.disabled = false;
      addLotBtn.disabled = false;
      addLotBtn.textContent = "Guardar cambios";
      rebuildSavedGroup(); // oculta el lote en edición de la vista "guardada"
    }

    function endEditing() {
      active = false; addingVertices = false; editingIndex = null;
      clearDraft();
      setButtonsForNew();
      rebuildSavedGroup();
    }

    startDrawBtn.addEventListener("click", beginNewLot);
    cancelDrawBtn.addEventListener("click", endEditing);

    finishDrawBtn.addEventListener("click", function () {
      addingVertices = false;
      finishDrawBtn.disabled = true;
      addLotBtn.disabled = currentPoints.length < 3;
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

      endEditing();
      renderLotList();
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
        item.innerHTML = "<div>" + lot.nombre + "<br><span>" + lot.poligono.length + " vértices · " + (lot.area || "sin área") + "</span></div>";
        var actions = document.createElement("div");
        actions.style.display = "flex";
        var edit = document.createElement("button");
        edit.className = "x"; edit.textContent = "✏️"; edit.title = "Editar puntos y datos";
        edit.addEventListener("click", function () { beginEditLot(idx); });
        var del = document.createElement("button");
        del.className = "x"; del.textContent = "×"; del.title = "Eliminar lote";
        del.addEventListener("click", function () {
          if (editingIndex === idx) endEditing();
          savedLots.splice(idx, 1);
          renderLotList();
          rebuildSavedGroup();
        });
        actions.appendChild(edit); actions.appendChild(del);
        item.appendChild(actions);
        list.appendChild(item);
      });
    }
    renderLotList();

    // ---------- Interacción: agregar vértice (tap) o arrastrar un vértice existente ----------
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var draggingMarker = null; // mesh que se está arrastrando, o null
    var downInfo = null;       // {x,y} del pointerdown, para distinguir tap de arrastre

    renderer.domElement.addEventListener("pointerdown", function (e) {
      downInfo = { x: e.clientX, y: e.clientY };
      if (!active) return;
      var hitMarker = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, markerMeshes);
      if (hitMarker) {
        draggingMarker = hitMarker.object;
        controls.enabled = false; // evita que la cámara rote mientras se arrastra el punto
      }
    });

    renderer.domElement.addEventListener("pointermove", function (e) {
      if (!draggingMarker) return;
      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, [pickingSphere]);
      if (!hit) return;
      var idx = markerMeshes.indexOf(draggingMarker);
      draggingMarker.position.copy(hit.point);
      currentPoints[idx] = hit.point.clone();
      redrawLine();
    });

    renderer.domElement.addEventListener("pointerup", function (e) {
      if (draggingMarker) {
        draggingMarker = null;
        controls.enabled = true;
        downInfo = null; // fue un arrastre, no debe contarse como tap
        return;
      }
      if (!downInfo) return;
      var dx = e.clientX - downInfo.x, dy = e.clientY - downInfo.y;
      downInfo = null;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) return; // fue un arrastre de cámara, no un tap
      if (!active || !addingVertices) return;
      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, [pickingSphere]);
      if (!hit) return;
      currentPoints.push(hit.point.clone());
      addMarker(hit.point.clone());
      redrawLine();
      finishDrawBtn.disabled = currentPoints.length < 3;
    });

    // ---------- Descargar JSON ----------
    document.getElementById("downloadBtn").addEventListener("click", function () {
      var payload = {
        titulo: document.getElementById("fTitulo").value.trim() || undefined,
        lotes: savedLots
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
    });

    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();
  }

  return { init: init };
})();
