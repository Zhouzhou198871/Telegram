import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const host = document.getElementById("astronautStage");
if (host) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(max-width: 760px)").matches;
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: mobile ? "high-performance" : "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.35 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = true;
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.48;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(29, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(0, 0.12, mobile ? 6.8 : 5.35);
    const ambient = new THREE.AmbientLight(0xffffff, 1.85); scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xdce5f0, 2.55); scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfffdf8, 2.8); key.position.set(3.5, 6, 5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.00018; key.shadow.normalBias = 0.025;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 24;
    key.shadow.camera.left = -5; key.shadow.camera.right = 5; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    scene.add(key); scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xeaf3ff, 1.65); fill.position.set(-4, 2, 4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0x8fcaff, 2.65); rim.position.set(-4, 2.2, -3); scene.add(rim);
    const frontRim = new THREE.DirectionalLight(0xb8dcff, 1.15); frontRim.position.set(4, 1.2, 3); scene.add(frontRim);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTarget = pmrem.fromScene(room, 0.04);
    scene.environment = envTarget.texture;
    pmrem.dispose();
    const pivot = new THREE.Group(); scene.add(pivot);
    const createFallbackAstronaut = () => {
      const group = new THREE.Group();
      const suit = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.72, metalness: 0.08 });
      const trim = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.38, metalness: 0.25 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x10284f, roughness: 0.22, metalness: 0.18 });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x173b70, roughness: 0.12, metalness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xf2bd62, metalness: 0.65, roughness: 0.28 });
      const add = (geometry, material, x, y, z, sx=1, sy=1, sz=1, rz=0) => {
        const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); mesh.rotation.z=rz; group.add(mesh); return mesh;
      };
      add(new THREE.CapsuleGeometry(0.43,0.78,7,16),suit,0,0.05,0,1,1,0.78);
      add(new THREE.BoxGeometry(0.66,0.9,0.42),dark,0,0.12,-0.43);
      add(new THREE.BoxGeometry(0.58,0.72,0.16),suit,0,0.12,-0.68);
      add(new THREE.TorusGeometry(0.43,0.085,12,32),trim,0,0.88,0,1,1,0);
      add(new THREE.SphereGeometry(0.53,32,24),suit,0,1.35,0,1,1,0.96);
      add(new THREE.SphereGeometry(0.385,32,24),glass,0,1.36,0.39,1,0.77,0.30);
      add(new THREE.TorusGeometry(0.39,0.035,10,32),trim,0,1.36,0.42,1,0.78,0);
      add(new THREE.BoxGeometry(0.32,0.23,0.06),trim,0,0.28,0.34);
      add(new THREE.BoxGeometry(0.22,0.10,0.035),dark,0,0.29,0.39);
      add(new THREE.CircleGeometry(0.045,16),gold,-0.08,0.29,0.415);
      add(new THREE.CylinderGeometry(0.17,0.20,0.72,16),suit,-0.62,0.23,0,0.82,1,0.82,0.28);
      add(new THREE.CylinderGeometry(0.17,0.20,0.72,16),suit,0.62,0.23,0,0.82,1,0.82,-0.28);
      add(new THREE.SphereGeometry(0.19,18,14),trim,-0.86,-0.17,0.02,1,0.9,0.85);
      add(new THREE.SphereGeometry(0.19,18,14),trim,0.86,-0.17,0.02,1,0.9,0.85);
      add(new THREE.CylinderGeometry(0.23,0.25,0.76,16),suit,-0.25,-0.86,0,1,1,0.9,-0.06);
      add(new THREE.CylinderGeometry(0.23,0.25,0.76,16),suit,0.25,-0.86,0,1,1,0.9,0.06);
      add(new THREE.BoxGeometry(0.48,0.22,0.48),dark,-0.25,-1.32,0.08);
      add(new THREE.BoxGeometry(0.48,0.22,0.48),dark,0.25,-1.32,0.08);
      add(new THREE.BoxGeometry(0.10,0.38,0.12),trim,-0.63,0.30,0.02);
      add(new THREE.BoxGeometry(0.10,0.38,0.12),trim,0.63,0.30,0.02);
      add(new THREE.TorusGeometry(0.16,0.025,8,24),gold,0.28,0.08,0.42,1,1,0);
      group.scale.setScalar(1.12);
      return group;
    };
    const fallbackAstronaut = createFallbackAstronaut();
    pivot.add(fallbackAstronaut);
    host.classList.add("model-fallback");
    let mixer = null, modelReady = true;
    const loader = new GLTFLoader();    loader.load("https://modelviewer.dev/shared-assets/models/Astronaut.glb", (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const longest = Math.max(size.x, size.y, size.z);
      model.scale.setScalar(4.55 / Math.max(longest, 0.001));
      model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((mat) => {
            if ("envMapIntensity" in mat) mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, 1.65);
            if ("roughness" in mat) mat.roughness = Math.min(mat.roughness ?? 0.7, mat.metalness > 0.35 ? 0.32 : 0.68);
            if ("metalness" in mat && mat.metalness > 0.15) mat.metalness = Math.max(mat.metalness, 0.35);
            mat.needsUpdate = true;
          });
        }
      });
      pivot.remove(fallbackAstronaut);
      pivot.add(model);
      host.classList.remove("model-fallback");
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      }
      modelReady = true; host.classList.add("is-ready");
      host.setAttribute("aria-label", "可交互的 3D 宇航员模型");
    }, undefined, (error) => { console.warn("Google Model Viewer Astronaut GLB unavailable; keeping the generated 3D astronaut fallback:", error); host.classList.add("model-fallback"); });

    let targetX = 0, targetY = 0, smoothX = 0, smoothY = 0, dragging = false, lastX = 0, lastY = 0, dragYaw = 0, dragPitch = 0;
    host.addEventListener("pointermove", (event) => {
      if (matchMedia("(max-width: 760px)").matches) return;
      const rect = host.getBoundingClientRect();
      targetY = ((event.clientX - rect.left) / rect.width - 0.5) * 0.085;
      targetX = ((event.clientY - rect.top) / rect.height - 0.5) * 0.042;
      if (dragging) { dragYaw = THREE.MathUtils.clamp(dragYaw + (event.clientX - lastX) * 0.0018, -0.12, 0.12); dragPitch = THREE.MathUtils.clamp(dragPitch + (event.clientY - lastY) * 0.0012, -0.06, 0.06); lastX = event.clientX; lastY = event.clientY; }
    }, { passive: true });
    host.addEventListener("pointerdown", (event) => { if (matchMedia("(max-width: 760px)").matches) return; dragging = true; lastX = event.clientX; lastY = event.clientY; host.setPointerCapture?.(event.pointerId); });
    const stopDrag = () => { dragging = false; };
    host.addEventListener("pointerup", stopDrag); host.addEventListener("pointercancel", stopDrag);
    host.addEventListener("pointerleave", () => { if (!dragging) { targetX = 0; targetY = 0; dragYaw *= 0.92; dragPitch *= 0.92; } });

    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      const isMobile = matchMedia("(max-width: 760px)").matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.35 : 2));
      renderer.setSize(width, height, false); camera.aspect = width / height;
      camera.position.z = isMobile ? 7.2 : 5.35; camera.fov = isMobile ? 31 : 29; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    let frame = 0; const clock = new THREE.Clock();
    const animate = () => {
      if (document.hidden) { frame = 0; return; }
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05), elapsed = clock.elapsedTime;
      if (mixer) mixer.update(dt);
      if (modelReady) {
        pivot.position.y = Math.sin(elapsed * 1.05) * (reduced ? 0 : 0.16);
        if (!reduced) smoothY += (targetY + dragYaw - smoothY) * (1 - Math.exp(-dt * 3.2));
        smoothX += (targetX + dragPitch - smoothX) * (1 - Math.exp(-dt * 3.2));
        pivot.rotation.y = Math.sin(elapsed * 0.22) * 0.10 + smoothY;
        pivot.rotation.x = Math.sin(elapsed * 0.16) * 0.025 + smoothX;
      }
      renderer.render(scene, camera);
    };
    const start = () => { if (!frame && !document.hidden) animate(); };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
    start(); window.addEventListener("resize", resize, { passive: true });
  } catch (error) { console.error("3D astronaut renderer initialization failed:", error); host.classList.add("model-error"); }
}