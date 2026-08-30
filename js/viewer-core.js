// js/viewer-core.js
// Lógica compartida entre el modo cliente y el modo administrador:
// motor 3D, carga del panorama y construcción de los polígonos de lotes.
window.PanoCore = (function () {
  "use strict";

  var RADIUS_PANO = 500;   // radio de la esfera panorámica
  var RADIUS_POLY = 496;   // radio de los polígonos (ligeramente dentro, evita z-fighting)

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
      90, container.clientWidth / container.clientHeight, 0.1, 1200
    );
    camera.position.set(0, 0, 0.01);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    // outputEncoding correcto para que los colores del panorama se vean fieles al original
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -1);
    controls.enablePan = false;
    controls.enableZoom = false; // el zoom se maneja como FOV (ver attachWheelZoom)
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

  function attachWheelZoom(renderer, camera, minFov, maxFov) {
    minFov = minFov || 35; maxFov = maxFov || 100;
    renderer.domElement.addEventListener("wheel", function (e) {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, minFov, maxFov);
      camera.updateProjectionMatrix();
    }, { passive: false });
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

  // Construye la esfera panorámica.
  // IMPORTANTE: se usa geometry.scale(-1,1,1) (en vez de material.side = BackSide) para
  // ver la imagen desde adentro SIN que quede espejada/invertida.
  function buildPanoramaSphere(texture) {
    var geo = new THREE.SphereGeometry(RADIUS_PANO, 64, 48);
    geo.scale(-1, 1, 1);
    var mat = new THREE.MeshBasicMaterial({ map: texture });
    return new THREE.Mesh(geo, mat);
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
    fillMesh.userData.baseOpacity = 0.32;
    fillMesh.userData.hoverOpacity = 0.62;

    var outlinePts = verts.concat([verts[0]]);
    var outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
    var outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    var outline = new THREE.LineLoop(outlineGeo, outlineMat);

    return { fillMesh: fillMesh, outline: outline };
  }

  // Convierte una posición de mouse/click en coordenadas normalizadas y devuelve
  // el primer objeto intersectado de la lista dada.
  function pickObject(clientX, clientY, renderer, camera, raycaster, mouseVec, objects) {
    var rect = renderer.domElement.getBoundingClientRect();
    mouseVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    var hits = raycaster.intersectObjects(objects);
    return hits.length ? hits[0] : null;
  }

  return {
    RADIUS_PANO: RADIUS_PANO,
    RADIUS_POLY: RADIUS_POLY,
    pitchYawToVector: pitchYawToVector,
    vectorToPitchYaw: vectorToPitchYaw,
    createEngine: createEngine,
    attachWheelZoom: attachWheelZoom,
    loadPanoramaTexture: loadPanoramaTexture,
    buildPanoramaSphere: buildPanoramaSphere,
    buildLotVisuals: buildLotVisuals,
    pickObject: pickObject
  };
})();
