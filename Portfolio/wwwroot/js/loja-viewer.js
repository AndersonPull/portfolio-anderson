window.lojaViewer = (function () {
    var viewers = [];
    var mountGen = 0;
    var gltfCache = {};
    var loaderPromise = null;

    function sizeOf(canvas) {
        var rect = canvas.getBoundingClientRect();
        return {
            cssWidth: Math.max(1, rect.width),
            cssHeight: Math.max(1, rect.height)
        };
    }

    function isCompact() {
        var width = window.innerWidth || document.documentElement.clientWidth || 9999;
        var phone = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        return width <= 700 || (phone && width <= 1024);
    }

    function worldBox(obj, THREE) {
        obj.updateMatrixWorld(true);
        var box = new THREE.Box3();
        obj.traverse(function (child) {
            if (child.isMesh)
                box.expandByObject(child);
        });
        if (box.isEmpty())
            box.setFromObject(obj);
        return box;
    }

    function boxSize(root, THREE) {
        return worldBox(root, THREE).getSize(new THREE.Vector3());
    }

    async function getLoader() {
        if (loaderPromise)
            return loaderPromise;
        loaderPromise = (async function () {
            var THREE = await import('three');
            var addons = await import('three/addons/loaders/GLTFLoader.js');
            var controlsMod = await import('three/addons/controls/OrbitControls.js');
            var dracoMod = await import('three/addons/loaders/DRACOLoader.js');
            var loader = new addons.GLTFLoader();
            var draco = new dracoMod.DRACOLoader();
            draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
            loader.setDRACOLoader(draco);
            return { THREE: THREE, loader: loader, controlsMod: controlsMod };
        })();
        return loaderPromise;
    }

    function loadGltf(modelUrl) {
        if (!gltfCache[modelUrl]) {
            gltfCache[modelUrl] = getLoader().then(function (deps) {
                return deps.loader.loadAsync(modelUrl);
            }).catch(function (err) {
                delete gltfCache[modelUrl];
                console.error('lojaViewer load:', modelUrl, err);
                throw err;
            });
        }
        return gltfCache[modelUrl];
    }

    function preload() {
        var urls = Array.prototype.slice.call(arguments);
        if (urls.length === 1 && Array.isArray(urls[0]))
            urls = urls[0];
        urls.forEach(function (url) {
            if (url)
                loadGltf(url);
        });
    }

    function prepareRoot(gltfScene, THREE) {
        var root = new THREE.Group();
        var model = gltfScene.clone(true);
        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = false;
                obj.receiveShadow = false;
                obj.frustumCulled = false;
                var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(function (m) {
                    if (m)
                        m.side = THREE.DoubleSide;
                });
            }
        });
        model.updateMatrixWorld(true);
        var box = new THREE.Box3();
        model.traverse(function (obj) {
            if (obj.isMesh)
                box.expandByObject(obj);
        });
        if (box.isEmpty())
            box.setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        root.add(model);
        root.updateMatrixWorld(true);
        return root;
    }

    function disposeOne(entry) {
        if (!entry)
            return;
        cancelAnimationFrame(entry.raf);
        entry.resizeObserver && entry.resizeObserver.disconnect();
        window.removeEventListener('resize', entry.onResize);
        entry.controls && entry.controls.dispose();
        if (entry.renderer)
            entry.renderer.dispose();
    }

    function disposeAll() {
        viewers.forEach(disposeOne);
        viewers = [];
    }

    function dispose(canvas) {
        if (!canvas) {
            mountGen++;
            disposeAll();
            return;
        }
        viewers = viewers.filter(function (entry) {
            if (entry.canvas !== canvas)
                return true;
            disposeOne(entry);
            return false;
        });
    }

    async function mount(canvas, modelUrl, kind, preview) {
        if (!canvas)
            return;

        var gen = mountGen;
        if (!preview) {
            gen = ++mountGen;
            disposeAll();
        } else {
            dispose(canvas);
        }

        var deps = await getLoader();
        var gltf = await loadGltf(modelUrl);
        if (gen !== mountGen)
            return;

        if (!preview)
            disposeAll();

        var THREE = deps.THREE;
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(preview ? 0xf3f3f3 : 0xe2e2e2);

        var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
        var renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: !preview,
            alpha: false,
            powerPreference: 'high-performance'
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = false;

        var controls = new deps.controlsMod.OrbitControls(camera, canvas);
        controls.enableDamping = !preview;
        controls.dampingFactor = 0.08;
        controls.autoRotate = !!preview;
        controls.autoRotateSpeed = 1.4;
        controls.enableRotate = !preview;
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.rotateSpeed = 0.85;

        scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.25));
        var key = new THREE.DirectionalLight(0xffffff, 1.2);
        key.position.set(2, 4, 6);
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.45);
        fill.position.set(-3, 1, 2);
        scene.add(fill);

        var root = prepareRoot(gltf.scene, THREE);
        if (kind === 'controle')
            root.rotation.set(-0.22, 0.55, 0);
        else
            root.rotation.set(-0.18, 0.42, 0.04);
        root.updateMatrixWorld(true);

        var size0 = boxSize(root, THREE);
        var maxDim = Math.max(size0.x, size0.y, size0.z, 0.0001);
        root.scale.setScalar(1 / maxDim);
        root.updateMatrixWorld(true);
        var mid = worldBox(root, THREE).getCenter(new THREE.Vector3());
        root.position.sub(mid);
        root.updateMatrixWorld(true);
        scene.add(root);

        var entry = {
            canvas: canvas,
            renderer: renderer,
            controls: controls,
            raf: 0,
            userMoved: false,
            resizeObserver: null,
            onResize: null
        };
        viewers.push(entry);
        controls.addEventListener('start', function () {
            entry.userMoved = true;
        });

        function applySize() {
            var size = sizeOf(canvas);
            var dpr = Math.min(window.devicePixelRatio || 1, preview ? 1 : 1.5);
            renderer.setPixelRatio(dpr);
            renderer.setSize(size.cssWidth, size.cssHeight, false);
            camera.aspect = size.cssWidth / size.cssHeight;
            camera.updateProjectionMatrix();
            if (!entry.userMoved && size.cssWidth > 8 && size.cssHeight > 8)
                frame();
        }

        function frame() {
            var box = worldBox(root, THREE);
            var size = box.getSize(new THREE.Vector3());
            var center = box.getCenter(new THREE.Vector3());
            var fov = camera.fov * Math.PI / 180;
            var maxSize = Math.max(size.x, size.y, size.z, 0.001);
            var dist = (maxSize * 0.5) / Math.tan(fov * 0.5);
            var compact = isCompact();
            var isCtrl = kind === 'controle' || /controller/i.test(String(modelUrl || ''));
            var zoom;
            if (isCtrl)
                zoom = preview ? 7.2 : (compact ? 15.5 : 8.54);
            else
                zoom = preview ? 1.28 : (compact ? 3.8 : 1.58);
            var camDist = Math.max(dist * zoom, 0.05);
            camera.position.set(
                center.x + dist * 0.2,
                center.y + (preview ? dist * 0.22 : dist * 0.04),
                center.z + camDist
            );
            camera.near = Math.max(dist / 200, 0.01);
            camera.far = Math.max(dist * 80, 20);
            camera.lookAt(center);
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.minDistance = dist * 0.4;
            controls.maxDistance = Math.max(camDist * 1.5, dist * 12);
            controls.update();
        }

        function tick() {
            if (!viewers.includes(entry))
                return;
            controls.update();
            renderer.render(scene, camera);
            entry.raf = requestAnimationFrame(tick);
        }

        entry.onResize = applySize;
        window.addEventListener('resize', entry.onResize);
        if (window.ResizeObserver) {
            entry.resizeObserver = new ResizeObserver(applySize);
            entry.resizeObserver.observe(canvas);
        }
        applySize();
        tick();
    }

    return {
        mount: mount,
        dispose: dispose,
        preload: preload
    };
})();
