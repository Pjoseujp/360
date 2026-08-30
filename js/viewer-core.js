// js/viewer-core.js
// Lógica compartida entre el modo cliente y el modo administrador:
// motor 3D, carga del panorama y construcción de los polígonos de lotes.
window.PanoCore = (function () {
  "use strict";

  var RADIUS_PANO = 500;   // radio de la esfera panorámica
  var RADIUS_POLY = 496;   // radio de los polígonos (ligeramente dentro, evita z-fighting)
  var INITIAL_FOV = 75;    // FOV inicial: no arranca en el zoom más alejado posible
  var MIN_FOV = 35;        // más zoom (acercar)
  var MAX_FOV = 100;       // menos zoom (alejar)

  // Convención de coordenadas:
  //   pitch: -90 (abajo) .. 90 (arriba), 0 = horizonte
  //   yaw:   -180 .. 180, 0 = frente de la imagen
  function pitchYawToVector(pitch, yaw, radius) {
    var phi = THREE.MathUtils.degToRad(90 - pitch);
    var theta = THREE.MathUtils.degToRad(yaw);
    return new THREE.Vector3(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
  }

  function vectorToPitchYaw(v) {
    var r = v.length();
    var pitch = 90 - THREE.MathUtils.radToDeg(Math.acos(v.y / r));
    var yaw = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z));
    return { pitch: pitch, yaw: yaw };
  }

  // Crea escena, cámara, renderer y controles de órbita listos para un panorama 360.
  function createEngine(container) {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(
      INITIAL_FOV, container.clientWidth / container.clientHeight, 0.1, 1200
    );
    camera.position.set(0, 0, 0.01);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -1);
    controls.enablePan = false;
    controls.enableZoom = false; // el zoom se maneja como FOV (wheel + pinch)
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = -0.35;
    controls.minDistance = controls.maxDistance = 0.01;

    function onResize() {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    window.addEventListener("resize", onResize);

    return { scene: scene, camera: camera, renderer: renderer, controls: controls, onResize: onResize };
  }

  // Zoom con rueda del mouse (desktop).
  function attachWheelZoom(renderer, camera, minFov, maxFov) {
    minFov = minFov || MIN_FOV; maxFov = maxFov || MAX_FOV;
    renderer.domElement.addEventListener("wheel", function (e) {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, minFov, maxFov);
      camera.updateProjectionMatrix();
    }, { passive: false });
  }

  // Zoom con gesto de pellizco (pinch) en pantallas táctiles.
  function attachTouchPinchZoom(renderer, camera, minFov, maxFov) {
    minFov = minFov || MIN_FOV; maxFov = maxFov || MAX_FOV;
    var lastDist = null;
    function dist(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    var el = renderer.domElement;
    el.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) lastDist = dist(e.touches);
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var d = dist(e.touches);
        if (lastDist != null) {
          var delta = lastDist - d; // dedos separándose (d crece) => acercar (bajar fov)
          camera.fov = THREE.MathUtils.clamp(camera.fov + delta * 0.15, minFov, maxFov);
          camera.updateProjectionMatrix();
        }
        lastDist = d;
      }
    }, { passive: false });
    el.addEventListener("touchend", function (e) {
      if (e.touches.length < 2) lastDist = null;
    }, { passive: true });
  }

  // Carga la textura del panorama con la configuración de calidad y color correctas.
  function loadPanoramaTexture(url, renderer, onLoaded, onError) {
    var loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";
    loader.load(url, function (texture) {
      texture.encoding = THREE.sRGBEncoding;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;
      onLoaded(texture);
    }, undefined, onError);
  }

  // Construye la esfera panorámica visible.
  // IMPORTANTE: se usa geometry.scale(-1,1,1) (en vez de material.side = BackSide) para
  // ver la imagen desde adentro SIN que quede espejada/invertida.
  function buildPanoramaSphere(texture) {
    var geo = new THREE.SphereGeometry(RADIUS_PANO, 64, 48);
    geo.scale(-1, 1, 1);
    var mat = new THREE.MeshBasicMaterial({ map: texture });
    return new THREE.Mesh(geo, mat);
  }

  // Esfera invisible (pero raycasteable) usada como superficie de referencia para
  // ubicar vértices con precisión, independientemente de si la textura ya cargó.
  function createPickingSphere() {
    var geo = new THREE.SphereGeometry(RADIUS_POLY, 48, 32);
    var mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    return mesh;
  }

  // Construye el relleno (abanico de triángulos) y el contorno de un lote.
  function buildLotVisuals(lot) {
    var verts = lot.poligono.map(function (p) {
      return pitchYawToVector(p.pitch, p.yaw, RADIUS_POLY);
    });
    var centroid = new THREE.Vector3();
    verts.forEach(function (v) { centroid.add(v); });
    centroid.divideScalar(verts.length);
    centroid.setLength(RADIUS_POLY);

    var positions = [];
    for (var i = 0; i < verts.length; i++) {
      var a = verts[i], b = verts[(i + 1) % verts.length];
      positions.push(centroid.x, centroid.y, centroid.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    var fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    fillGeo.computeVertexNormals();

    var baseColor = lot.color || "#2ecc71";
    var fillMat = new THREE.MeshBasicMaterial({
      color: baseColor, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false
    });
    var fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.userData.lot = lot;
    fillMesh.userData.centroid = centroid;
    fillMesh.userData.baseOpacity = 0.32;
    fillMesh.userData.hoverOpacity = 0.62;

    var outlinePts = verts.concat([verts[0]]);
    var outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
    var outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    var outline = new THREE.LineLoop(outlineGeo, outlineMat);

    return { fillMesh: fillMesh, outline: outline, centroid: centroid };
  }

  // Convierte una posición de mouse/touch en coordenadas normalizadas y devuelve
  // el primer objeto intersectado de la lista dada.
  function pickObject(clientX, clientY, renderer, camera, raycaster, mouseVec, objects) {
    var rect = renderer.domElement.getBoundingClientRect();
    mouseVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    var hits = raycaster.intersectObjects(objects);
    return hits.length ? hits[0] : null;
  }

  // Proyecta un punto 3D a coordenadas de pantalla (px), relativas al contenedor del renderer.
  function worldToScreen(vector3, camera, renderer) {
    var v = vector3.clone().project(camera);
    var rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height,
      behind: v.z > 1
    };
  }

  return {
    RADIUS_PANO: RADIUS_PANO,
    RADIUS_POLY: RADIUS_POLY,
    MIN_FOV: MIN_FOV,
    MAX_FOV: MAX_FOV,
    pitchYawToVector: pitchYawToVector,
    vectorToPitchYaw: vectorToPitchYaw,
    createEngine: createEngine,
    attachWheelZoom: attachWheelZoom,
    attachTouchPinchZoom: attachTouchPinchZoom,
    loadPanoramaTexture: loadPanoramaTexture,
    buildPanoramaSphere: buildPanoramaSphere,
    createPickingSphere: createPickingSphere,
    buildLotVisuals: buildLotVisuals,
    pickObject: pickObject,
    worldToScreen: worldToScreen
  };
})();
