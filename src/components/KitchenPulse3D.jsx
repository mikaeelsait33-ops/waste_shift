import { useEffect, useRef, useState } from 'react';

export default function KitchenPulse3D() {
  const canvasRef = useRef(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    let animationFrame = 0;
    let disposed = false;
    let renderer;
    let resizeObserver;
    let removePointerListeners = () => {};
    let disposeScene = () => {};

    const setupScene = async () => {
      try {
        const THREE = await import('three');
        const canvas = canvasRef.current;

        if (!canvas || disposed) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
        const pulseGroup = new THREE.Group();
        const pointer = { x: 0, y: 0 };
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        camera.position.set(0, 0.15, 7.2);
        scene.add(pulseGroup);

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;

        const plateMaterial = new THREE.MeshPhysicalMaterial({
          color: 0x171d18,
          roughness: 0.28,
          metalness: 0.72,
          clearcoat: 0.42,
          clearcoatRoughness: 0.22,
        });
        const rimMaterial = new THREE.MeshStandardMaterial({
          color: 0xd7ff4f,
          roughness: 0.34,
          metalness: 0.18,
          emissive: 0x2a3c09,
          emissiveIntensity: 0.34,
        });
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(1.88, 1.88, 0.18, 72),
          plateMaterial,
        );
        plate.rotation.x = Math.PI / 2;
        pulseGroup.add(plate);

        const outerRim = new THREE.Mesh(
          new THREE.TorusGeometry(1.91, 0.075, 18, 96),
          rimMaterial,
        );
        outerRim.position.z = 0.12;
        pulseGroup.add(outerRim);

        const innerRim = new THREE.Mesh(
          new THREE.TorusGeometry(1.46, 0.018, 12, 96),
          new THREE.MeshStandardMaterial({ color: 0x445048, roughness: 0.5, metalness: 0.42 }),
        );
        innerRim.position.z = 0.15;
        pulseGroup.add(innerRim);

        const ingredientGeometry = new THREE.SphereGeometry(0.48, 36, 24);
        const ingredientSpecs = [
          { color: 0xd7ff4f, position: [-0.66, 0.36, 0.34], scale: [1.15, 0.62, 0.35], rotation: -0.42 },
          { color: 0x65e0a3, position: [0.58, 0.42, 0.32], scale: [0.92, 0.72, 0.34], rotation: 0.5 },
          { color: 0xff6b5d, position: [0.04, -0.62, 0.35], scale: [1.28, 0.52, 0.32], rotation: 0.08 },
        ];

        ingredientSpecs.forEach((spec) => {
          const ingredient = new THREE.Mesh(
            ingredientGeometry,
            new THREE.MeshPhysicalMaterial({
              color: spec.color,
              roughness: 0.3,
              metalness: 0.08,
              clearcoat: 0.6,
              clearcoatRoughness: 0.2,
            }),
          );
          ingredient.position.set(...spec.position);
          ingredient.scale.set(...spec.scale);
          ingredient.rotation.z = spec.rotation;
          pulseGroup.add(ingredient);
        });

        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(2.36, 0.014, 10, 120),
          new THREE.MeshBasicMaterial({ color: 0x65736a, transparent: true, opacity: 0.48 }),
        );
        halo.position.z = -0.12;
        pulseGroup.add(halo);

        scene.add(new THREE.HemisphereLight(0xf4f6f1, 0x111612, 2.2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 4.4);
        keyLight.position.set(-3.8, 4.2, 5.8);
        scene.add(keyLight);
        const limeLight = new THREE.PointLight(0xd7ff4f, 8.5, 8);
        limeLight.position.set(3.2, -1.8, 4.6);
        scene.add(limeLight);
        const coralLight = new THREE.PointLight(0xff6b5d, 4.5, 7);
        coralLight.position.set(-3.4, -2.2, 3.1);
        scene.add(coralLight);

        disposeScene = () => {
          scene.traverse((object) => {
            object.geometry?.dispose?.();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach((material) => material.dispose?.());
          });
        };

        const resize = () => {
          const parent = canvas.parentElement;
          if (!parent) return;
          const width = Math.max(parent.clientWidth, 1);
          const height = Math.max(parent.clientHeight, 1);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        };

        const handlePointerMove = (event) => {
          const rect = canvas.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
          pointer.y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
        };
        const handlePointerLeave = () => {
          pointer.x = 0;
          pointer.y = 0;
        };

        canvas.addEventListener('pointermove', handlePointerMove, { passive: true });
        canvas.addEventListener('pointerleave', handlePointerLeave, { passive: true });
        removePointerListeners = () => {
          canvas.removeEventListener('pointermove', handlePointerMove);
          canvas.removeEventListener('pointerleave', handlePointerLeave);
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas.parentElement);
        resize();

        const startedAt = window.performance.now();
        const renderFrame = (now) => {
          if (disposed) return;
          const elapsed = (now - startedAt) / 1000;
          pulseGroup.rotation.x += ((pointer.y * -0.12) - pulseGroup.rotation.x) * 0.035;
          pulseGroup.rotation.y += ((pointer.x * 0.16) - pulseGroup.rotation.y) * 0.035;
          pulseGroup.rotation.z = Math.sin(elapsed * 0.42) * 0.035;
          pulseGroup.position.y = Math.sin(elapsed * 0.7) * 0.06;
          renderer.render(scene, camera);

          if (!reducedMotion) {
            animationFrame = window.requestAnimationFrame(renderFrame);
          }
        };

        renderFrame(startedAt);
      } catch (error) {
        console.warn('3D kitchen pulse unavailable.', error);
        setShowFallback(true);
      }
    };

    setupScene();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      removePointerListeners();
      resizeObserver?.disconnect();
      disposeScene();
      renderer?.dispose();
    };
  }, []);

  return (
    <div className={`kitchen-pulse${showFallback ? ' is-fallback' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="kitchen-pulse__canvas" />
      {showFallback && <span className="kitchen-pulse__fallback">WS</span>}
    </div>
  );
}
