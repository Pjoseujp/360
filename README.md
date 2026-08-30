# Visualizador inmobiliario 360°

Sitio para presentar terrenos/lotes a partir de fotos 360° tomadas con dron, con
polígonos interactivos superpuestos sobre cada lote.

## Estructura del repositorio

```
/
├── index.html
├── css/
│     styles.css
├── js/
│     viewer-core.js   → motor 3D compartido (proyección, panorama, polígonos)
│     client.js        → lógica del modo cliente (hover, popup)
│     admin.js         → lógica del modo administrador (dibujo, exportar JSON)
│     main.js          → arranque: decide modo cliente o administrador según la URL
├── images/
│     sv_sj1.webp      → foto 360 equirectangular (una por presentación)
├── data/
│     sv_sj1.json      → lotes/polígonos de esa imagen
```

**Regla de oro:** la imagen `images/NOMBRE.webp` y el archivo `data/NOMBRE.json`
deben tener siempre el mismo `NOMBRE`. Ese nombre es el valor del parámetro
`img` en la URL.

Hay un único `index.html`: el mismo archivo sirve tanto al cliente como al
administrador, y cambia de modo según el parámetro `mode` en la URL.

## Publicar en GitHub Pages

1. Sube esta carpeta a un repositorio de GitHub.
2. Ve a **Settings → Pages** y activa Pages sobre la rama `main` (carpeta raíz).
3. GitHub te dará una URL del tipo `https://tuusuario.github.io/turepo/`.

## Links

**Cliente:**
```
https://pjoseujp.github.io/360/index.html?img=sv_sj1
```

**Administrador** (mismo archivo, agrega `&mode=admin`):
```
https://pjoseujp.github.io/360/index.html?img=sv_sj1&mode=admin
```

Solo cambia `sv_sj1` por el nombre que quieras usar para cada panorama. Si no
se indica `?img=`, se usa `lote-muestra` por defecto (el ejemplo incluido).

## Cómo agregar un nuevo panorama

1. Sube la foto 360 equirectangular a `images/nombre-que-elijas.webp`.
2. Abre el link de administrador:
   ```
   .../index.html?img=nombre-que-elijas&mode=admin
   ```
3. En el panel derecho:
   - Confirma el nombre en **"Nombre de archivo (img)"** y pulsa **"Cargar panorama e imagen"**.
   - Pulsa **"+ Nuevo lote (dibujar)"** y haz clic sobre la imagen para marcar
     cada esquina del lote (mínimo 3 puntos). Arrastra para mirar alrededor
     mientras dibujas.
   - Pulsa **"Cerrar polígono"** al terminar de marcar los vértices.
   - Completa nombre, área, descripción y características, y pulsa
     **"Agregar lote a la lista"**.
   - Repite para cada lote visible en ese panorama.
4. Pulsa **"Descargar JSON"**. Esto descarga `nombre-que-elijas.json`.
5. Sube ese archivo a `data/nombre-que-elijas.json` en el repositorio (mismo
   nombre que la imagen).
6. El link del cliente `index.html?img=nombre-que-elijas` ya mostrará los
   polígonos dibujados.

> El editor intenta cargar automáticamente un `data/NOMBRE.json` existente al
> abrir un panorama, para seguir editando o agregando lotes a uno ya guardado.

## Formato del archivo JSON de un lote

```json
{
  "titulo": "Proyecto Vista Verde",
  "lotes": [
    {
      "id": "lote-01",
      "nombre": "Lote 1",
      "area": "850 m²",
      "descripcion": "Terreno esquinero con topografía plana...",
      "caracteristicas": ["Acceso pavimentado", "Agua y drenaje municipal"],
      "color": "#2ecc71",
      "poligono": [
        { "pitch": -8,  "yaw": 12 },
        { "pitch": -6,  "yaw": 34 },
        { "pitch": -18, "yaw": 30 },
        { "pitch": -20, "yaw": 8  }
      ]
    }
  ]
}
```

- `pitch` / `yaw`: coordenadas angulares del vértice sobre la esfera panorámica
  (no píxeles), por eso el polígono se mantiene fijo sobre el terreno sin
  importar hacia dónde mire la cámara.
- Un mismo panorama puede tener varios lotes: agrega más objetos dentro de `lotes`.

## Comportamiento del visor de cliente

- **Arrastrar** → mirar alrededor del panorama 360.
- **Rueda del mouse** → acercar / alejar (zoom óptico, no se mueve el punto de vista).
- **Pasar el mouse sobre un lote** → el polígono se ilumina.
- **Clic sobre un lote** → se abre un panel con nombre, área, descripción y
  características, con una "×" para cerrarlo.

## Sobre la imagen 360 (calidad y orientación)

- Se corrigió un problema de la primera versión que hacía ver la imagen
  **invertida/espejada**: ahora la esfera panorámica se construye con
  `geometry.scale(-1,1,1)` en vez del truco `material.side = BackSide`, que es
  la técnica estándar y correcta para ver un panorama desde adentro sin espejarlo.
- Se corrigió también el **color/calidad**: la versión anterior fijaba un
  `colorSpace` que no existe en la versión de three.js usada (no tenía efecto,
  dejando los colores apagados). Ahora se usa `texture.encoding` +
  `renderer.outputEncoding` correctamente, además de `anisotropy` para que la
  imagen se vea nítida incluso en ángulos oblicuos.
- Para mejores resultados con **.webp**: usa una imagen equirectangular
  (relación de aspecto 2:1) de buena resolución (por ejemplo 6000×3000 o
  4096×2048). Dimensiones que sean potencia de 2 (2048, 4096, 8192…) ayudan a
  que el navegador genere mipmaps de máxima calidad. `.webp` es compatible con
  todos los navegadores modernos (Chrome, Edge, Firefox, Safari 14+).

## Notas técnicas

- El visor está construido con **Three.js** (WebGL): el panorama es una
  esfera con la foto como textura interior, y cada polígono es una malla 3D
  real ubicada sobre esa esfera — por eso "sigue el terreno" perfectamente al
  mover la cámara, en vez de ser un dibujo 2D superpuesto.
- No requiere backend ni build: son archivos estáticos servibles desde GitHub
  Pages tal cual.
- El editor de administrador no se conecta a GitHub directamente (por
  seguridad, para no exponer credenciales en un sitio estático); genera el
  `.json` para que lo subas tú manualmente al repositorio.
