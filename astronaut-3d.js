import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const host = document.getElementById("astronautStage");
if (host) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(max-width: 760px)").matches;
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !mobile, powerPreference: mobile ? "low-power" : "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.15 : 1.65));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(0, 0.15, 7.4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aacc8, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.1); key.position.set(3, 5, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x74baff, 2.2); rim.position.set(-4, 1, -3); scene.add(rim);
    const pivot = new THREE.Group(); scene.add(pivot);
    const loader = new GLTFLoader();
    let mixer = null, modelReady = false;
    loader.load("https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Astronaut/Astronaut.glb", (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const longest = Math.max(size.x, size.y, size.z);
      model.scale.setScalar(3.45 / Math.max(longest, 0.001));
      pivot.add(model);
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      }
      modelReady = true; host.classList.add("is-ready");
      host.setAttribute("aria-label", "可交互的 3D 宇航员模型");
    }, undefined, (error) => { console.error("3D astronaut model failed to load:", error); host.classList.add("model-error"); });

    let targetX = 0, targetY = 0, dragging = false, lastX = 0, lastY = 0, dragYaw = 0, dragPitch = 0;
    host.addEventListener("pointermove", (event) => {
      if (matchMedia("(max-width: 760px)").matches) return;
      const rect = host.getBoundingClientRect();
      targetY = ((event.clientX - rect.left) / rect.width - 0.5) * 0.42;
      targetX = ((event.clientY - rect.top) / rect.height - 0.5) * 0.22;
      if (dragging) { dragYaw += (event.clientX - lastX) * 0.009; dragPitch += (event.clientY - lastY) * 0.006; lastX = event.clientX; lastY = event.clientY; }
    }, { passive: true });
    host.addEventListener("pointerdown", (event) => { if (matchMedia("(max-width: 760px)").matches) return; dragging = true; lastX = event.clientX; lastY = event.clientY; host.setPointerCapture?.(event.pointerId); });
    const stopDrag = () => { dragging = false; };
    host.addEventListener("pointerup", stopDrag); host.addEventListener("pointercancel", stopDrag);
    host.addEventListener("pointerleave", () => { if (!dragging) { targetX = 0; targetY = 0; } });

    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      const isMobile = matchMedia("(max-width: 760px)").matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.15 : 1.65));
      renderer.setSize(width, height, false); camera.aspect = width / height;
      camera.position.z = isMobile ? 8.3 : 7.4; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    let frame = 0; const clock = new THREE.Clock();
    const animate = () => {
      if (document.hidden) { frame = 0; return; }
      frame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime(), dt = Math.min(clock.getDelta(), 0.05);
      if (mixer) mixer.update(dt);
      if (modelReady) {
        pivot.position.y = Math.sin(elapsed * 1.05) * (reduced ? 0 : 0.12);
        if (!reduced) pivot.rotation.y += 0.0028;
        pivot.rotation.y += (targetY + dragYaw - pivot.rotation.y) * 0.035;
        pivot.rotation.x += (targetX + dragPitch - pivot.rotation.x) * 0.035;
      }
      renderer.render(scene, camera);
    };
    const start = () => { if (!frame && !document.hidden) animate(); };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
    start(); window.addEventListener("resize", resize, { passive: true });
  } catch (error) { console.error("3D astronaut renderer initialization failed:", error); host.classList.add("model-error"); }
}