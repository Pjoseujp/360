// js/admin.js
// Modo administrador: dibuja polígonos sobre el panorama y exporta el JSON del lote.
window.PanoAdmin = (function () {
  "use strict";

  function init(imgId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var panelSub = document.getElementById("panelSub");
    document.getElementById("imgIdInput").value = imgId;

    var engine = window.PanoCore.createEngine(container);
    var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
    window.PanoCore.attachWheelZoom(renderer, camera);

    var panoSphere = null;
    var savedLots = [];

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
        panelSub.textContent = 'No se encontró images/' + id + '.webp (puedes seguir dibujando sobre negro para pruebas).';
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

    // ---------- Dibujo de polígonos ----------
    var drawing = false;
    var currentPoints = [];
    var previewGroup = new THREE.Group();
    scene.add(previewGroup);

    var startDrawBtn = document.getElementById("startDraw");
    var finishDrawBtn = document.getElementById("finishDraw");
    var cancelDrawBtn = document.getElementById("cancelDraw");
    var addLotBtn = document.getElementById("addLotBtn");
    var drawStatus = document.getElementById("drawStatus");
    var vertCountEl = document.getElementById("vertCount");

    function clearPreview() {
      while (previewGroup.children.length) {
        var c = previewGroup.children.pop();
        c.geometry.dispose(); c.material.dispose();
      }
    }
    function redrawPreview() {
      clearPreview();
      currentPoints.forEach(function (p) {
        var dot = new THREE.Mesh(
          new THREE.SphereGeometry(3.2, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        dot.position.copy(p);
        previewGroup.add(dot);
      });
      if (currentPoints.length > 1) {
        var line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(currentPoints),
          new THREE.LineBasicMaterial({ color: 0xffffff })
        );
        previewGroup.add(line);
      }
    }

    startDrawBtn.addEventListener("click", function () {
      drawing = true;
      currentPoints = [];
      redrawPreview();
      drawStatus.classList.add("active");
      vertCountEl.textContent = "0";
      startDrawBtn.disabled = true;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = false;
      addLotBtn.disabled = true;
    });

    function stopDrawing() {
      drawing = false;
      currentPoints = [];
      clearPreview();
      drawStatus.classList.remove("active");
      startDrawBtn.disabled = false;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = true;
    }
    cancelDrawBtn.addEventListener("click", stopDrawing);

    finishDrawBtn.addEventListener("click", function () {
      drawing = false;
      drawStatus.classList.remove("active");
      startDrawBtn.disabled = false;
      finishDrawBtn.disabled = true;
      cancelDrawBtn.disabled = true;
      addLotBtn.disabled = false;
    });

    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    renderer.domElement.addEventListener("click", function (e) {
      if (!drawing || !panoSphere) return;
      var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, [panoSphere]);
      if (!hit) return;
      var vertex = hit.point.clone().setLength(window.PanoCore.RADIUS_POLY);
      currentPoints.push(vertex);
      vertCountEl.textContent = String(currentPoints.length);
      finishDrawBtn.disabled = currentPoints.length < 3;
      redrawPreview();
    });

    // ---------- Agregar lote a la lista ----------
    addLotBtn.addEventListener("click", function () {
      var nombre = document.getElementById("fNombre").value.trim();
      if (!nombre) { alert("Escribe un nombre para el lote."); return; }
      var poligono = currentPoints.map(function (v) {
        var py = window.PanoCore.vectorToPitchYaw(v);
        return { pitch: Math.round(py.pitch * 100) / 100, yaw: Math.round(py.yaw * 100) / 100 };
      });
      var caract = document.getElementById("fCaract").value.split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);

      savedLots.push({
        id: "lote-" + (savedLots.length + 1),
        nombre: nombre,
        area: document.getElementById("fArea").value.trim(),
        descripcion: document.getElementById("fDesc").value.trim(),
        caracteristicas: caract,
        color: "#2ecc71",
        poligono: poligono
      });

      document.getElementById("fNombre").value = "";
      document.getElementById("fArea").value = "";
      document.getElementById("fDesc").value = "";
      document.getElementById("fCaract").value = "";
      currentPoints = [];
      clearPreview();
      addLotBtn.disabled = true;
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
        var x = document.createElement("button");
        x.className = "x"; x.textContent = "×"; x.title = "Eliminar lote";
        x.addEventListener("click", function () { savedLots.splice(idx, 1); renderLotList(); });
        item.appendChild(x);
        list.appendChild(item);
      });
    }
    renderLotList();

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
