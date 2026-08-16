window.produtoModel = (function () {
    var state = null;

    function sizeOf(canvas) {
        var rect = canvas.getBoundingClientRect();
        return {
            cssWidth: Math.max(1, rect.width),
            cssHeight: Math.max(1, rect.height)
        };
    }

    function dispose() {
        if (!state)
            return;

        cancelAnimationFrame(state.raf);
        state.resizeObserver && state.resizeObserver.disconnect();
        window.removeEventListener('resize', state.onResize);
        state.controls && state.controls.dispose();
        state.renderer && state.renderer.dispose();
        if (state.scene) {
            state.scene.traverse(function (obj) {
                if (obj.geometry)
                    obj.geometry.dispose();
                if (obj.material) {
                    var materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach(function (m) {
                        if (m.map)
                            m.map.dispose();
                        m.dispose && m.dispose();
                    });
                }
            });
        }
        state = null;
    }

    async function mount(canvas, modelUrl) {
        dispose();
        if (!canvas)
            return;

        var THREE = await import('three');
        var addons = await import('three/addons/loaders/GLTFLoader.js');
        var controlsMod = await import('three/addons/controls/OrbitControls.js');
        var dracoMod = await import('three/addons/loaders/DRACOLoader.js');

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe2e2e2);

        var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;

        var controls = new controlsMod.OrbitControls(camera, canvas);
        controls.enableDamping = false;
        controls.autoRotate = false;
        controls.enableRotate = false;
        controls.enableZoom = false;
        controls.enablePan = false;

        scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.1));
        var key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(2, 4, 6);
        key.castShadow = true;
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-3, 1, 2);
        scene.add(fill);

        var modelSize = null;

        function frameModel() {
            var s = sizeOf(canvas);
            renderer.setSize(s.cssWidth, s.cssHeight, false);
            camera.aspect = s.cssWidth / s.cssHeight;

            if (!modelSize)
                return;

            var fov = camera.fov * Math.PI / 180;
            var fitH = modelSize.y;
            var fitW = modelSize.x / camera.aspect;
            var dist = (Math.max(fitH, fitW) * 0.5) / Math.tan(fov * 0.5);
            camera.position.set(0, 0, Math.max(dist * 1.2, 0.01));
            camera.near = dist / 100;
            camera.far = Math.max(dist * 50, 10);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();
            controls.target.set(0, 0, 0);
            controls.update();
        }

        frameModel();

        var loader = new addons.GLTFLoader();
        var draco = new dracoMod.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
        loader.setDRACOLoader(draco);

        var gltf = await loader.loadAsync(modelUrl);
        var model = gltf.scene;
        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });

        var box = new THREE.Box3();
        model.updateMatrixWorld(true);
        model.traverse(function (obj) {
            if (obj.isMesh)
                box.expandByObject(obj);
        });
        if (box.isEmpty())
            box.setFromObject(model);

        model.position.sub(box.getCenter(new THREE.Vector3()));
        model.rotation.y = Math.PI;
        model.updateMatrixWorld(true);
        scene.add(model);

        box.makeEmpty();
        model.traverse(function (obj) {
            if (obj.isMesh)
                box.expandByObject(obj);
        });
        modelSize = box.getSize(new THREE.Vector3());
        frameModel();

        function tick() {
            if (!state)
                return;
            renderer.render(scene, camera);
            state.raf = requestAnimationFrame(tick);
        }

        var onResize = function () { frameModel(); };
        var resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(canvas);
        window.addEventListener('resize', onResize);

        state = {
            scene: scene,
            camera: camera,
            renderer: renderer,
            controls: controls,
            raf: 0,
            onResize: onResize,
            resizeObserver: resizeObserver
        };

        tick();
    }

    return { mount: mount, dispose: dispose };
})();
