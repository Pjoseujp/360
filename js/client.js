// js/client.js
// Modo cliente: muestra el panorama y los lotes, con hover y popup de información.
window.PanoClient = (function () {
  "use strict";

  function init(imgId) {
    var container = document.getElementById("viewer");
    var loadingEl = document.getElementById("loading");
    var errorEl = document.getElementById("error");
    var errorMsg = document.getElementById("error-msg");

    var imageUrl = "images/" + imgId + ".webp";
    var dataUrl = "data/" + imgId + ".json";

    fetch(dataUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('No se encontró "' + dataUrl + '"');
        return r.json();
      })
      .then(function (data) { start(data); })
      .catch(function (err) {
        console.error(err);
        errorMsg.textContent = err.message + ". Revisa que el archivo exista en el repositorio.";
        errorEl.classList.add("visible");
        loadingEl.classList.add("hidden");
      });

    function start(data) {
      document.getElementById("hud-title").textContent = data.titulo || "Visualizador de lote";

      var engine = window.PanoCore.createEngine(container);
      var scene = engine.scene, camera = engine.camera, renderer = engine.renderer, controls = engine.controls;
      window.PanoCore.attachWheelZoom(renderer, camera);

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

      renderer.domElement.addEventListener("click", function (e) {
        var hit = window.PanoCore.pickObject(e.clientX, e.clientY, renderer, camera, raycaster, mouse, lotMeshes);
        if (hit) showPopup(hit.object.userData.lot);
      });

      function showPopup(lot) {
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
        popup.classList.add("visible");
      }
      document.getElementById("popup-close").addEventListener("click", function () {
        popup.classList.remove("visible");
      });

      (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      })();
    }
  }

  return { init: init };
})();
